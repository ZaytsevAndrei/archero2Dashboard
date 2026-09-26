#!/usr/bin/env node
/** Регрессия OCR: прогон ocrOwnRow по всем живым пруфам из docs/data.json.
 *  Любая правка scripts/ocr.mjs — только с чистым прогоном этого скрипта:
 *    node scripts/regression-ocr.mjs
 *  Ожидаемый результат: каждая запись с пруфом даёт то же dmg, что записано
 *  (расхождение = регрессия либо неверная запись в данных — разбирать руками). */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ocrOwnRow } from './ocr.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const data = JSON.parse(existsSync(path.join(ROOT, 'docs', 'data.json'))
  ? (await import('node:fs')).readFileSync(path.join(ROOT, 'docs', 'data.json'), 'utf8') : '{"entries":[]}');

const live = data.entries.filter((e) => !e.demo && e.proof && existsSync(path.join(ROOT, 'docs', e.proof)));
console.log(`Прогон OCR по ${live.length} живым пруфам…\n`);
let ok = 0;
for (const e of live) {
  const proofPath = path.join(ROOT, 'docs', e.proof);
  let got = null;
  try { got = await ocrOwnRow(proofPath, e.nick); } catch (err) { got = { error: err.message }; }
  const same = got && !got.error && got.dmg === e.dmg;
  if (same) ok++;
  console.log(`${same ? 'OK ' : 'BAD'} #${e.id} ${e.nick} ${e.date}: записано ${e.raw} (${e.dmg}) → OCR ${got ? (got.error ? 'ошибка: ' + got.error : got.raw + ' (' + got.dmg + ')') : 'null'}`);
}
console.log(`\nИтог: ${ok}/${live.length} совпали`);
process.exit(ok === live.length ? 0 : 1);
