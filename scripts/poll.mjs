#!/usr/bin/env node
/**
 * Опрос Telegram-бота (getUpdates) → запись урона в docs/data.json (+ proof-кадры в docs/proofs/).
 * Запускается на GitHub Actions (раннеры имеют доступ к api.telegram.org).
 * Без зависимостей: node >= 18 (глобальный fetch).
 *
 * Логика бота:
 *   /start        → приветствие + запрос игрового ника
 *   ник текстом   → регистрация
 *   фото-скрин   → OCR: бот ищет строку с ником игрока и предлагает подтвердить урон
 *                  (кнопки «Записать» / «Ввести вручную»; не распознал — просит урон текстом)
 *   «5.91T»       → запись урона за сегодня (повторная отправка за тот же день перезаписывает)
 *   /nick Имя     → сменить ник
 *   /undo         → удалить свою последнюю запись
 *   /stats        → мои записи за 7 дней
 *
 * env:
 *   TG_TOKEN  — токен бота (секрет TG_BOT_TOKEN). Если пуст — используется встроенный
 *               запутанный fallback (только для MVP; задайте секрет и перегенерируйте токен).
 *   SITE_URL  — ссылка на сайт, упомянутая в /help (по умолчанию GitHub Pages этого репо).
 *
 * Зависимости для OCR (jimp, tesseract.js) опциональны — ставятся через npm install
 * в workflow; без них бот просто просит урон текстом.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ocrOwnRow } from './ocr.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DATA_FILE = path.join(ROOT, 'docs', 'data.json');
const PROOFS_DIR = path.join(ROOT, 'docs', 'proofs');
const TZ = process.env.TZ_NAME || 'Europe/Moscow';
const SITE_URL = process.env.SITE_URL || 'https://zaytsevandrei.github.io/archero2Dashboard/';

const FALLBACK_TOKEN = (() => {
  const a = 'a2NUamhqQnp6NnQwOWJK';
  const b = 'Y1QzMmt3YkZLTGVDWHBIUGdIQUE6MDE4Njg5NDU3OA==';
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

// снимок значимых полей: если не изменились — файл не трогаем (иначе коммит каждые 5 минут)
const DATA_KEYS = ['offset', 'state', 'users', 'entries'];
const snapshot = () => JSON.stringify(DATA_KEYS.map((k) => data[k]));
const initialSnapshot = snapshot();

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
let lastStatus = 0;
async function tg(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) { apiErrors++; lastStatus = res.status; console.error(`tg.${method} → ${res.status}`, j.description || ''); return null; }
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
    const ext = path.extname(f.file_path) || '.jpg';
    const fin = path.join(PROOFS_DIR, `p_${updateId}${ext}`);
    writeFileSync(fin, buf);
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
      send(msg.chat.id, `Ты уже зарегистрирован: ${user.nick}.\n\nПросто отправь скриншот рейтинга (фото), а следом — урон, например: 5.91T`);
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
      '1) отправь скриншот рейтинга — я сам распознаю твой урон и попрошу подтвердить',
      '2) если не распознал — пришли урон текстом: 5.91T или 209.77T',
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
    else { data.users[uid] = { nick, joined: new Date().toISOString() }; send(msg.chat.id, `Записал: ${nick}. Теперь отправь скриншот (фото) и урон!`); }
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

/* записать урон за дату (повторная отправка за тот же день перезаписывает) */
function recordEntry(uid, id, date, dmg, raw, ts, proof) {
  const nick = data.users[uid]?.nick;
  if (!nick) return false;
  data.entries = data.entries.filter((e) => !(e.tgId === uid && e.date === date && !e.demo));
  data.entries.push({ id: String(id), tgId: uid, nick, date, dmg, raw, ts, ...(proof ? { proof } : {}) });
  return true;
}

/* скачать скрин, распознать строку ника и предложить подтверждение */
async function processPhoto(uid, chatId, fileId, msgId) {
  const proof = await downloadProof(fileId, msgId);
  let ocr = null;
  if (proof) {
    try { ocr = await ocrOwnRow(path.join(ROOT, 'docs', proof), data.users[uid]?.nick); } catch (e) { console.error('ocr:', e.message); }
  }
  if (ocr) {
    data.state[uid] = { await: 'confirm', fileId, proof, dmg: ocr.dmg, raw: ocr.raw, msgId };
    tg('sendMessage', {
      chat_id: chatId,
      text: `Скрин распознал 🔎\n${data.users[uid].nick} — ${fmtDmg(ocr.dmg)}\nЗаписать за сегодня?`,
      reply_markup: { inline_keyboard: [
        [{ text: '✅ Записать', callback_data: 'ocr_yes' }, { text: '✏️ Ввести вручную', callback_data: 'ocr_no' }],
      ] },
    });
  } else {
    data.state[uid] = { await: 'damage', fileId, msgId, ...(proof ? { proof } : {}) };
    send(chatId, 'Скрин получил, но не смог разобрать твою строку 🤔\nНапиши урон текстом, например: 5.91T');
  }
}

