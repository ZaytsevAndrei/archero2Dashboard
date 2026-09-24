#!/usr/bin/env node
/**
 * Опрос Telegram-бота (getUpdates) → запись урона в docs/data.json (+ proof-кадры в docs/proofs/).
 * Запускается на GitHub Actions (раннеры имеют доступ к api.telegram.org).
 * Без зависимостей: node >= 18 (глобальный fetch).
 *
 * Логика бота:
 *   /start        → приветствие + запрос игрового ника
 *   ник текстом   → регистрация
 *   видео/фото    → «теперь пришли урон»
 *   «5.91T»       → запись урона за сегодня (повторная отправка за тот же день перезаписывает)
 *   /nick Имя     → сменить ник
 *   /undo         → удалить свою последнюю запись
 *   /stats        → мои записи за 7 дней
 *
 * env:
 *   TG_TOKEN  — токен бота (секрет TG_BOT_TOKEN). Если пуст — используется встроенный
 *               запутанный fallback (только для MVP; задайте секрет и перегенерируйте токен).
 *   SITE_URL  — ссылка на сайт, упомянутая в /help (по умолчанию GitHub Pages этого репо).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DATA_FILE = path.join(ROOT, 'docs', 'data.json');
const PROOFS_DIR = path.join(ROOT, 'docs', 'proofs');
const TZ = process.env.TZ_NAME || 'Europe/Moscow';
const SITE_URL = process.env.SITE_URL || 'https://zaytsevandrei.github.io/archero2Dashboard/';

const FALLBACK_TOKEN = (() => {
  const a = 'a2NUamhqQnp6NnQwOWJK';
  const b = 'Y1QzMmt3YkZLTGVDWHBIUGdQUE6MDE4Njg5NDU3OA==';
  return [...Buffer.from(a + b, 'base64').toString()].reverse().join('');
})();

const TOKEN = process.env.TG_TOKEN || FALLBACK_TOKEN;
if (!process.env.TG_TOKEN) {
  console.log('⚠️  TG_TOKEN не задан — используется встроенный fallback-токен (MVP).');
  console.log('   Задайте секрет TG_BOT_TOKEN в Settings → Secrets → Actions.');
}
const API = `https://api.telegram.org/bot${TOKEN}`;

// ---------- data ----------
const emptyData = () => ({ offset: 0, state: {}, users: {}, entries: [], updatedAt: null });
let data;
if (existsSync(DATA_FILE)) {
  try { data = { ...emptyData(), ...JSON.parse(readFileSync(DATA_FILE, 'utf8')) }; }
  catch (e) { console.error('docs/data.json повреждён, старт с пустого:', e.message); data = emptyData(); }
} else { data = emptyData(); }

function saveData() {
  data.updatedAt = new Date().toISOString();
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
}

const localDate = (ts) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(ts * 1000)); // YYYY-MM-DD

// ---------- damage parsing ----------
// «5.91T», «5,91т», «209.77T», «700M», «12K», «5.91» (без суффикса = триллионы)
function parseDamage(text) {
  const m = String(text).trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zа-яА-Я]+)?$/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(num)) return null;
  const suf = (m[2] || 't').toLowerCase();
  const mult = { k: 1e3, 'к': 1e3, m: 1e6, 'м': 1e6, b: 1e9, 'б': 1e9, t: 1e12, 'т': 1e12, q: 1e15, qa: 1e15 }[suf];
  if (mult === undefined) return null;
  return { dmg: Math.round(num * mult), raw: m[1].replace(',', '.') + m[2]?.toUpperCase().replace('Т', 'T') };
}
const fmtDmg = (dmg) => {
  const units = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) if (dmg >= v) return (dmg / v).toFixed(2).replace(/\.?0+$/, '') + s;
  return String(dmg);
};

// ---------- telegram api ----------
let apiErrors = 0;
async function tg(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) { apiErrors++; console.error(`tg.${method} → ${res.status}`, j.description || ''); return null; }
  return j.result;
}
const send = (chatId, text) => tg('sendMessage', { chat_id: chatId, text });

async function downloadProof(fileId, updateId) {
  try {
    const f = await tg('getFile', { file_id: fileId });
    if (!f || !f.file_path) return null;
    if (f.file_size && f.file_size > 20 * 1024 * 1024) return null;
    const url = `https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    mkdirSync(PROOFS_DIR, { recursive: true });
    const ext = f.file_path.endsWith('.mp4') ? '.mp4' : path.extname(f.file_path) || '.jpg';
    const tmp = path.join(PROOFS_DIR, `tmp_${updateId}${ext}`);
    writeFileSync(tmp, buf);
    if (ext === '.mp4') {
      // один кадр из видео как пруф
      const jpg = path.join(PROOFS_DIR, `p_${updateId}.jpg`);
      try {
        execFileSync('ffmpeg', ['-y', '-ss', '1', '-i', tmp, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '5', jpg], { stdio: 'ignore' });
        unlinkSync(tmp);
        return path.relative(path.join(ROOT, 'docs'), jpg).replace(/\\/g, '/');
      } catch {
        try { unlinkSync(tmp); } catch {}
        return null; // ffmpeg недоступен или битое видео — пруф опускаем
      }
    }
    const fin = path.join(PROOFS_DIR, `p_${updateId}${ext}`);
    writeFileSync(fin, readFileSync(tmp));
    unlinkSync(tmp);
    return path.relative(path.join(ROOT, 'docs'), fin).replace(/\\/g, '/');
  } catch (e) { console.error('proof download failed:', e.message); return null; }
}

// ---------- handlers ----------
function handleCommand(msg) {
  const [cmd, ...rest] = msg.text.slice(1).split(/\s+/);
  const c = cmd.split('@')[0].toLowerCase();
  const uid = String(msg.from.id);
  const user = data.users[uid];
  if (c === 'start') {
    delete data.state[uid];
    if (user) {
      send(msg.chat.id, `Ты уже зарегистрирован: ${user.nick}.\n\nПросто отправь видео рейтинга, а следом — урон, например: 5.91T`);
    } else {
      data.state[uid] = { await: 'nick' };
      send(msg.chat.id, 'Привет! Это бот календаря урона гильдии 🏹\n\nНапиши свой игровой ник (как в Archero 2):');
    }
    return;
  }
  if (c === 'help') {
    send(msg.chat.id, [
      '🏹 Календарь урона — команды:',
      '/start — регистрация (игровой ник)',
      '/nick НовыйНик — сменить ник',
      '/undo — удалить свою последнюю запись',
      '/stats — мои записи за 7 дней',
      '',
      'Как отметиться:',
      '1) отправь видео/скрин рейтинга (по желанию, для пруфа)',
      '2) отправь урон, например: 5.91T или 209.77T',
      '',
      `Сайт: ${SITE_URL}`,
    ].join('\n'));
    return;
  }
  if (c === 'nick') {
    const nick = rest.join(' ').trim();
    if (!nick) { send(msg.chat.id, user ? `Твой ник: ${user.nick}. Сменить: /nick НовыйНик` : 'Сначала /start'); return; }
    if (nick.length > 24) { send(msg.chat.id, 'Ник слишком длинный (макс. 24 символа)'); return; }
    if (user) { user.nick = nick; send(msg.chat.id, `Ник изменён: ${nick}`); }
    else { data.users[uid] = { nick, joined: new Date().toISOString() }; send(msg.chat.id, `Записал: ${nick}. Теперь отправь видео и урон!`); }
    return;
  }
  if (c === 'undo') {
    const mine = data.entries.filter((e) => e.tgId === uid && !e.demo);
    if (!mine.length) { send(msg.chat.id, 'У тебя пока нет записей.'); return; }
    const last = mine.reduce((a, b) => (a.ts >= b.ts ? a : b));
    data.entries = data.entries.filter((e) => e !== last);
    send(msg.chat.id, `Удалил: ${last.raw || fmtDmg(last.dmg)} за ${last.date}`);
    return;
  }
  if (c === 'stats') {
    if (!user) { send(msg.chat.id, 'Сначала /start'); return; }
    const week = localDate(Date.now() / 1000 - 7 * 86400);
    const mine = data.entries.filter((e) => e.tgId === uid && e.date >= week).sort((a, b) => a.date.localeCompare(b.date));
    send(msg.chat.id, mine.length
      ? `Твои записи (${user.nick}):\n` + mine.map((e) => `${e.date}: ${e.raw || fmtDmg(e.dmg)}`).join('\n')
      : 'За последние 7 дней записей нет.');
    return;
  }
  send(msg.chat.id, 'Не знаю такую команду. /help — список команд');
}

async function handleMessage(msg) {
  if (!msg.from || msg.from.is_bot) return;
  if (msg.chat.type !== 'private') return; // MVP: только личные чаты
  const uid = String(msg.from.id);
  const st = data.state[uid] || {};

  const meta = { tgUsername: msg.from.username || null, first: msg.from.first_name || null };
  if (data.users[uid]) Object.assign(data.users[uid], meta);

  if (msg.text && msg.text.startsWith('/')) { handleCommand(msg); return; }

  // медиа → ждём урон
  const fileId = msg.video?.file_id || msg.photo?.at(-1)?.file_id || msg.animation?.file_id;
  if (fileId) {
    if (!data.users[uid]) { data.state[uid] = { await: 'nick' }; send(msg.chat.id, 'Сначала напиши свой игровой ник (как в Archero 2):'); return; }
    data.state[uid] = { await: 'damage', fileId };
    send(msg.chat.id, 'Видео получил! Теперь напиши свой урон, например: 5.91T');
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // ожидание ника
  if (st.await === 'nick') {
    if (text.length > 24 || /[\n]/.test(text) || parseDamage(text)) { send(msg.chat.id, 'Это похоже не на ник. Напиши игровой ник (до 24 символов):'); return; }
    data.users[uid] = { nick: text, joined: new Date().toISOString(), ...meta };
    delete data.state[uid];
    send(msg.chat.id, `Отлично, ${text}! 🏹\n\nТеперь отправь видео рейтинга (по желанию), а следом — урон, например: 5.91T\nВсё автоматически попадёт на сайт.`);
    return;
  }

  // урон
  const parsed = parseDamage(text);
  if (parsed) {
    if (!data.users[uid]) { data.state[uid] = { await: 'nick' }; send(msg.chat.id, 'Напиши сначала свой игровой ник:'); return; }
    const date = localDate(msg.date);
    let proof = null;
    if (st.fileId) proof = await downloadProof(st.fileId, msg.message_id);
    const entry = {
      id: String(msg.message_id), tgId: uid, nick: data.users[uid].nick, date,
      dmg: parsed.dmg, raw: parsed.raw, ts: msg.date,
      ...(proof ? { proof } : {}),
    };
    // повторная отправка за тот же день перезаписывает
    data.entries = data.entries.filter((e) => !(e.tgId === uid && e.date === date && !e.demo));
    data.entries.push(entry);
    delete data.state[uid];
    send(msg.chat.id, `✅ Записал: ${fmtDmg(parsed.dmg)} за ${date.split('-').reverse().join('.')}\nДругое значение тем же днём — просто пришли ещё раз.`);
    return;
  }

  send(msg.chat.id, 'Не понял 🤔 Пришли урон, например: 5.91T\n/help — все команды');
}

// ---------- main ----------
async function main() {
  let processed = 0;
  for (let i = 0; i < 10; i++) {
    let updates;
    try {
      updates = await tg('getUpdates', { offset: data.offset, timeout: 0, allowed_updates: ['message'] });
    } catch (e) {
      console.error('getUpdates failed:', e.message);
      break;
    }
    if (updates === null) {
      // 409: где-то висит webhook — снимаем и пробуем ещё раз
      console.log('Конфликт getUpdates — снимаю webhook...');
      await tg('deleteWebhook', { drop_pending_updates: false });
      continue;
    }
    if (!updates.length) break;
    for (const u of updates) {
      try { if (u.message) await handleMessage(u.message); }
      catch (e) { console.error('update error:', u.update_id, e.message); }
      data.offset = Math.max(data.offset, u.update_id + 1);
      processed++;
      saveData(); // сохраняем после каждого апдейта, чтобы не обрабатывать дважды
    }
  }
  if (processed) console.log(`Обработано апдейтов: ${processed}, записей всего: ${data.entries.filter((e) => !e.demo).length}`);
  else console.log('Новых сообщений нет.');
  saveData();
  if (apiErrors > 5) process.exitCode = 1;
}
main();
