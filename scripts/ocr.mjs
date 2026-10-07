/**
 * OCR скриншота рейтинга (Archero 2, Вторжение монстров).
 * ocrOwnRow — строка конкретного зарегистрированного ника → { dmg, raw } | null.
 * ocrBoard — все строки рейтинга «ник + урон» (альбомы: один скрин закрывает
 * нескольких игроков) → [{ nickRaw, dmg, raw, y }] | null.
 * matchNick — канонизация распознанного ника по списку известных.
 * Зависимости (tesseract.js, jimp) опциональны: если не установлены — модуль
 * просто недоступен, бот уйдёт в ручной ввод.
 */
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

let Jimp = null, createWorker = null;
try {
  ({ Jimp } = await import('jimp'));
  ({ createWorker } = await import('tesseract.js'));
} catch {
  console.log('OCR: tesseract/jimp не установлены — автораспознавание недоступно');
}
const TESSDATA_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'tessdata');

/* расстояние Левенштейна для нечёткого сравнения ника */
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* токен-урон: «5.91T», «698.98B»/«698.988» (B читается как 8), «698.98 В» склеивается
   ниже, «37.427»/«6.371» (T читается как 7/1), «6.37%», «94.З9Т» (кириллические З/О
   вместо 3/0), «700M», «12K», «41T» → { dmg, raw }. Голое «19,60» без суффикса НЕ
   парсим: масштаб (B или T) неизвестен, а ошибка в 1000 раз хуже пропуска записи.
   Нулевой урон («0т» из слова «от» после замены о→0, «0.00T») — тоже не запись */
export function parseDamageToken(tok) {
  const s = String(tok).replace(/[Оо]/g, '0').replace(/[Зз]/g, '3');
  const mk = (num, mult, suf) => (num > 0 ? { dmg: Math.round(num * mult), raw: `${num}${suf}` } : null);
  let m = s.match(/^(\d{1,4})[.,](\d{2})([TТт71%]|[BbВвБ8]|[MmМ]|[KkК])[.,]{0,2}$/);
  if (m) {
    const num = parseFloat(`${m[1]}.${m[2]}`);
    const cls = m[3];
    const mult = /[BbВвБ8]/.test(cls) ? 1e9 : /[MmМ]/.test(cls) ? 1e6 : /[KkК]/.test(cls) ? 1e3 : 1e12;
    return mk(num, mult, { 1e3: 'K', 1e6: 'M', 1e9: 'B', 1e12: 'T' }[mult]);
  }
  m = s.match(/^(\d{1,4})([KkКMmМBbВвБTТт])(?![A-Za-z0-9])/); // 700M / 12K / 41T
  if (m) {
    const mult = { K: 1e3, k: 1e3, К: 1e3, M: 1e6, m: 1e6, М: 1e6, B: 1e9, b: 1e9, В: 1e9, в: 1e9, Б: 1e9, T: 1e12, Т: 1e12, т: 1e12 }[m[2]];
    return mk(parseFloat(m[1]), mult, { 1e3: 'K', 1e6: 'M', 1e9: 'B', 1e12: 'T' }[mult]);
  }
  return null;
}

/* слова → визуальные строки */
function groupLines(words) {
  words.sort((a, b) => a.y - b.y);
  const lines = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs(l.y - w.y) < Math.max(14, w.h * 0.7));
    if (line) line.words.push(w);
    else lines.push({ y: w.y, words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.x - b.x);
  return lines;
}

/* срезать мусор по краям токена вида «+¥DonMaxone» */
const clean = (t) => t.replace(/^[^A-Za-zА-Яа-я0-9]+|[^A-Za-zА-Яа-я0-9]+$/g, '');

/* гомоглифы: OCR в рус+eng читает латинские ники кириллицей («ipunany» →
   «ипапу») и наоборот — перед нечётким сравнением складываем в один вид */
const FOLD = { а: 'a', в: 'b', с: 'c', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', т: 't', у: 'y', х: 'x', и: 'u', п: 'n' };
const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, (ch) => FOLD[ch] || '');

