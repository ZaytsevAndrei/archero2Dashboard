#!/usr/bin/env node
/** Регрессия OCR: прогон ocrOwnRow и ocrBoard по всем живым пруфам из docs/data.json.
 *  Любая правка scripts/ocr.mjs — только с чистым прогоном этого скрипта:
 *    node scripts/regression-ocr.mjs
 *  Модель данных: записи приходят альбомами (один отправитель — много фото за день,
 *  каждая строка рейтинга видна только на части фото). Поэтому доска проверяется
 *  по ВСЕМ пруфам группы «отправитель+день» — это ровно union, который делает
 *  processAlbum; ownRow по-прежнему проверяется на собственном пруфе записи.
 *  Ожидаемый результат: каждая запись с пруфом находится композитным путём
 *  (ownRow ИЛИ доска любой фото группы) с тем же уроном. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ocrOwnRow, ocrBoard, matchNick } from './ocr.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const data = existsSync(path.join(ROOT, 'docs', 'data.json'))
  ? JSON.parse(readFileSync(path.join(ROOT, 'docs', 'data.json'), 'utf8')) : { entries: [] };

const live = data.entries.filter((e) => !e.demo && e.proof && existsSync(path.join(ROOT, 'docs', e.proof)));
const knownNicks = [...new Set(data.entries.filter((e) => !e.demo).map((e) => e.nick))];
console.log(`Прогон OCR по ${live.length} живым пруфам…\n`);

// группа «отправитель+день» = один альбом: список пруфов для проверки доски
const groupProofs = new Map();
for (const e of live) {
  const k = `${e.date}|${e.tgId || ''}`;
  if (!groupProofs.has(k)) groupProofs.set(k, new Set());
  groupProofs.get(k).add(e.proof);
}
const boardCache = new Map(); // proof → строки доски (OCR один раз на фото)
async function boardOf(proof) {
  if (!boardCache.has(proof)) {
    try { boardCache.set(proof, await ocrBoard(path.join(ROOT, 'docs', proof))); }
    catch (err) { boardCache.set(proof, { error: err.message }); }
  }
  return boardCache.get(proof);
}

let okOwn = 0, okBoard = 0;
for (const e of live) {
  const proofPath = path.join(ROOT, 'docs', e.proof);

  let got = null;
  try { got = await ocrOwnRow(proofPath, e.nick); } catch (err) { got = { error: err.message }; }
  const sameOwn = got && !got.error && got.dmg === e.dmg;
  if (sameOwn) okOwn++;

  // доска: ищем строку записи на любом фото группы (канонизация matchNick,
  // из совпавших на фото берём нижнюю — своя строка закреплена внизу списка)
  let gotB = null, foundOn = '';
  for (const proof of groupProofs.get(`${e.date}|${e.tgId || ''}`)) {
    const board = await boardOf(proof);
    if (!Array.isArray(board)) continue;
    const mine = board.filter((r) => matchNick(r.nickRaw, knownNicks) === e.nick);
    if (mine.length) {
      const bottom = mine.reduce((a, b) => (b.y > a.y ? b : a));
      if (!gotB || bottom.y > gotB.y) { gotB = bottom; foundOn = proof; }
    }
  }
  /* итоговый путь бота (processAlbum): строку отправителя гарантирует
     ocrOwnRow, остальным игрокам истину даёт доска. Поэтому для записи
     достаточно совпадения урона у ЛЮБОГО из двух чтений — ownRow на чужом
     фото может прочитать соседнюю строку и не должен затенять доску */
  const sameBoard = (!!got && !got.error && got.dmg === e.dmg) || (!!gotB && gotB.dmg === e.dmg);
  if (sameBoard) okBoard++;

  const own = got ? (got.error ? 'ошибка: ' + got.error : `${got.raw} (${got.dmg})`) : 'null';
  const brd = gotB ? `${gotB.nickRaw} ${gotB.raw} (${gotB.dmg}) @${foundOn}` : 'строка не найдена';
  console.log(`${sameBoard ? 'OK ' : 'BAD'}${sameOwn ? '' : ' (без ownRow)'} #${e.id} ${e.nick} ${e.date}: записано ${e.raw} (${e.dmg}) | own ${own} | board ${brd}`);
}
console.log(`\nИтог: ocrOwnRow ${okOwn}/${live.length} (справочно; в альбомах ownRow гарантирует только строку отправителя)`);
console.log(`Альбомный путь (доска по всем фото группы + ownRow): ${okBoard}/${live.length}`);
process.exit(okBoard === live.length ? 0 : 1);
