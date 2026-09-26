/**
 * OCR скриншота рейтинга (Archero 2, Вторжение монстров).
 * Ищем строку зарегистрированного ника и урон в ней.
 * Возвращает { dmg, raw } или null. Зависимости (tesseract.js, jimp) опциональны:
 * если не установлены — модуль просто недоступен, бот уйдёт в ручной ввод.
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

/* поиск строки с ником и уроном; nick — зарегистрированный ник игрока */
export async function ocrOwnRow(imagePath, nick) {
  if (!Jimp || !createWorker) return null;
  if (!existsSync(imagePath)) return null;
  let img;
  try { img = await Jimp.read(imagePath); } catch { return null; }
  const { width, height } = img.bitmap;

  // зона рейтинга: почти весь экран (8%–97% по высоте, без боковых кропов) —
  // своя строка может быть и последней видимой внизу, её подрезать нельзя.
  // Масштаб ×3: ×2 заметно теряет мелкие цифры урона на плашках.
  const CROP_TOP = Math.floor(height * 0.08), SCALE = 3;
  const list = img.clone().crop({
    x: 0, y: CROP_TOP, w: width, h: Math.ceil(height * 0.89),
  });
  list.resize({ w: width * SCALE });
  list.greyscale();

  const tmp = imagePath + '.list.png';
  await list.write(tmp);
  // rus подключаем, если модель лежит в tessdata (кириллические ники)
  const langs = existsSync(path.join(TESSDATA_DIR, 'rus.traineddata')) ? 'eng+rus' : 'eng';
  const worker = await createWorker(langs, 1, {
    langPath: TESSDATA_DIR, // данные языка лежат в репо — без скачивания
    cacheMethod: 'none',
    gzip: false,
  });
  try {
    const { data } = await worker.recognize(tmp, {}, { blocks: true });
    try { unlinkSync(tmp); } catch {} // временный кроп не должен попасть в коммит
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
      words.push({ text: w.text, x: w.bbox.x0, y: w.bbox.y0, h: w.bbox.y1 - w.bbox.y0 });
    }
    const lines = groupLines(words);
    const clean = (t) => t.replace(/^[^A-Za-zА-Яа-я0-9]+|[^A-Za-zА-Яа-я0-9]+$/g, ''); // срезать мусор вида «+¥DonMaxone»
    const nickRe = /^[A-Za-zА-Яа-я0-9_.-]{3,16}$/;
    const isNick = (t) => { const c = clean(t); return nickRe.test(c) && lev(c.toLowerCase(), nick.toLowerCase()) <= Math.max(2, nick.length * 0.34); };
    const toksOf = (l) => (l ? l.words.map(w => w.text) : []);
    /* «698.98 В» — суффикс иногда отрывается от числа пробелом: сначала пробуем
       склеить число с коротким соседним токеном-суффиксом, потом токен как есть */
    const dmgOf = (toks) => {
      for (let i = 0; i < toks.length; i++) {
        if (/^\d{1,4}[.,]\d{2}$/.test(toks[i]) && i + 1 < toks.length && /^[BbВвБ8TТт7MmМKkК1%]$/.test(toks[i + 1])) {
          const glued = parseDamageToken(toks[i] + toks[i + 1]);
          if (glued) return glued;
        }
        const d = parseDamageToken(toks[i]);
        if (d) return d;
      }
      return null;
    };

    /* полоса кадра ×5, распознанная в двух режимах сегментации (PSM 7 «одна
       строка» и PSM 11 «разреженный текст») → [{psm, lines, text}] */
    async function ocrStrip(x0, y0, y1) {
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
          if (!slines[i].words.some((w) => isNick(w.text))) continue;
          const hit = dmgOf(toksOf(slines[i])) || dmgOf(toksOf(slines[i + 1])) || dmgOf(toksOf(slines[i - 1]));
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
      const d = dmgOf(toksOf(lines[i])) || dmgOf(toksOf(lines[i + 1])) || await reocrRow(nickWord) || dmgOf(toksOf(lines[i - 1]));
      if (d) rows.push({ d, y: lines[i].y });
    }
    if (!rows.length) {
      for (const l of lines) {
        const anchor = l.words.find((w) => parseDamageToken(w.text));
        if (anchor) { const d = await reocrByDamage(anchor); if (d) rows.push({ d, y: l.y }); }
      }
    }
    if (!rows.length) return null;
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
