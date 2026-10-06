'use strict';
/* Админка допущенных отправителей скринов.
 * Список живёт в docs/config.json; правки уходят в репозиторий через GitHub
 * Contents API с токеном из localStorage. Сайт статический — токет нигде
 * больше не хранится и не передаётся, кроме api.github.com. */

const REPO = 'Zaytsevandrei/archero2Dashboard';
const CONFIG_PATH = 'docs/config.json';
const OWNER_ID = '176147068'; // владелец — всегда админ (страховка от замка без ключа)
const LS_KEY = 'admin_gh_token';

const $ = (id) => document.getElementById(id);
const state = { token: localStorage.getItem(LS_KEY) || '', config: null, sha: null, busy: false, users: [] };

const CLAN_NAMES = { unity: 'Unity', unity2: 'Unity2' };
const b64encode = (s) => btoa(unescape(encodeURIComponent(s)));

async function gh(path, opts = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

/* ---------- конфиг ---------- */

async function fetchConfig() {
  const res = await gh(`/repos/${REPO}/contents/${CONFIG_PATH}`);
  if (res.status === 404) { state.config = { admins: [OWNER_ID], submitters: [] }; state.sha = null; return; }
  if (!res.ok) throw new Error(`не удалось прочитать config.json (HTTP ${res.status})`);
  const j = await res.json();
  state.sha = j.sha;
  state.config = JSON.parse(decodeURIComponent(escape(atob(String(j.content).replace(/\n/g, '')))));
  if (!Array.isArray(state.config.admins)) state.config.admins = [OWNER_ID];
  if (!Array.isArray(state.config.submitters)) state.config.submitters = [];
}

/* применить изменение к конфигу и сохранить; apply(config) мутирует и возвращает
 * описание коммита. При конфликте (кто-то поменял файл раньше) — перечитываем
 * и применяем изменение к свежей версии */
async function saveConfig(apply) {
  if (state.busy) return;
  state.busy = true;
  setStatus('Сохраняю…');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!state.config) await fetchConfig();
      const cfg = structuredClone(state.config);
      const message = apply(cfg);
      const res = await gh(`/repos/${REPO}/contents/${CONFIG_PATH}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `config: ${message} (админка)`,
          content: b64encode(JSON.stringify(cfg, null, 2) + '\n'),
          ...(state.sha ? { sha: state.sha } : {}),
        }),
      });
      if (res.status === 409 || res.status === 422) { await fetchConfig(); continue; } // конфликт — повторяем
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(`GitHub ${res.status}: ${j.message || 'не удалось сохранить'}`);
      }
      const j = await res.json();
      state.sha = j.content?.sha || state.sha;
      state.config = cfg;
      render();
      setStatus('Сохранено ✅ — бот подхватит список в течение ~10 минут');
      return true;
    }
    throw new Error('конфликт сохранения, попробуй ещё раз');
  } catch (e) {
    setStatus(`Ошибка: ${e.message}`, true);
    return false;
  } finally {
    state.busy = false;
  }
}

/* ---------- рендер ---------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render() {
  if (!state.config) return;
  // допущенные
  const body = $('submitters-body');
  body.textContent = '';
  for (const s of [...state.config.submitters].sort((a, b) => String(a.nick).localeCompare(String(b.nick)))) {
    const tr = document.createElement('tr');
    tr.append(el('td', null, s.nick || '—'));
    tr.append(el('td', 'num', String(s.tgId)));
    tr.append(el('td', 'num', s.tgUsername ? '@' + String(s.tgUsername).replace(/^@/, '') : '—'));
    tr.append(el('td', null, CLAN_NAMES[s.clan] || '—'));
    tr.append(el('td', 'num', s.added || '—'));
    const td = el('td');
    const del = el('button', 'ghost-btn', 'удалить');
    del.addEventListener('click', () => saveConfig((cfg) => {
      cfg.submitters = cfg.submitters.filter((x) => String(x.tgId) !== String(s.tgId));
      return `remove ${s.nick || s.tgId}`;
    }));
    td.append(del);
    tr.append(td);
    body.append(tr);
  }
  if (!state.config.submitters.length) {
    const tr = document.createElement('tr');
    const td = el('td', 'hint', 'Список пуст — добавь первого игрока ниже или из таблицы известных игроков.');
    td.colSpan = 6;
    tr.append(td);
    body.append(tr);
  }
  // админы
  const list = $('admins-list');
  list.textContent = '';
  for (const id of state.config.admins) {
    const li = el('li');
    li.append(el('b', null, String(id)));
    if (String(id) !== OWNER_ID) {
      const x = el('button', null, '✕');
      x.title = 'Убрать админа';
      x.addEventListener('click', () => saveConfig((cfg) => {
        cfg.admins = cfg.admins.filter((a) => String(a) !== String(id));
        return `admin- ${id}`;
      }));
      li.append(x);
    }
    list.append(li);
  }
}

function renderUsers(filter) {
  const body = $('users-body');
  body.textContent = '';
  const f = (filter || '').toLowerCase();
  const rows = state.users
    .filter((u) => !f || String(u.nick).toLowerCase().includes(f) || String(u.username || '').toLowerCase().includes(f) || String(u.tgId).includes(f))
    .sort((a, b) => String(a.nick).localeCompare(String(b.nick)));
  for (const u of rows) {
    const tr = document.createElement('tr');
    tr.append(el('td', null, u.nick));
    tr.append(el('td', 'num', u.tgId));
    tr.append(el('td', 'num', u.username ? '@' + u.username : '—'));
    tr.append(el('td', null, CLAN_NAMES[u.clan] || '—'));
    const td = el('td');
    const add = el('button', null, '→ добавить');
    add.title = 'Подставить в форму добавления';
    add.addEventListener('click', () => {
      $('add-nick').value = u.nick || '';
      $('add-tgid').value = u.tgId;
      $('add-username').value = u.username || '';
      if (u.clan && CLAN_NAMES[u.clan]) $('add-clan').value = u.clan;
      $('add-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('add-nick').focus();
    });
    td.append(add);
    tr.append(td);
    body.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = el('td', 'hint', 'Никого не нашлось.');
    td.colSpan = 5;
    tr.append(td);
    body.append(tr);
  }
}

/* ---------- токен и запуск ---------- */

async function init() {
  if (!state.token) {
    setTokenStatus('Токена нет — вставь токен, чтобы редактировать список.', true);
    return;
  }
  setTokenStatus('Проверяю токен…');
  try {
    const res = await gh('/user');
    if (!res.ok) throw new Error(res.status === 401 ? 'токен неверный или истёк (401)' : `HTTP ${res.status}`);
    const j = await res.json();
    $('gh-user').textContent = '👤 ' + j.login;
    await fetchConfig();
    render();
    for (const id of ['list-panel', 'users-panel', 'admins-panel']) $(id).hidden = false;
    setTokenStatus(`Токен ок (${j.login}) ✅`, false);
    // известные боту игроки — чтобы не искать Telegram ID руками
    try {
      const d = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
      state.users = Object.entries(d.users || {}).map(([tgId, u]) => ({
        tgId, nick: u.nick || '—', username: u.tgUsername || null, clan: u.clan || null,
      }));
      renderUsers('');
    } catch (e) { console.warn('data.json не прочитался:', e.message); }
  } catch (e) {
    setTokenStatus(`Токен не работает: ${e.message}. Обнови его ниже.`, true);
  }
}

function setTokenStatus(text, isErr) {
  const n = $('token-status');
  n.textContent = text;
  n.className = 'hint ' + (isErr ? 'status-err' : 'status-ok');
}
function setStatus(text, isErr) {
  const n = $('save-status');
  n.textContent = text;
  n.className = 'hint ' + (isErr ? 'status-err' : 'status-ok');
}

$('token-save').addEventListener('click', async () => {
  const tok = $('token-input').value.trim();
  if (!tok) return;
  localStorage.setItem(LS_KEY, tok);
  state.token = tok;
  state.config = null;
  state.sha = null;
  init();
});
$('token-drop').addEventListener('click', () => {
  localStorage.removeItem(LS_KEY);
  state.token = '';
  state.config = null;
  state.users = [];
  for (const id of ['list-panel', 'users-panel', 'admins-panel']) $(id).hidden = true;
  $('gh-user').textContent = '';
  $('token-input').value = '';
  setTokenStatus('Токен стёрт из браузера.', false);
});
$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = $('add-nick').value.trim();
  const tgId = $('add-tgid').value.trim();
  const username = $('add-username').value.trim().replace(/^@/, '');
  const clan = $('add-clan').value;
  if (!nick || !/^\d{3,12}$/.test(tgId)) { setStatus('Нужны ник и Telegram ID (только цифры).', true); return; }
  saveConfig((cfg) => {
    cfg.submitters = cfg.submitters.filter((x) => String(x.tgId) !== tgId);
    cfg.submitters.push({ tgId, nick: nick.slice(0, 24), clan, tgUsername: username || null, added: new Date().toISOString().slice(0, 10) });
    return `add ${nick}`;
  }).then((ok) => { if (ok) { $('add-form').reset(); $('add-clan').value = clan; } });
});
$('admin-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('admin-add-id').value.trim();
  if (!/^\d{3,12}$/.test(id)) { setStatus('Telegram ID — только цифры.', true); return; }
  saveConfig((cfg) => {
    if (!cfg.admins.map(String).includes(id)) cfg.admins.push(id);
    return `admin+ ${id}`;
  }).then(() => { $('admin-add-id').value = ''; });
});
$('users-filter').addEventListener('input', (e) => renderUsers(e.target.value));

init();