/* первый токен-урон в наборе токенов: { d, idx } | null (idx — позиция в наборе).
   «698.98 В» — суффикс иногда отрывается от числа пробелом: сначала пробуем
   склеить число с коротким соседним токеном-суффиксом, потом токен как есть */
function dmgOfIdx(toks) {
  for (let i = 0; i < toks.length; i++) {
    if (/^\d{1,4}[.,]\d{2}$/.test(toks[i]) && i + 1 < toks.length && /^[BbВвБ8TТт7MmМKkК1%]$/.test(toks[i + 1])) {
      const glued = parseDamageToken(toks[i] + toks[i + 1]);
      if (glued) return { d: glued, idx: i };
    }
    const d = parseDamageToken(toks[i]);
    if (d) return { d, idx: i };
  }
  return null;
}
const dmgOf = (toks) => dmgOfIdx(toks)?.d || null;

async function makeWorker() {
  // rus подключаем, если модель лежит в tessdata (кириллические ники)
  const langs = existsSync(path.join(TESSDATA_DIR, 'rus.traineddata')) ? 'eng+rus' : 'eng';
  return createWorker(langs, 1, {
    langPath: TESSDATA_DIR, // данные языка лежат в репо — без скачивания
    cacheMethod: 'none',
    gzip: false,
  });
}

/* основной проход по всему кадру: зона рейтинга — почти весь экран
   (8%–97% высоты, без боковых кропов: своя строка может быть и последней
   видимой внизу, её подрезать нельзя; toBottom=true — до 100%, для прохода
   ×5, где выживают обрезанные краем строки). Масштаб ×3: ×2 заметно теряет
   мелкие цифры урона на плашках (×5 — контрольный проход для тёмных строк);
   psm — режим сегментации (по умолчанию авто). → слова → визуальные строки */
async function mainPass(img, imagePath, worker, { scale = 3, psm = null, toBottom = false, label = 'ocr' } = {}) {
  const { width, height } = img.bitmap;
  const CROP_TOP = Math.floor(height * 0.08), SCALE = scale;
  const list = img.clone().crop({
    x: 0, y: CROP_TOP, w: width, h: toBottom ? height - CROP_TOP : Math.ceil(height * 0.89),
  });
  list.resize({ w: width * SCALE });
  list.greyscale();

  const tmp = imagePath + '.list.png';
  await list.write(tmp);
  try {
    if (psm) await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(tmp, {}, { blocks: true });
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
      words.push({ text: w.text, x: w.bbox.x0, y: w.bbox.y0, h: w.bbox.y1 - w.bbox.y0 });
    }
    const lines = groupLines(words);
    if (process.env.OCR_DEBUG === '2') for (const l of lines) console.error(`[${label}] y=${l.y}: ${l.words.map((w) => `${w.text}@${w.x}`).join(' | ')}`);
    return { lines, CROP_TOP, SCALE, width, height };
  } finally {
    try { unlinkSync(tmp); } catch {} // временный кроп не должен попасть в коммит
  }
}

/* повторное чтение полосы кадра ×5 в двух режимах сегментации (PSM 7 «одна
   строка» и PSM 11 «разреженный текст») → [{ psm, lines, text }].
   Основной проход ×3 теряет урон в строках, обрезанных нижним краем кадра
   (свою строку игроки часто ловят у самого низа списка) */
async function ocrStrips(img, imagePath, worker, x0, y0, y1) {
  const width = img.bitmap.width;
  const strip = img.clone().crop({ x: x0, y: y0, w: width - x0, h: y1 - y0 });
  strip.resize({ w: strip.bitmap.width * 5 });
  strip.greyscale();
  const tmp2 = imagePath + '.row.png';
  await strip.write(tmp2);
  try {
    const out = [];
    for (const psm of ['7', '11']) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data: d2 } = await worker.recognize(tmp2, {}, { blocks: true });
      const words2 = [];
      for (const b of d2.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || [])
        words2.push({ text: w.text, x: w.bbox.x0, y: w.bbox.y0, h: w.bbox.y1 - w.bbox.y0 });
      out.push({ psm, lines: groupLines(words2), text: d2.text });
    }
    return out;
  } finally { try { unlinkSync(tmp2); } catch {} }
}

