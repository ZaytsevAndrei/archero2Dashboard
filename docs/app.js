/* Календарь урона — Archero 2 guild Unity.
 * Данные: data.json (коммитится ботом через GitHub Actions). Без фреймворков. */
'use strict';

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const state = {
  raw: { entries: [], users: {}, updatedAt: null },
  month: null,          // {y, m} — текущий просматриваемый месяц
  hideDemo: localStorage.getItem('hideDemo') === '1',
};

/* ---------- утилиты ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Intl.DateTimeFormat('sv-SE').format(new Date()); // YYYY-MM-DD локальной дате

function fmtDmg(dmg) {
  const units = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) if (dmg >= v) {
    const n = dmg / v;
    return (n >= 100 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, '') + s;
  }
  return String(dmg);
}
function fmtShort(dmg) { // компактно для ячеек: 209.77T → 210T, 5.91T → 5.91T
  const s = fmtDmg(dmg);
  return s.length > 6 ? fmtDmg(Math.round(dmg / 1e11) * 1e11) : s;
}
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/* heat-цвет: зелёный → жёлтый → красный по log-шкале от максимума */
function heatColor(v, max) {
  if (!max) return 'var(--cell-empty)';
  const r = Math.sqrt(v / max); // sqrt чтобы «средние» значения тоже светились
  const hue = 150 - 150 * r;
  return `hsl(${hue}, 65%, ${18 + 14 * r}%)`;
}

/* ---------- данные ---------- */
async function loadData() {
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    state.raw = await res.json();
  } catch (e) {
    $('updated').textContent = 'не удалось загрузить данные';
    return;
  }
  const upd = state.raw.updatedAt ? new Date(state.raw.updatedAt) : null;
  $('updated').textContent = upd ? `обновлено ${pad(upd.getHours())}:${pad(upd.getMinutes())}` : '';
  render();
}

/* записи месяца: [{nick, date:'YYYY-MM-DD', dmg, raw, proof, demo}] */
function monthEntries() {
  const { y, m } = state.month;
  const prefix = `${y}-${pad(m + 1)}`;
  return state.raw.entries.filter((e) => e.date && e.date.startsWith(prefix));
}
/* одна запись на ник+день (максимальная), с учётом фильтра демо */
function cellMap(entries) {
  const map = new Map(); // key nick|date -> entry
  for (const e of entries) {
    if (state.hideDemo && e.demo) continue;
    const k = `${e.nick}|${e.date}`;
    const prev = map.get(k);
    if (!prev || e.dmg > prev.dmg) map.set(k, e);
  }
  return map;
}

/* ---------- рендер ---------- */
function render() {
  const t = todayStr();
  if (!state.month) {
    const [y, mm] = t.split('-').map(Number);
    state.month = { y, m: mm - 1 };
  }
  const { y, m } = state.month;
  $('month-label').textContent = `${MONTHS_RU[m]} ${y}`;

  const entries = monthEntries();
  const map = cellMap(entries);

  // игроки месяца, отсортированные по сумме
  const byNick = new Map();
  for (const e of map.values()) {
    const cur = byNick.get(e.nick) || { total: 0, days: 0 };
    cur.total += e.dmg; cur.days++;
    byNick.set(e.nick, cur);
  }
  const nicks = [...byNick.keys()].sort((a, b) => byNick.get(b).total - byNick.get(a).total);

  // карточки
  $('stat-players').textContent = nicks.length;
  const todaySum = [...map.values()].filter((e) => e.date === t).reduce((s, e) => s + e.dmg, 0);
  $('stat-today').textContent = todaySum ? fmtDmg(todaySum) : '—';
  const monthSum = [...map.values()].reduce((s, e) => s + e.dmg, 0);
  $('stat-month').textContent = monthSum ? fmtDmg(monthSum) : '—';

  renderCalendars(nicks, byNick, map, t);
  renderTodayPanel(map, t);
  renderLeaderboard(nicks, byNick, map);
  renderDemoBanner(entries);
}

/* классическая сетка месяца (Пн–Вс) для одного игрока */
function playerCalendar(nick, map, playerMax, t) {
  const { y, m } = state.month;
  const shift = (new Date(y, m, 1).getDay() + 6) % 7; // Пн = 0
  const dim = daysInMonth(y, m);
  const prefix = `${y}-${pad(m + 1)}-`;
  const cells = [];
  for (let i = 0; i < shift; i++) cells.push('<span class="cal-cell off"></span>');
  for (let d = 1; d <= dim; d++) {
    const ds = prefix + pad(d);
    const e = map.get(`${nick}|${ds}`);
    let cls = 'cal-cell';
    let style = '';
    let val = '';
    if (ds > t) cls += ' future';
    if (ds === t) cls += ' today';
    if (e) {
      cls += ' has' + (e.demo ? ' demo-cell' : '');
      style = ` style="background:${heatColor(e.dmg, playerMax)}"`;
      val = `<span class="cal-val">${fmtShort(e.dmg)}</span>`;
    }
    cells.push(`<span class="${cls}"${style} data-nick="${esc(nick)}" data-date="${ds}" title="${nick} · ${ds}"><span class="cal-num">${d}</span>${val}</span>`);
  }
  return cells.join('');
}

