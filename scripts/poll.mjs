#!/usr/bin/env node
/**
 * Опрос Telegram-бота (getUpdates) → запись урона в docs/data.json (+ proof-кадры в docs/proofs/).
 * Запускается на GitHub Actions (раннеры имеют доступ к api.telegram.org).
 * Без зависимостей: node >= 18 (глобальный fetch).
 *
 * Логика бота:
 *   /start        → приветствие + запрос игрового ника, затем клана (Unity / Unity2)
 *   ник текстом   → регистрация
 *   клан кнопкой  → выбор клана: при регистрации, /clan — сменить; кроме того,
 *                  с CLAN_ASK_FROM при первом фото каждый игрок уточняет клан
 *                  ещё раз (один раз — игроки разошлись по разным кланам)
 *   фото-скрин   → OCR: бот ищет строку с ником игрока и сразу записывает урон
 *                  (не распознал — просит скрин получше); в ответе о записанном
 *                  уроне перечислены команды бота
 *   /nick Имя     → сменить ник
 *   /clan         → указать/сменить клан (Unity / Unity2)
 *   /lang         → язык бота (авто по языку клиента Telegram: ru / en)
 *   /undo         → удалить свою последнюю запись
 *   /stats        → мои записи за 7 дней
 *
 * Язык реплик определяется автоматически по from.language_code (клиент Telegram),
 * запоминается в users[uid].lang при первом контакте и меняется через /lang.
 * Строки и словарь ru/en — в scripts/i18n.mjs.
 *
 * env:
 *   TG_TOKEN  — токен бота (секрет TG_BOT_TOKEN). Если пуст — используется встроенный
 *               запутанный fallback (только для MVP; задайте секрет и перегенерируйте токен).
 *   SITE_URL  — ссылка на сайт, упомянутая в /help (по умолчанию GitHub Pages этого репо).
 *
 * Зависимости для OCR (jimp, tesseract.js) опциональны — ставятся через npm install
 * в workflow; без них бот просто просит урон текстом.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ocrOwnRow } from './ocr.mjs';
import { normLang, t } from './i18n.mjs';

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

// ---------- clans ----------
const CLANS = { unity: 'Unity', unity2: 'Unity2' };
/* Игроки разошлись по разным кланам. Весь урон, записанный до 2026-10-07, по
 * решению владельца относится к Unity2; записи начиная с этого дня несут клан
 * из ответа игрока. Миграция идемпотентна, сохранится при первом же апдейте. */
const CLAN_ASK_FROM = '2026-10-07'; // с этого игрового дня при первом фото уточняем клан (один раз)
for (const e of data.entries) if (!e.clan || e.date < CLAN_ASK_FROM) e.clan = 'unity2';

/* язык игрока: сохранённый, иначе — язык клиента Telegram (кириллические → ru,
 * остальные → en), иначе русский */
const pickLang = (uid, from) => data.users[uid]?.lang || normLang(from?.language_code) || 'ru';

/* Игровой день длится с 03:00 до 03:00: урон, присланный с 00:00 до 02:59,
 * относится к предыдущему календарному дню */
const gameDate = (ts) => {
  const hour = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts * 1000)));
  if (hour >= 3) return localDate(ts);
  const [y, m, d] = localDate(ts).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

/* нужно ли уточнить клан при очередном сообщении: с CLAN_ASK_FROM каждый игрок
 * подтверждает клан один раз (clanCheck — игровой день последнего подтверждения) */
const needClanCheck = (uid) =>
  gameDate(Date.now() / 1000) >= CLAN_ASK_FROM && !!data.users[uid]
  && (!data.users[uid].clanCheck || data.users[uid].clanCheck < CLAN_ASK_FROM);

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

/* пруфы старше 7 дней удаляем (файл + ссылка в записи): записи урона остаются,
 * картинки тяжёлые — репозиторий не должен пухнуть. 7 дней считаем включительно:
 * сегодня + 6 дней назад; с 8-го дня пруфа нет */
function pruneProofs() {
  const keepFrom = gameDate(Date.now() / 1000 - 6 * 86400);
  const keep = new Set();
  for (const e of data.entries) {
    if (!e.proof) continue;
    if (e.date >= keepFrom) keep.add(path.basename(e.proof));
    else delete e.proof;
  }
  let removed = 0;
  if (!existsSync(PROOFS_DIR)) return removed;
  for (const f of readdirSync(PROOFS_DIR)) {
    if (keep.has(f) || !/^p_.+\.(jpe?g|png|webp)$/i.test(f)) continue; // .gitkeep и прочее не трогаем
    const p = path.join(PROOFS_DIR, f);
    try {
      // осиротевшие файлы (перезапись за тот же день, неудачный OCR) больше никому не нужны —
      // удаляем сразу, но даём 30 минут на случай ещё идущей обработки скрина
      if (Date.now() - statSync(p).mtimeMs < 30 * 60e3) continue;
      unlinkSync(p); removed++;
    } catch (e) { console.error('prune unlink:', f, e.message); }
  }
  if (removed) console.log(`prune: удалено пруфов: ${removed}`);
  return removed;
}

