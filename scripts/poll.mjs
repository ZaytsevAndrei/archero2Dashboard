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
import { spawnSync } from 'node:child_process';
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
  const sufRaw = (m[2] || 'T').toUpperCase().replace('Т', 'T'); // без суффикса считаем триллионами
  return { dmg: Math.round(num * mult), raw: m[1].replace(',', '.') + sufRaw };
}
const fmtDmg = (dmg) => {
  const units = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) if (dmg >= v) return (dmg / v).toFixed(2).replace(/\.?0+$/, '') + s;
  return String(dmg);
};

// ---------- telegram api ----------
let apiErrors = 0;
let lastStatus = 0;
async function tg(method, params = {}, retries = 3) {
  let res;
  try {
    res = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    });
  } catch (e) {
    // сетевой сбой не должен ронять процесс; у нашего хостера первое TLS-соединение
    // к Telegram периодически виснет и проходит только повтором — ретраим с нарастающей паузой
    apiErrors++; lastStatus = 0; console.error(`tg.${method} → network:`, e.message);
    if (retries > 0) { await sleep(1200 * 2 ** (3 - retries)); return tg(method, params, retries - 1); }
    return null;
  }
  const j = await res.json().catch(() => ({}));
  if (!j.ok) { apiErrors++; lastStatus = res.status; console.error(`tg.${method} → ${res.status}`, j.description || ''); return null; }
  return j.result;
}
const send = (chatId, text) => tg('sendMessage', { chat_id: chatId, text });

async function downloadProof(fileId, updateId) {
  for (let round = 1; round <= 2; round++) {
    try {
      const f = await tg('getFile', { file_id: fileId });
      if (!f || !f.file_path) return null;
      if (f.file_size && f.file_size > 20 * 1024 * 1024) return null;
      const url = `https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`file HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(PROOFS_DIR, { recursive: true });
      const ext = path.extname(f.file_path) || '.jpg';
      const fin = path.join(PROOFS_DIR, `p_${updateId}${ext}`);
      writeFileSync(fin, buf);
      return path.relative(path.join(ROOT, 'docs'), fin).replace(/\\/g, '/');
    } catch (e) { console.error(`proof download (round ${round}) failed:`, e.message); }
  }
  return null;
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
      send(msg.chat.id, `Ты уже зарегистрирован: ${user.nick}.\n\nОтправь скриншот рейтинга — урон я распознаю сам.`);
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
      'отправь скриншот рейтинга — я сам распознаю твой урон и попрошу подтвердить',
      '(не разберу — попрошу скрин получше)',
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
    else { data.users[uid] = { nick, joined: new Date().toISOString() }; send(msg.chat.id, `Записал: ${nick}. Теперь отправь скриншот рейтинга — урон я определю сам.`); }
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
        [{ text: '✅ Записать', callback_data: 'ocr_yes' }],
      ] },
    });
  } else {
    delete data.state[uid];
    send(chatId, 'Скрин получил, но не смог разобрать твою строку 🤔\nПришли скриншот ещё раз — чётче и покрупнее: весь экран рейтинга после боя, без обрезки краёв.');
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
    // кнопка «Ввести вручную» удалена; на старых сообщениях — вежливо перенаправляем
    delete data.state[uid];
    send(q.from.id, 'Ручной ввод убрали — пришли скриншот получше, и я распознаю урон сам.');
  }
}