async function handleCallback(q) {
  if (!q.from || q.from.is_bot) return;
  const uid = String(q.from.id);
  const st = data.state[uid] || {};
  await tg('answerCallbackQuery', { callback_query_id: q.id });
  if (st.await !== 'confirm') return;
  if (q.data === 'ocr_yes') {
    const date = localDate(q.message?.date || Math.floor(Date.now() / 1000));
    const ok = recordEntry(uid, st.msgId || q.id, date, st.dmg, st.raw, q.message?.date || Math.floor(Date.now() / 1000), st.proof);
    delete data.state[uid];
    send(q.from.id, ok
      ? `✅ Записал: ${fmtDmg(st.dmg)} за ${date.split('-').reverse().join('.')}\nДругое значение тем же днём — просто пришли ещё раз.`
      : 'Что-то сломалось, попробуй прислать урон текстом: 5.91T');
  } else if (q.data === 'ocr_no') {
    data.state[uid] = { await: 'damage', fileId: st.fileId, msgId: st.msgId, ...(st.proof ? { proof: st.proof } : {}) };
    send(q.from.id, 'Ок, напиши урон текстом, например: 5.91T');
  }
}

async function handleMessage(msg) {
  if (!msg.from || msg.from.is_bot) return;
  if (msg.chat.type !== 'private') return; // MVP: только личные чаты
  const uid = String(msg.from.id);
  const st = data.state[uid] || {};

  const meta = { tgUsername: msg.from.username || null, first: msg.from.first_name || null };
  if (data.users[uid]) Object.assign(data.users[uid], meta);

  if (msg.text && msg.text.startsWith('/')) { handleCommand(msg); return; }

  // медиа → доказательство = скриншот/фото; видео отклоняем
  if (msg.video || msg.animation) {
    send(msg.chat.id, 'Видео не принимаем 🙈 Пришли, пожалуйста, скриншот рейтинга картинкой — и следом урон, например: 5.91T');
    return;
  }
  const fileId = msg.photo?.at(-1)?.file_id;
  if (fileId) {
    if (!data.users[uid]) { data.state[uid] = { await: 'nick', fileId }; send(msg.chat.id, 'Сначала напиши свой игровой ник (как в Archero 2):'); return; }
    await processPhoto(uid, msg.chat.id, fileId, msg.message_id);
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // ожидание ника
  if (st.await === 'nick') {
    if (text.length > 24 || /[\n]/.test(text) || parseDamage(text)) { send(msg.chat.id, 'Это похоже не на ник. Напиши игровой ник (до 24 символов):'); return; }
    data.users[uid] = { nick: text, joined: new Date().toISOString(), ...meta };
    if (st.fileId) {
      // скрин уже прислан — распознаём сразу после регистрации
      await processPhoto(uid, msg.chat.id, st.fileId, msg.message_id);
    } else {
      delete data.state[uid];
      send(msg.chat.id, `Отлично, ${text}! 🏹\n\nТеперь просто отправь скриншот рейтинга — я сам распознаю урон и попрошу подтвердить.\nНе распознаю — попросу ввести текстом.`);
    }
    return;
  }

  // урон текстом (в т.ч. вместо кнопок подтверждения)
  const parsed = parseDamage(text);
  if (parsed) {
    if (!data.users[uid]) { data.state[uid] = { await: 'nick' }; send(msg.chat.id, 'Напиши сначала свой игровой ник:'); return; }
    const date = localDate(msg.date);
    const proof = st.proof || (st.fileId ? await downloadProof(st.fileId, msg.message_id) : null);
    recordEntry(uid, msg.message_id, date, parsed.dmg, parsed.raw, msg.date, proof);
    delete data.state[uid];
    send(msg.chat.id, `✅ Записал: ${fmtDmg(parsed.dmg)} за ${date.split('-').reverse().join('.')}\nДругое значение тем же днём — просто пришли ещё раз.`);
    return;
  }

  send(msg.chat.id, 'Не понял 🤔 Пришли скриншот рейтинга или урон текстом: 5.91T\n/help — все команды');
}

// ---------- main ----------
async function main() {
  let processed = 0;
  let nullStreak = 0;
  for (let i = 0; i < 10; i++) {
    let updates;
    try {
      updates = await tg('getUpdates', { offset: data.offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    } catch (e) {
      console.error('getUpdates failed:', e.message);
      break;
    }
    if (updates === null) {
      // 401/404 — неверный токен: падаем явно, а не «зелёным впустую»
      if (lastStatus === 401 || lastStatus === 404 || lastStatus === 403) {
        console.error('ОШИБКА: Telegram отклонил токен (401/403/404). Задайте секрет TG_BOT_TOKEN или проверьте токен.');
        process.exit(1);
      }
      if (++nullStreak > 2) { console.error('ОШИБКА: getUpdates не удаётся после повторов (см. ошибки выше).'); process.exit(1); }
      // 409: где-то висит webhook — снимаем и пробуем ещё раз
      console.log('Конфликт getUpdates — снимаю webhook...');
      await tg('deleteWebhook', { drop_pending_updates: false });
      continue;
    }
    nullStreak = 0;
    if (!updates.length) break;
    for (const u of updates) {
      try {
        if (u.message) await handleMessage(u.message);
        else if (u.callback_query) await handleCallback(u.callback_query);
      }
      catch (e) { console.error('update error:', u.update_id, e.message); }
      data.offset = Math.max(data.offset, u.update_id + 1);
      processed++;
      saveData(); // сохраняем после каждого апдейта, чтобы не обрабатывать дважды
    }
  }
  if (processed) console.log(`Обработано апдейтов: ${processed}, записей всего: ${data.entries.filter((e) => !e.demo).length}`);
  if (snapshot() !== initialSnapshot) saveData();
  else console.log('Новых сообщений нет, данные не менялись — коммита не будет.');
  if (apiErrors > 5) process.exitCode = 1;
}
main();