// ---------- handlers ----------
/* вопрос о клане (кнопки): при регистрации спрашиваем один раз, /clan — сменить,
 * reask — перепроверка при первом фото с CLAN_ASK_FROM (другая формулировка) */
function askClan(chatId, lang, reask = false) {
  tg('sendMessage', {
    chat_id: chatId,
    text: t(lang, reask ? 'askClanRe' : 'askClan'),
    reply_markup: {
      inline_keyboard: [[
        { text: 'UNITY', callback_data: 'clan:unity' },
        { text: 'UNITY2', callback_data: 'clan:unity2' },
      ]],
    },
  });
}

/* смена языка кнопкой (/lang); только для зарегистрированных — иначе выбор
 * затёрся бы автоопределением при регистрации */
function askLang(chatId) {
  tg('sendMessage', {
    chat_id: chatId,
    text: t('ru', 'askLang'),
    reply_markup: {
      inline_keyboard: [[
        { text: '🇷🇺 Русский', callback_data: 'lang:ru' },
        { text: '🇬🇧 English', callback_data: 'lang:en' },
      ]],
    },
  });
}

function handleCommand(msg) {
  const [cmd, ...rest] = msg.text.slice(1).split(/\s+/);
  const c = cmd.split('@')[0].toLowerCase();
  const uid = String(msg.from.id);
  const user = data.users[uid];
  const lang = pickLang(uid, msg.from);
  if (c === 'start') {
    delete data.state[uid];
    if (user) {
      if (!user.clan) {
        // зарегистрирован до появления второго клана — уточняем клан один раз
        data.state[uid] = { await: 'clan' };
        send(msg.chat.id, t(lang, 'welcomeBack', { nick: user.nick }));
        askClan(msg.chat.id, lang);
      } else {
        send(msg.chat.id, t(lang, 'alreadyRegistered', { nick: user.nick, clan: CLANS[user.clan] }));
      }
    } else {
      data.state[uid] = { await: 'nick' };
      send(msg.chat.id, t(lang, 'startNew'));
    }
    return;
  }
  if (c === 'help') {
    send(msg.chat.id, t(lang, 'help', { url: SITE_URL }));
    return;
  }
  if (c === 'nick') {
    const nick = rest.join(' ').trim();
    if (!nick) { send(msg.chat.id, user ? t(lang, 'nickShow', { nick: user.nick }) : t(lang, 'notRegistered')); return; }
    if (nick.length > 24) { send(msg.chat.id, t(lang, 'nickTooLong')); return; }
    if (user) { user.nick = nick; send(msg.chat.id, t(lang, 'nickChanged', { nick })); }
    else {
      data.users[uid] = { nick, joined: new Date().toISOString(), lang };
      data.state[uid] = { await: 'clan' };
      send(msg.chat.id, t(lang, 'nickSaved', { nick }));
      askClan(msg.chat.id, lang);
    }
    return;
  }
  if (c === 'clan') {
    if (!user) { send(msg.chat.id, t(lang, 'notRegistered')); return; }
    data.state[uid] = { await: 'clan' };
    askClan(msg.chat.id, lang);
    return;
  }
  if (c === 'lang') {
    if (!user) { send(msg.chat.id, t(lang, 'notRegistered')); return; }
    askLang(msg.chat.id);
    return;
  }
  if (c === 'undo') {
    const mine = data.entries.filter((e) => e.tgId === uid && !e.demo);
    if (!mine.length) { send(msg.chat.id, t(lang, 'undoNone')); return; }
    const last = mine.reduce((a, b) => (a.ts >= b.ts ? a : b));
    data.entries = data.entries.filter((e) => e !== last);
    send(msg.chat.id, t(lang, 'undoDone', { raw: last.raw || fmtDmg(last.dmg), date: last.date }));
    return;
  }
  if (c === 'stats') {
    if (!user) { send(msg.chat.id, t(lang, 'notRegistered')); return; }
    const week = gameDate(Date.now() / 1000 - 7 * 86400);
    const mine = data.entries.filter((e) => e.tgId === uid && e.date >= week).sort((a, b) => a.date.localeCompare(b.date));
    const head = user.clan
      ? t(lang, 'statsHead', { nick: user.nick, clan: CLANS[user.clan] })
      : t(lang, 'statsHeadPlain', { nick: user.nick });
    send(msg.chat.id, mine.length
      ? `${head}\n` + mine.map((e) => `${e.date}: ${e.raw || fmtDmg(e.dmg)}`).join('\n')
      : t(lang, 'statsEmpty'));
    return;
  }
  send(msg.chat.id, t(lang, 'unknownCommand'));
}