async function handleMessage(msg) {
  if (!msg.from || msg.from.is_bot) return; // посты самого канала без автора пропускаем
  // Личные чаты — полный диалог (регистрация, подсказки); общий чат гильдии —
  // скриншоты и урон числом, игроки с ником Telegram = игровой ник регистрируются сами
  const uid = String(msg.from.id);
  const group = msg.chat.type !== 'private';
  const st = data.state[uid] || {};

  const meta = { tgUsername: msg.from.username || null, first: msg.from.first_name || null };
  if (data.users[uid]) Object.assign(data.users[uid], meta);

  if (msg.text && msg.text.startsWith('/')) {
    if (group) return; // команды и диалог регистрации — в личке, в общем чате не шумим
    handleCommand(msg); return;
  }

  // медиа → доказательство = скриншот/фото; видео отклоняем
  if (msg.video || msg.animation) {
    send(msg.chat.id, 'Видео не принимаем 🙈 Пришли скриншот рейтинга картинкой — урон я распознаю сам.');
    return;
  }
  const fileId = msg.photo?.at(-1)?.file_id;
  if (fileId) {
    if (!data.users[uid]) {
      if (group && msg.from.username) {
        data.users[uid] = { nick: msg.from.username, joined: new Date().toISOString(), ...meta };
        send(msg.chat.id, `@${msg.from.username}, записал тебя как «${msg.from.username}» (совпало с ником Telegram). Если игровой ник другой — /nick НовыйНик мне в личку.`);
      } else if (group) {
        send(msg.chat.id, 'Зарегистрируйся у меня в личке: @Archero2Unity_bot → /start (и сразу кидай скрины сюда)');
        return;
      } else {
        data.state[uid] = { await: 'nick', fileId };
        send(msg.chat.id, 'Сначала напиши свой игровой ник (как в Archero 2):');
        return;
      }
    }
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
      send(msg.chat.id, `Отлично, ${text}! 🏹\n\nТеперь просто отправляй скриншот рейтинга — я сам распознаю урон и попрошу подтвердить.`);
    }
    return;
  }

  // ручной ввод урона отключён — запись только со скриншота
  if (parseDamage(text)) {
    if (!group) send(msg.chat.id, 'Числа больше не принимаю 🙈 Пришли скриншот рейтинга — урон распознаю с него.');
    return;
  }

  if (!group) send(msg.chat.id, 'Не понял 🤔 Пришли скриншот рейтинга — урон я распознаю сам.\n/help — все команды');
}

// ---------- запуск: разовый (Actions) или непрерывный (VPS, BOT_LOOP=1) ----------
async function main() {
  let processed = 0;
  let nullStreak = 0;
  for (let i = 0; i < 10; i++) {
    let updates;
    try {
      updates = await tg('getUpdates', { offset: data.offset, timeout: 0, allowed_updates: ['message', 'callback_query', 'channel_post'] });
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
        if (u.message || u.channel_post) await handleMessage(u.message || u.channel_post);
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

/* закоммитить и запушить данные (непрерывный режим: сайт на Pages обновится сам) */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) console.error(`git ${args.join(' ')} →`, (r.stderr || '').trim().slice(0, 200));
  return r.status === 0;
}
let pushing = false;
async function pushData() {
  if (pushing) return;
  pushing = true;
  try {
    git(['add', '-A', 'docs/']);
    if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT }).status === 0) return; // нечего коммитить
    if (!git(['commit', '-m', 'data: update from telegram bot'])) return;
    for (let i = 0; i < 3 && !git(['push']); i++) git(['pull', '--rebase', 'origin', 'main']);
  } finally { pushing = false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* непрерывный long polling: сообщения подхватываются за секунды, а не раз в 5 минут */
async function loop() {
  console.log(`[bot] непрерывный опрос запущен (${new Date().toISOString()}, TZ=${TZ})`);
  for (;;) {
    let updates = null;
    try {
      updates = await tg('getUpdates', { offset: data.offset, timeout: 50, allowed_updates: ['message', 'callback_query', 'channel_post'] });
    } catch (e) { console.error('[bot] getUpdates:', e.message); }
    if (updates === null) {
      if (lastStatus === 401 || lastStatus === 404 || lastStatus === 403) {
        console.error('[bot] Telegram отклонил токен — останавливаюсь.'); process.exit(1);
      }
      console.log('[bot] сбой/конфликт getUpdates — снимаю webhook, повтор через 3 с');
      await tg('deleteWebhook', { drop_pending_updates: false });
      await sleep(3000);
      continue;
    }
    if (!updates.length) continue;
    let n = 0;
    for (const u of updates) {
      try {
        if (u.message || u.channel_post) await handleMessage(u.message || u.channel_post);
        else if (u.callback_query) await handleCallback(u.callback_query);
        n++;
      } catch (e) { console.error('[bot] update error:', u.update_id, e.message); }
      data.offset = Math.max(data.offset, u.update_id + 1);
      saveData();
    }
    console.log(`[bot] обработано ${n}, записей всего: ${data.entries.filter((e) => !e.demo).length}`);
    await pushData();
  }
}

if (process.env.BOT_LOOP) loop();
else main();
