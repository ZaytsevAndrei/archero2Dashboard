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

/* токен-урон: «5.91T», «37.427»(T читается как 7), «209.77T», «700M», «12K» → { dmg, raw } */
export function parseDamageToken(tok) {
  const s = String(tok);
  let m = s.match(/^(\d{1,4})[.,](\d{2})(?:[TТ7]|$)/); // 5.91T / 37.427 / 19,60
  if (m) {
    const num = parseFloat(`${m[1]}.${m[2]}`);
    return { dmg: Math.round(num * 1e12), raw: `${num}T` };
  }
  m = s.match(/^(\d{1,4})([KkКMmМBbБ])(?![A-Za-z0-9])/); // 700M / 12K
  if (m) {
    const mult = { K: 1e3, k: 1e3, К: 1e3, M: 1e6, m: 1e6, М: 1e6, B: 1e9, b: 1e9, Б: 1e9 }[m[2]];
    return { dmg: Math.round(parseFloat(m[1]) * mult), raw: s };
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
  const list = img.clone().crop({
    x: 0, y: Math.floor(height * 0.08), w: width, h: Math.ceil(height * 0.89),
  });
  list.resize({ w: width * 3 });
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
    const dmgOf = (toks) => toks.map(parseDamageToken).find(Boolean) || null;

    // приоритет ассоциации «ник → урон»: своя строка → следующая → предыдущая
    // (у обычных строк урон в той же/следующей строке, у пьедестала — строкой выше)
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      if (!toksOf(lines[i]).some(isNick)) continue;
      const d = dmgOf(toksOf(lines[i])) || dmgOf(toksOf(lines[i + 1])) || dmgOf(toksOf(lines[i - 1]));
      if (d) rows.push(d);
    }
    if (!rows.length) return null;
    rows.sort((a, b) => b.dmg - a.dmg); // если ник попал в несколько строк — берём максимум
    return rows[0];
  } finally {
    await worker.terminate();
  }
}