/* поиск строки с ником и уроном; nick — зарегистрированный ник игрока */
export async function ocrOwnRow(imagePath, nick) {
  if (!Jimp || !createWorker) return null;
  if (!existsSync(imagePath)) return null;
  let img;
  try { img = await Jimp.read(imagePath); } catch { return null; }
  const worker = await makeWorker();
  try {
    const { lines, CROP_TOP, SCALE, width, height } = await mainPass(img, imagePath, worker);
    const nickRe = /^[A-Za-zА-Яа-я0-9_.-]{3,16}$/;
    const isNick = (t) => {
      const c = clean(t);
      if (!nickRe.test(c)) return false;
      const thr = nick.length <= 4 ? 1 : Math.max(2, nick.length * 0.34); // короткие — строже
      return lev(c.toLowerCase(), nick.toLowerCase()) <= thr;
    };
    const toksOf = (l) => (l ? l.words.map(w => w.text) : []);
    /* урон игрока не бывает левее его ника: в списке он правее ника в той же
       строке, на подиуме — под именем. Числа левее ника в той же полосе — чужие
       (урон «БАЗУКИ» с центра подиума топ-1, значения левого соседа) и игроку
       не засчитываются */
    const X_TOL = 40; // допуск в координатах основного прохода (масштаб ×3)
    const toksAfter = (l, nw) => {
      if (!l) return [];
      const from = l.words.indexOf(nw) + 1; // своя строка: токены после ника
      return l.words.filter((w, i) => i >= from && w.x >= nw.x - X_TOL).map((w) => w.text);
    };
    const toksRight = (l, nw) => (l ? l.words.filter((w) => w.x >= nw.x - X_TOL).map((w) => w.text) : []);

    /* полоса кадра ×5 в двух режимах сегментации — общая с ocrBoard */
    const ocrStrip = (x0, y0, y1) => ocrStrips(img, imagePath, worker, x0, y0, y1);

    /* повторный проход по строке ника: кроп из исходника вокруг неё, ×5, PSM «одна
       строка» — основной проход ×3 теряет урон в строке, обрезанной нижним краем
       кадра (свою строку игроки часто ловят у самого низа списка) */
    async function reocrRow(nickWord) {
      const x0 = Math.max(0, Math.floor(nickWord.x / SCALE) - 12);
      const y0 = Math.max(0, CROP_TOP + Math.floor(nickWord.y / SCALE) - 8);
      const nickBottom = CROP_TOP + Math.ceil((nickWord.y + nickWord.h) / SCALE);
      // строка в нижней четверти кадра → тянем полосу до края: у обрезанной
      // наполовину строки цифры урона ниже bbox ника; ниже своей строки других
      // строк уже нет, взять чужой урон нельзя
      const toEdge = y0 > height * 0.7;
      const y1 = toEdge ? height : Math.min(height, nickBottom + 36);
      const hits = [];
      for (const { lines: slines, text } of await ocrStrip(x0, y0, y1)) {
        const toks = slines.flatMap((l) => l.words.map((w) => w.text));
        if (!toks.length && text) toks.push(...String(text).split(/\s+/).filter(Boolean));
        const hit = dmgOf(toks);
        if (hit) hits.push(hit);
      }
      if (!hits.length) return null;
      if (hits.length > 1) {
        // режимы сегментации спорят (PSM 7 «12.30T» читал как «32.307» — 1→3):
        // верим прочитанному, которое подтверждается числом из основного прохода
        const seen = new Set(lines.flatMap((l) => l.words.map((w) => parseDamageToken(w.text)).filter(Boolean).map((d) => d.dmg)));
        const confirmed = hits.find((h) => seen.has(h.dmg));
        if (confirmed) return confirmed;
      }
      return hits[0];
    }

    /* основной проход может убить ник (тёмная плашка, строка наполовину обрезана
       краем кадра — урон выжил, имя превратилось в мусор). Тогда перечитываем
       крупно каждую строку с числом урона и ищем ник уже в полосе */
    async function reocrByDamage(anchor) {
      const y0 = Math.max(0, CROP_TOP + Math.floor(anchor.y / SCALE) - 20); // ник часто выше числа
      const anchorBottom = CROP_TOP + Math.ceil((anchor.y + anchor.h) / SCALE);
      const y1 = y0 > height * 0.7 ? height : Math.min(height, anchorBottom + 36);
      for (const { lines: slines } of await ocrStrip(0, y0, y1)) {
        for (let i = 0; i < slines.length; i++) {
          const nw = slines[i].words.find((w) => isNick(w.text));
          if (!nw) continue;
          const hit = dmgOf(toksAfter(slines[i], nw)) || dmgOf(toksRight(slines[i + 1], nw)) || dmgOf(toksRight(slines[i - 1], nw));
          if (hit) return hit;
        }
      }
      return null;
    }

    // приоритет ассоциации «ник → урон»: своя строка → следующая → повторное
    // чтение своей строки крупно (низ списка часто обрезан краем кадра, урон
    // добирается зумом) → предыдущая (соседи — чужие значения, это последний шанс)
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const nickWord = lines[i].words.find((w) => isNick(w.text));
      if (!nickWord) continue;
      const d = dmgOf(toksAfter(lines[i], nickWord)) || dmgOf(toksRight(lines[i + 1], nickWord)) || await reocrRow(nickWord) || dmgOf(toksRight(lines[i - 1], nickWord));
      if (d) rows.push({ d, y: lines[i].y });
      if (process.env.OCR_DEBUG) console.error(`[ocr] nick-строка y=${lines[i].y}: «${toksOf(lines[i]).join(' ')}» → ${d ? d.raw : 'нет урона'}`);
    }
    if (!rows.length) {
      for (const l of lines) {
        const anchor = l.words.find((w) => parseDamageToken(w.text));
        if (anchor) { const d = await reocrByDamage(anchor); if (d) rows.push({ d, y: l.y }); }
      }
    }
    if (!rows.length) return null;
    if (process.env.OCR_DEBUG) console.error(`[ocr] строки-кандидаты: ${rows.map((r) => `${r.d.raw}@y${r.y}`).join(', ')}`);
    // игра закрепляет собственную строку игрока внизу списка — при нескольких
    // совпадениях берём её, а не максимум: рядом с пьедесталом топ-3 лежит счётчик
    // общего урона гильдии, который легко принять за урон игрока. Но закреплённая
    // строка бывает обрезана краем кадра и теряет первую цифру (94.39 → 04.30):
    // если её значение в разы меньше другой строки того же ника — верим большей
    rows.sort((a, b) => (b.y - a.y) || (b.d.dmg - a.d.dmg));
    let best = rows[0];
    const alt = rows.slice(1).sort((a, b) => b.d.dmg - a.d.dmg)[0];
    if (alt && best.d.dmg * 4 < alt.d.dmg) best = alt;
    return best.d;
  } finally {
    await worker.terminate();
  }
}