/* записать урон за дату (повторная отправка за тот же день перезаписывает) */
function recordEntry(uid, id, date, dmg, raw, ts, proof) {
  const u = data.users[uid];
  if (!u?.nick) return false;
  data.entries = data.entries.filter((e) => !(e.tgId === uid && e.date === date && !e.demo));
  data.entries.push({ id: String(id), tgId: uid, nick: u.nick, date, dmg, raw, ts, clan: u.clan || 'unity2', ...(proof ? { proof } : {}) });
  return true;
}

/* скачать скрин, распознать строку ника и сразу записать урон (без подтверждения) */
async function processPhoto(uid, chatId, fileId, msgId, msgDate) {
  const lang = data.users[uid]?.lang || 'ru';
  const proof = await downloadProof(fileId, msgId);
  let ocr = null;
  if (proof) {
    try { ocr = await ocrOwnRow(path.join(ROOT, 'docs', proof), data.users[uid]?.nick); } catch (e) { console.error('ocr:', e.message); }
  }
  if (!ocr) {
    delete data.state[uid];
    send(chatId, t(lang, 'ocrFail'));
    return;
  }
  const ts = msgDate || Math.floor(Date.now() / 1000);
  const date = gameDate(ts);
  const ok = recordEntry(uid, msgId, date, ocr.dmg, ocr.raw, ts, proof);
  delete data.state[uid];
  send(chatId, ok
    ? t(lang, 'recorded', {
      nick: data.users[uid].nick, dmg: fmtDmg(ocr.dmg),
      date: date.split('-').reverse().join('.'), clan: CLANS[data.users[uid]?.clan || 'unity2'],
    }) + '\n\n' + t(lang, 'commandsList')
    : t(lang, 'broken'));
}

/* кнопки: выбор клана (clan:*) и языка (lang:*); на нажатия старых «Записать» —
 * перенаправляем на новый сценарий */
async function handleCallback(q) {
  if (!q.from || q.from.is_bot) return;
  await tg('answerCallbackQuery', { callback_query_id: q.id });
  const uid = String(q.from.id);
  const lang = pickLang(uid, q.from);
  if (q.data?.startsWith('clan:')) {
    const clan = q.data.slice(5);
    if (!CLANS[clan] || !data.users[uid]?.nick) return; // кнопка без регистрации — игнорируем
    const had = data.users[uid].clan;
    data.users[uid].clan = clan;
    data.users[uid].clanCheck = gameDate(Date.now() / 1000); // клан подтверждён — до новой кампании не спрашиваем
    if (!data.users[uid].lang) data.users[uid].lang = lang; // язык могли ещё не запомнить
    const st = data.state[uid];
    delete data.state[uid];
    const chatId = q.message?.chat?.id || uid;
    send(chatId, st?.reask
      ? t(lang, 'clanConfirm', { clan: CLANS[clan] })
      : had ? t(lang, 'clanChanged', { clan: CLANS[clan] }) : t(lang, 'clanSet', { clan: CLANS[clan] }));
    if (st?.await === 'clan' && st.fileId) {
      // скрин был прислан до ответа — распознаём сразу
      await processPhoto(uid, chatId, st.fileId, st.msgId, st.msgDate);
    }
    return;
  }
  if (q.data?.startsWith('lang:')) {
    const newLang = q.data.slice(5);
    if (newLang !== 'ru' && newLang !== 'en') return;
    if (!data.users[uid]?.nick) return; // без регистрации выбор затёрся бы автоопределением
    data.users[uid].lang = newLang;
    const chatId = q.message?.chat?.id || uid;
    send(chatId, t(newLang, newLang === 'ru' ? 'langSetRu' : 'langSetEn'));
    return;
  }
  delete data.state[uid];
  tg('sendMessage', {
    chat_id: q.from.id,
    text: t(lang, 'legacyButton'),
  });
}

