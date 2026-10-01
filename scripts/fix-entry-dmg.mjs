#!/usr/bin/env node
/** Разовое исправление записи #368 (Donmaxone, 2026-10-01): бот записал урон
 * «БАЗУКИ» с центра подиума топ-1 (417.64T) вместо урона игрока. Правильное
 * значение 53.71T видно на пруфе proofs/p_368.jpg дважды (подиум справа и
 * закреплённая строка игрока) и подтверждено повторным прогоном OCR после
 * фикса ассоциации «ник → урон» в ocr.mjs (регрессия 70/71, единственный BAD —
 * эта запись).
 *
 * Запуск:
 *   node scripts/fix-entry-dmg.mjs            — сухой прогон, только отчёт
 *   node scripts/fix-entry-dmg.mjs --write    — применить и записать data.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const file = path.join(ROOT, 'docs', 'data.json');
const write = process.argv.includes('--write');

const ID = '368';
const OLD = { dmg: 417640000000000, raw: '417.64T' };
const NEW = { dmg: 53710000000000, raw: '53.71T' };

const data = JSON.parse(readFileSync(file, 'utf8'));
const e = data.entries.find((x) => x.id === ID && !x.demo);
if (!e) { console.error(`запись #${ID} не найдена`); process.exit(1); }
if (e.dmg !== OLD.dmg || e.raw !== OLD.raw) {
  console.error(`запись #${ID} уже не ${OLD.raw} (сейчас ${e.raw}) — проверь вручную`);
  process.exit(1);
}
console.log(`#${ID} ${e.nick} ${e.date}: ${e.raw} → ${NEW.raw}`);
e.dmg = NEW.dmg;
e.raw = NEW.raw;
if (!write) {
  console.log('сухой прогон — файл не изменён. Применить: node scripts/fix-entry-dmg.mjs --write');
} else {
  data.updatedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('записано: docs/data.json\nзакоммить и запушь (бот на VPS подхватит при перезапуске)');
}