function renderCalendars(nicks, byNick, map, t) {
  const weekdays = `<div class="cal-weekdays">${WEEKDAYS.map((w, i) => `<span class="${i > 4 ? 'wend' : ''}">${w}</span>`).join('')}</div>`;
  const html = nicks.length ? nicks.map((nick) => {
    const st = byNick.get(nick);
    let maxV = 0;
    for (const [k, e] of map) if (k.startsWith(nick + '|')) maxV = Math.max(maxV, e.dmg);
    return `<div class="cal-block">
      <div class="cal-head">
        <span class="cal-nick">${esc(nick)}</span>
        <span class="cal-meta">Σ ${fmtDmg(st.total)} · ${st.days} дн.</span>
      </div>
      ${weekdays}
      <div class="cal-grid">${playerCalendar(nick, map, maxV, t)}</div>
    </div>`;
  }).join('') :
    `<div class="cal-empty">Пока нет данных за этот месяц.<br>Отправь скриншот и урон боту <a href="https://t.me/Archero2Unity_bot" target="_blank" rel="noopener">@Archero2Unity_bot</a> — через пару минут ты появишься здесь.</div>`;
  $('calendars').innerHTML = html;
}

/* панель «Сегодня»: текущий день и урон по нему из присланных данных */
function renderTodayPanel(map, t) {
  const now = new Date();
  const title = `Сегодня · ${now.getDate()} ${MONTH_GEN[now.getMonth()]}`;
  const rows = [...map.values()].filter((e) => e.date === t).sort((a, b) => b.dmg - a.dmg);
  const total = rows.reduce((s, e) => s + e.dmg, 0);
  const list = rows.length
    ? rows.map((e, i) => `
      <li>
        <span class="rank">${i + 1}</span>
        <span class="name">${esc(e.nick)}${e.demo ? ' <i class="demo-note">(демо)</i>' : ''}</span>
        <span class="total">${fmtDmg(e.dmg)}</span>
        <span class="bar"><i style="width:${rows.length ? Math.max(4, Math.round((e.dmg / rows[0].dmg) * 100)) : 0}%"></i></span>
      </li>`).join('')
    : `<li class="today-none">Сегодня урона ещё не присылали 🏹</li>`;
  $('today-title').textContent = title;
  $('today-list').innerHTML = list;
  $('today-total').textContent = rows.length ? `Σ ${fmtDmg(total)} от ${rows.length} участник${rows.length === 1 ? 'а' : 'ов'}` : '';
}

function renderLeaderboard(nicks, byNick, map) {
  const best = nicks.length ? byNick.get(nicks[0]).total : 1;
  $('leaderboard').innerHTML = nicks.slice(0, 20).map((nick, i) => {
    const st = byNick.get(nick);
    let bestDay = null;
    for (const [k, e] of map) if (k.startsWith(nick + '|') && (!bestDay || e.dmg > bestDay.dmg)) bestDay = e;
    const w = Math.max(4, Math.round((st.total / best) * 100));
    return `<li>
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(nick)}</span>
      <span class="total">${fmtDmg(st.total)}</span>
      <span class="bar"><i style="width:${w}%"></i></span>
      <span class="meta">${st.days} дн. · лучший день ${bestDay ? fmtDmg(bestDay.dmg) : '—'}</span>
    </li>`;
  }).join('') || '<li class="meta" style="grid-template-columns:1fr">Пока нет данных.</li>';
}

function renderDemoBanner(entries) {
  const hasDemo = entries.some((e) => e.demo);
  const banner = $('demo-banner');
  banner.hidden = !hasDemo;
  banner.querySelector('span').textContent = state.hideDemo
    ? 'Демо-данные скрыты'
    : 'Показаны демо-данные для примера — скрой, когда пойдут реальные';
  $('toggle-demo').textContent = state.hideDemo ? 'Показать демо' : 'Скрыть демо';
}

/* ---------- события ---------- */
$('prev-month').onclick = () => { const { y, m } = state.month; state.month = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }; render(); };
$('next-month').onclick = () => { const { y, m } = state.month; state.month = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }; render(); };
$('today-btn').onclick = () => { const d = new Date(); state.month = { y: d.getFullYear(), m: d.getMonth() }; render(); };
$('toggle-demo').onclick = () => {
  state.hideDemo = !state.hideDemo;
  localStorage.setItem('hideDemo', state.hideDemo ? '1' : '0');
  render();
};

/* клик по ячейке → попап с пруфом */
$('calendars').addEventListener('click', (ev) => {
  const cell = ev.target.closest('span.cal-cell.has');
  if (!cell) return;
  const nick = cell.dataset.nick, date = cell.dataset.date;
  const e = [...state.raw.entries]
    .filter((x) => x.nick === nick && x.date === date && (!state.hideDemo || !x.demo))
    .sort((a, b) => b.dmg - a.dmg)[0];
  if (!e) return;
  $('popup-title').textContent = `${nick} · ${date.split('-').reverse().join('.')}`;
  $('popup-damage').textContent = fmtDmg(e.dmg) + (e.demo ? ' (демо)' : '');
  const img = $('popup-proof');
  if (e.proof) { img.src = e.proof; img.hidden = false; $('popup-noproof').hidden = true; }
  else { img.hidden = true; img.removeAttribute('src'); $('popup-noproof').hidden = false; }
  $('cell-popup').hidden = false;
});
$('popup-close').onclick = () => { $('cell-popup').hidden = true; };
$('cell-popup').addEventListener('click', (ev) => { if (ev.target === $('cell-popup')) $('cell-popup').hidden = true; });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('cell-popup').hidden = true; });

/* старт + автообновление раз в минуту */
loadData();
setInterval(loadData, 60_000);