/* канонизация распознанного ника по списку известных: точное нормализованное
   совпадение, затем нечёткое (порог как у isNick — расстояние Левенштейна).
   Если под порог попали два разных известных ника с равным расстоянием —
   никого не выбираем: ошибка в записи хуже пропуска канонизации */
export function matchNick(raw, knownNicks) {
  const target = fold(raw);
  if (!target) return null;
  const byNorm = new Map(); // fold(ник) → исходный ник (первый с такой свёрткой)
  for (const n of knownNicks) {
    const k = fold(n);
    if (k && !byNorm.has(k)) byNorm.set(k, n);
  }
  if (byNorm.has(target)) return byNorm.get(target);
  const cands = [...byNorm.keys()]
    .map((k) => ({ k, d: lev(k, target) }))
    // короткие ники (≤4) — только расстояние 1: при допуске 2 под «CGR»
    // подходит любой трёхбуквенный мусор («судьб» → «cyb»)
    .filter((c) => c.d <= (c.k.length <= 4 ? 1 : Math.max(2, c.k.length * 0.34)))
    .sort((a, b) => a.d - b.d);
  if (!cands.length || (cands.length > 1 && cands[0].d === cands[1].d)) return null;
  return byNorm.get(cands[0].k);
}

/* служебные надписи рейтинга, которые легко принять за ник («общий урон» и пр.),
   плюс бейджи гильдий под никами («…ая судьба», «движение», «unity»). Ключи
   сразу сворачиваем fold()-ом: проверка идёт по свёрнутому имени */
