#!/usr/bin/env node
/** Разовая миграция: пересчёт date всех записей по игровому дню (03:00–03:00).
 * В каждой записи хранится исходный ts сообщения, поэтому дата восстанавливается
 * точно, включая записи, ошибочно отнесённые к следующему дню до ввода правила.
 *
 * Запуск (на VPS, при ОСТАНОВЛЕННОМ боте — data.json пишет один процесс):
 *   node scripts/fix-entry-dates.mjs            — сухой прогон, только отчёт
 *   node scripts/fix-entry-dates.mjs --write    — применить и записать data.json
 * Не импортирует poll.mjs (тот при импорте сразу опрашивает Telegram), поэтому
 * вспомогательные функции продублированы. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const TZ = process.env.TZ_NAME || 'Europe/Moscow';
const argv = process.argv.slice(2);
const write = argv.includes('--write');
const file = path.resolve(ROOT, argv.find((a) => a !== '--write') || path.join('docs', 'data.json'));

const localDate = (ts) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(ts * 1000)); // YYYY-MM-DD
/* игровой день: с 00:00 до 02:59 — предыдущий календарный день */
const gameDate = (ts) => {
  const hour = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts * 1000)));
  if (hour >= 3) return localDate(ts);
  const [y, m, d] = localDate(ts).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};
const hm = (ts) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ts * 1000));

const data = JSON.parse(readFileSync(file, 'utf8'));

let changed = 0;
for (const e of data.entries) {
  if (e.demo || !e.ts) continue;
  const nd = gameDate(e.ts);
  if (nd === e.date) continue;
  console.log(`дата: ${e.date} → ${nd}  (${e.nick}, ${e.raw}, отправлено ${hm(e.ts)} МСК)`);
  e.date = nd;
  changed++;
}

/* после пересчёта могли совпасть игрок+день (скрин до и после 03:00) —
 * оставляем максимальный урон, как показывает сайт */
let deduped = 0;
const kept = [];
const idx = new Map();
for (const e of data.entries) {
  if (e.demo || !e.ts) { kept.push(e); continue; }
  const k = `${e.tgId}|${e.date}`;
  if (!idx.has(k)) { idx.set(k, kept.length); kept.push(e); continue; }
  const cur = kept[idx.get(k)];
  deduped++;
  console.log(`дубль ${e.nick} за ${e.date}: оставляю ${Math.max(e.dmg, cur.dmg) === e.dmg ? e.raw : cur.raw}, убираю меньший`);
  if (e.dmg > cur.dmg) kept[idx.get(k)] = e;
}
data.entries = kept;

console.log(`\nзаписей: ${data.entries.length}, дат исправлено: ${changed}, дублей убрано: ${deduped}`);
if (!write) {
  console.log('сухой прогон — файл не изменён. Применить: node scripts/fix-entry-dates.mjs --write');
} else {
  data.updatedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`записано: ${path.relative(ROOT, file)}\nзакоммить и запушь (или это сделает бот при следующем апдейте)`);
}