async function handleMessage(msg) {
  if (!msg.from || msg.from.is_bot) return; // посты самого канала без автора пропускаем
  // Личные чаты — полный диалог (регистрация, подсказки); общий чат гильдии —
  // скриншоты и урон числом, игроки с ником Telegram = игровой ник регистрируются сами
  const uid = String(msg.from.id);
  const group = msg.chat.type !== 'private';
  const st = data.state[uid] || {};

  // автоопределение языка от Telegram: запоминаем один раз, молча (меняется через /lang)
  const lang = pickLang(uid, msg.from);
  if (data.users[uid] && !data.users[uid].lang && normLang(msg.from.language_code)) {
    data.users[uid].lang = normLang(msg.from.language_code);
  }
  const meta = { tgUsername: msg.from.username || null, first: msg.from.first_name || null };
  if (data.users[uid]) Object.assign(data.users[uid], meta);

  if (msg.text && msg.text.startsWith('/')) {
    if (group) return; // команды и диалог регистрации — в личке, в общем чате не шумим
    handleCommand(msg); return;
  }

  // медиа → доказательство = скриншот/фото; видео отклоняем
  if (msg.video || msg.animation) {
    send(msg.chat.id, t(lang, 'videoNo'));
    return;
  }
  const fileId = msg.photo?.at(-1)?.file_id;

  // игроки разошлись по разным кланам: с CLAN_ASK_FROM каждый игрок при первом
  // фото уточняет клан один раз; скрин удерживаем и распознаём сразу после ответа
  if (data.users[uid] && needClanCheck(uid) && st.await !== 'clan') {
    data.state[uid] = { await: 'clan', reask: true, ...(fileId ? { fileId, msgId: msg.message_id, msgDate: msg.date } : {}) };
    askClan(msg.chat.id, lang, true);
    return;
  }
  if (st.await === 'clan') {
    if (fileId) data.state[uid] = { await: 'clan', reask: st.reask, fileId, msgId: msg.message_id, msgDate: msg.date };
    send(msg.chat.id, t(lang, 'clanRemind'));
    return;
  }

  if (fileId) {
    if (!data.users[uid]) {
      if (group && msg.from.username) {
        data.users[uid] = { nick: msg.from.username, joined: new Date().toISOString(), lang, ...meta };
        send(msg.chat.id, t(lang, 'groupAutoreg', { username: msg.from.username }));
        data.state[uid] = { await: 'clan', fileId, msgId: msg.message_id, msgDate: msg.date };
        askClan(msg.chat.id, lang);
        return;
      } else if (group) {
        send(msg.chat.id, t(lang, 'groupRegister'));
        return;
      } else {
        data.state[uid] = { await: 'nick', fileId };
        send(msg.chat.id, t(lang, 'askNick'));
        return;
      }
    }
    await processPhoto(uid, msg.chat.id, fileId, msg.message_id, msg.date);
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // ожидание ника
  if (st.await === 'nick') {
    if (text.length > 24 || /[\n]/.test(text) || parseDamage(text)) { send(msg.chat.id, t(lang, 'notNick')); return; }
    data.users[uid] = { nick: text, joined: new Date().toISOString(), lang, ...meta };
    // следом спрашиваем клан; скрин, присланный до ника, удерживаем до ответа
    data.state[uid] = { await: 'clan', ...(st.fileId ? { fileId: st.fileId, msgId: msg.message_id, msgDate: msg.date } : {}) };
    send(msg.chat.id, t(lang, 'nickGreat', { nick: text }));
    askClan(msg.chat.id, lang);
    return;
  }

  // ручной ввод урона отключён — запись только со скриншота
  if (parseDamage(text)) {
    if (!group) send(msg.chat.id, t(lang, 'numbersNo'));
    return;
  }

  if (!group) send(msg.chat.id, t(lang, 'noUnderstand'));
}

// ---------- запуск: разовый (Actions) или непрерывный (VPS, BOT_LOOP=1) ----------
async function main() {
  pruneProofs(); // пруфы старше 7 дней — в начале запуска
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
  let lastPruneDay = '';
  for (;;) {
    // раз в сутки (по игровому дню, т.е. в 03:00) — чистка пруфов старше 7 дней
    const day = gameDate(Date.now() / 1000);
    if (day !== lastPruneDay) {
      lastPruneDay = day;
      const before = snapshot();
      pruneProofs();
      if (snapshot() !== before) { saveData(); await pushData(); }
    }
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

/* разовая чистка пруфов без опроса Telegram: PRUNE_ONLY=1 node scripts/poll.mjs */
if (process.env.PRUNE_ONLY) {
  const before = snapshot();
  pruneProofs();
  if (snapshot() !== before) saveData(); // файлы уже удалены; data.json — только если менялись записи
  process.exit(0);
}

if (process.env.BOT_LOOP) loop();
else main();