const BOARD_JUNK = new Set([
  'общийурон', 'общий', 'урон', 'гильдии', 'уронгильдии', 'общ', 'босс', 'boss',
  'damage', 'total', 'totaldamage', 'guild', 'rank', 'награда', 'reward',
  'lonca', 'sezon', 'sesion', 'season', 'сезон',
  'судьба', 'аясудьба', 'анная', 'санная', 'еписанная', 'асанная', 'эписанная',
  'движение', 'дение', 'продвижение', 'unity', 'unity2',
  // заголовок события и шапка рейтинга
  'вторжение', 'торжение', 'монстров', 'рейтинг', 'участников',
].map(fold));

/* все токены-урон в наборе (со склейкой оторванного суффикса): [{ d, idx }] */
function allDmg(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (/^\d{1,4}[.,]\d{2}$/.test(toks[i]) && i + 1 < toks.length && /^[BbВвБ8TТт7MmМKkК1%]$/.test(toks[i + 1])) {
      const glued = parseDamageToken(toks[i] + toks[i + 1]);
      if (glued) { out.push({ d: glued, idx: i }); i++; continue; }
    }
    const d = parseDamageToken(toks[i]);
    if (d) out.push({ d, idx: i });
  }
  return out;
}

/* подиум топ-3 в верхней части скрина (новый формат рейтинга): на каждом
 * пьедестале имя, под ним бейдж гильдии и урон; урон набран крупным шрифтом и
 * нередко разваливается на вертикальные фрагменты («397.» + «63T»). Сканируем
 * область над началом списка (первый ранг слева): слова обоих проходов
 * (B переводим в координаты A), фрагменты чисел склеиваем в колонках, имя =
 * верхний токен колонки (имя выше бейджа), пары «имя ↔ урон» — по близости
 * колонок, урон не выше и не сильно ниже имени. */
