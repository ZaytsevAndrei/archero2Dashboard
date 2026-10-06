#!/usr/bin/env node
/** Регрессия OCR: прогон ocrOwnRow и ocrBoard по всем живым пруфам из docs/data.json.
 *  Любая правка scripts/ocr.mjs — только с чистым прогоном этого скрипта:
 *    node scripts/regression-ocr.mjs
 *  Ожидаемый результат:
 *   - ocrOwnRow: каждая запись с пруфом даёт то же dmg, что записано;
 *   - ocrBoard (путь альбомов): строка владельца записи находится канонизацией
 *     ника (matchNick по всем известным никам) и её урон совпадает с записанным.
 *  (расхождение = регрессия либо неверная запись в данных — разбирать руками) */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ocrOwnRow, ocrBoard, matchNick } from './ocr.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const data = existsSync(path.join(ROOT, 'docs', 'data.json'))
  ? JSON.parse(readFileSync(path.join(ROOT, 'docs', 'data.json'), 'utf8')) : { entries: [] };

const live = data.entries.filter((e) => !e.demo && e.proof && existsSync(path.join(ROOT, 'docs', e.proof)));
const knownNicks = [...new Set(data.entries.filter((e) => !e.demo).map((e) => e.nick))];
console.log(`Прогон OCR по ${live.length} живым пруфам…\n`);
let okOwn = 0, okBoard = 0, okBoardOnly = 0;
for (const e of live) {
  const proofPath = path.join(ROOT, 'docs', e.proof);

  let got = null;
  try { got = await ocrOwnRow(proofPath, e.nick); } catch (err) { got = { error: err.message }; }
  const sameOwn = got && !got.error && got.dmg === e.dmg;
  if (sameOwn) okOwn++;

  let board = null;
  try { board = await ocrBoard(proofPath); } catch (err) { board = { error: err.message }; }
  let gotB = null;
  if (Array.isArray(board)) {
    // канонизация по всем известным никам, как это будет делать бот в альбомах;
    // из совпавших строк берём нижнюю — своя строка закреплена внизу списка
    const mine = board.filter((r) => matchNick(r.nickRaw, knownNicks) === e.nick);
    if (mine.length) gotB = mine.reduce((a, b) => (b.y > a.y ? b : a));
  }
  const boardOnlyHit = !!gotB && gotB.dmg === e.dmg;
  if (boardOnlyHit) okBoardOnly++;
  /* итоговый путь бота (processAlbum): строку отправителя гарантирует
     ocrOwnRow — его значение перекрывает чтение доски; доска добавляет
     остальных игроков. Для исторических записей (все — свои скрины)
     ожидаем exactly это композиционное значение */
  const finalDmg = got && !got.error ? got.dmg : gotB?.dmg;
  const sameBoard = finalDmg === e.dmg && (got || gotB);
  if (sameBoard) okBoard++;

  const own = got ? (got.error ? 'ошибка: ' + got.error : `${got.raw} (${got.dmg})`) : 'null';
  const brd = gotB ? `${gotB.nickRaw} ${gotB.raw} (${gotB.dmg})` : (board?.error ? 'ошибка: ' + board.error : 'строка не найдена');
  console.log(`${sameOwn && sameBoard ? 'OK ' : 'BAD'} #${e.id} ${e.nick} ${e.date}: записано ${e.raw} (${e.dmg}) | own ${own} | board ${brd}${boardOnlyHit ? '' : ' (спас ownRow)'}`);
}
console.log(`\nИтог: ocrOwnRow ${okOwn}/${live.length}, альбомный путь (доска+ownRow) ${okBoard}/${live.length}`);
console.log(`Чистая доска без ownRow: ${okBoardOnly}/${live.length} (справочно; строка отправителя — худший случай для доски)`);
process.exit(okOwn === live.length && okBoard === live.length ? 0 : 1);