function scanPodium(passA, passB) {
  const widthA = passA.width * passA.SCALE; // координаты слов — в масштабе прохода A
  const rankLine = passA.lines.find((l) => l.words.some((w) => {
    const c = clean(w.text);
    return /^\d{1,2}$/.test(c) && w.x < widthA * 0.14; // ранг списка — слева
  }));
  if (!rankLine) return [];
  const yMax = rankLine.y;
  const words = [
    ...passA.lines.flatMap((l) => l.words),
    ...passB.lines.flatMap((l) => l.words.map((w) => ({ ...w, x: w.x * 0.6, y: w.y * 0.6 }))),
  ].filter((w) => w.y < yMax);
  if (process.env.OCR_DEBUG === '2') console.error(`[ocr:podium] yMax=${yMax}, слов в зоне: ${words.length}`);

  // урон-кандидаты: числовые токены, фрагменты одной колонки склеиваем
  const numericish = (t) => /\d/.test(t) && !/[A-Za-zА-Яа-я]{2}/.test(t);
  const frags = [];
  for (const w of words.filter((w) => numericish(w.text)).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const c = frags.find((f) => Math.abs(f.x - w.x) < 130 && Math.abs(f.y - w.y) < 130);
    if (c) { c.toks.push(w); c.y = Math.max(c.y, w.y); c.x = Math.min(c.x, w.x); }
    else frags.push({ x: w.x, y: w.y, toks: [w] });
  }
  const dmgs = [];
  for (const f of frags) {
    f.toks.sort((a, b) => a.y - b.y || a.x - b.x);
    const glued = parseDamageToken(f.toks.map((t) => t.text).join(''));
    const d = glued || f.toks.map((t) => parseDamageToken(t.text)).find(Boolean);
    if (d) dmgs.push({ x: f.x, y: f.y, d });
  }
  if (!dmgs.length) return [];
  // обрывки-суффиксы: «63T» — хвост «397.63T»; на подиуме мелких значений не бывает
  dmgs.sort((a, b) => b.d.dmg - a.d.dmg);
  const real = dmgs.filter((d, i) => !(d.d.raw.length <= 5 && dmgs.slice(0, i).some((b) => b.d.dmg > d.d.dmg && b.d.raw.endsWith(d.d.raw))));

  // имена: колонки по x; колонку возглавляет верхний токен, под которым в той же
  // колонке есть урон на расстоянии 80–320 (имя выше бейджа гильдии и ближе к
  // числу, чем мусор аватарки над ним)
  const cols = [];
  for (const w of words
    .filter((w) => /^[A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9_.-]{2,15}$/.test(clean(w.text)) && !BOARD_JUNK.has(fold(clean(w.text))) && !parseDamageToken(clean(w.text)))
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    const hasDmgBelow = real.some((d) => d.y >= w.y + 80 && d.y - w.y <= 320 && Math.abs(d.x - w.x) < 350);
    if (!hasDmgBelow) continue;
    if (!cols.some((c) => Math.abs(c.x - w.x) < 160)) cols.push({ x: w.x, top: w });
  }
  // пары: урон ниже имени в той же колонке, каждый токен — один раз
  const pairs = [];
  for (const c of cols) {
    for (const d of real) {
      const dy = d.y - c.top.y;
      if (dy < 80 || dy > 320) continue; // имя выше урона, но не через полэкрана
      const dist = Math.abs(d.x - c.x);
      if (dist < 350) pairs.push({ name: clean(c.top.text), d, dist, y: c.top.y });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);
  const rows = [], usedName = new Set(), usedDmg = new Set();
  for (const p of pairs) {
    if (usedName.has(p.name) || usedDmg.has(p.d.d.dmg)) continue;
    usedName.add(p.name); usedDmg.add(p.d.d.dmg);
    rows.push({ nickRaw: p.name, dmg: p.d.d.dmg, raw: p.d.d.raw, y: p.y });
    if (process.env.OCR_DEBUG) console.error(`[ocr:podium] y=${Math.round(p.y)}: ${p.name} ${p.d.d.raw} (Δx=${Math.round(p.dist)})`);
  }
  return rows;
}

/* все строки рейтинга со скрина. Один скрин закрывает несколько игроков
 * гильдии (альбомы от допущенных отправителей). Два прохода и слияние:
 *  - A: ×3, авто-сегментация — основной (как в ocrOwnRow);
 *  - B: ×5, PSM 11 «разреженный текст», кроп до низа кадра — читает тёмные
 *    и обрезанные краем строки (закреплённая строка владельца скрина).
 * Строка A рядом по y со строкей B считается ошибочным чтением той же строки
 * и отбрасывается (B читает лучше). Правила строки: урон = самое правое число
 * (левее бывают колонки ранга/очков), ник = буквы левее него; нет чисел —
 * ровно один похожий на ник токен + число строкой ниже правее него. Подиум
 * топ-3 (несколько имён и чисел в одной строке) не сопоставить — пропускаем.
 * Возвращает [{ nickRaw, dmg, raw, y }] сверху вниз или null */
export async function ocrBoard(imagePath) {
  if (!Jimp || !createWorker) return null;
  if (!existsSync(imagePath)) return null;
  let img;
  try { img = await Jimp.read(imagePath); } catch { return null; }
  const worker = await makeWorker();
  try {
    const passA = await mainPass(img, imagePath, worker, { label: 'ocr:A' });
    const passB = await mainPass(img, imagePath, worker, { scale: 5, psm: '11', toBottom: true, label: 'ocr:B' });
    /* правила разбора одного набора строк; yMul/yEps приводят координаты
       прохода B (×5) к масштабу A (×3), с крошечным сдвигом вниз — при
       равенстве победит более свежее чтение B */
    const rowsOf = (ls, yMul = 1, yEps = 0) => {
      const out = [];
      const XT = Math.round(40 / yMul); // допуск «урон правее ника» в координатах этого прохода
      const push = (name, d, y) => {
        if (name.length < 3 || name.length > 24) return; // игровые ники — от 3 символов
        if (BOARD_JUNK.has(fold(name))) return;
        if (parseDamageToken(name)) return; // «63T» — обрывок числа, не ник
        out.push({ nickRaw: name, dmg: d.dmg, raw: d.raw, y: y * yMul + yEps });
      };
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i];
        const hits = allDmg(l.words.map((w) => w.text));
        if (hits.length) {
          const right = hits.reduce((a, b) => (l.words[b.idx].x >= l.words[a.idx].x ? b : a));
          const names = l.words.slice(0, right.idx)
            .map((w) => clean(w.text))
            .filter((t) => /[A-Za-zА-Яа-я]/.test(t));
          // подиум топ-3: несколько имён и несколько чисел не сопоставить по строке
          if (names.length >= 2 && hits.length >= 2) continue;
          push(names.join(''), right.d, l.y);
          if (process.env.OCR_DEBUG) console.error(`[ocr:board] y=${Math.round(l.y * yMul + yEps)}: «${l.words.map((w) => w.text).join(' ')}» → ${names.join('')} ${right.d.raw}`);
          continue;
        }
        // строка без чисел: ровно один похожий на ник токен + самое правое число
        // строкой ниже правее него; между именем и числом бывает строка ранга
        // или бейджа гильдии — смотрим на две строки вниз, но не дальше чужого имени
        const nameWords = l.words.filter((w) => /^[A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9_.-]{2,15}$/.test(clean(w.text)));
        if (nameWords.length !== 1) continue;
        for (let j = 1; j <= 2; j++) {
          const below = ls[i + j];
          if (!below) break;
          const hasName = below.words.some((w) => /^[A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9_.-]{2,15}$/.test(clean(w.text)) && !BOARD_JUNK.has(fold(clean(w.text))));
          if (hasName) break; // имя другого игрока — урон ниже уже его
          const candWords = below.words.filter((w) => w.x >= nameWords[0].x - XT);
          const candHits = allDmg(candWords.map((w) => w.text));
          if (!candHits.length) continue;
          const right = candHits.reduce((a, b) => (candWords[b.idx].x >= candWords[a.idx].x ? b : a));
          // урон не должен иметь букв левее себя в нижней строке — иначе это чужая
          // строка «ник + урон», а не число нашего игрока
          if (candWords.slice(0, right.idx).some((w) => /[A-Za-zА-Яа-я]/.test(clean(w.text)))) break;
          push(clean(nameWords[0].text), right.d, l.y);
          if (process.env.OCR_DEBUG) console.error(`[ocr:board] y=${Math.round(l.y * yMul + yEps)}: «${l.words.map((w) => w.text).join(' ')}» + низ(${j}) → ${clean(nameWords[0].text)} ${right.d.raw}`);
          break;
        }
      }
      return out;
    };
    /* повторы одного ника внутри прохода схлопываем: нижняя строка авторитетнее,
       но при обрезанной первой цифре (в разы меньше) — берём большую */
    const dedupe = (rows) => {
      const m = new Map();
      for (const r of rows) {
        const prev = m.get(fold(r.nickRaw));
        if (!prev) m.set(fold(r.nickRaw), r);
        else if (prev.y >= r.y) { if (prev.dmg * 4 < r.dmg) m.set(fold(r.nickRaw), r); }
        else if (r.dmg * 4 >= prev.dmg) m.set(fold(r.nickRaw), r);
      }
      return [...m.values()];
    };
    const A = dedupe([...scanPodium(passA, passB), ...rowsOf(passA.lines)]);
    const B = dedupe(rowsOf(passB.lines, 0.6, 1));
    /* слияние: B (×5) находит строки, невидимые в A, но портит значения
       закреплённых нижних строк («24.81T» → «81T»). Поэтому строка A рядом
       по y со строкой B с ДРУГИМ именем считается ошибкой чтения и падает
       (имя в B надёжнее), а имя, найденное в A, никогда не перекрывается B */
    const keptA = A.filter((a) => !B.some((b) => Math.abs(b.y - a.y) < 60 && fold(b.nickRaw) !== fold(a.nickRaw)));
    const aNames = new Set(keptA.map((a) => fold(a.nickRaw)));
    const rows = [...keptA, ...B.filter((b) => !aNames.has(fold(b.nickRaw)))].sort((a, b) => a.y - b.y);
    if (process.env.OCR_DEBUG) console.error(`[ocr:board] проходы: A=${A.length}, B=${B.length}, итого ${rows.length}`);
    return rows.length ? rows : null;
  } finally {
    await worker.terminate();
  }
}
