/* Календарь урона — Archero 2 guild Unity.
 * Один календарь месяца; клик по дате — детали дня под календарём.
 * Данные: data.json (коммитится ботом через GitHub Actions). Без фреймворков. */
'use strict';

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const state = {
  raw: { entries: [], users: {}, updatedAt: null },
  month: null,            // {y, m} — просматриваемый месяц
  selectedDate: null,     // выбранная дата 'YYYY-MM-DD' (по умолчанию сегодня)
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

/* heat-цвет: зелёный → жёлтый → красный относительно максимума */
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

/* одна запись на ник+день (максимальная); демо-записи не показываем */
function cellMap() {
  const map = new Map(); // key nick|date -> entry
  for (const e of state.raw.entries) {
    if (!e.date || e.demo) continue;
    const k = `${e.nick}|${e.date}`;
    const prev = map.get(k);
    if (!prev || e.dmg > prev.dmg) map.set(k, e);
  }
  return map;
}
/* сумма урона по дням месяца */
function dayTotals(map) {
  const { y, m } = state.month;
  const prefix = `${y}-${pad(m + 1)}-`;
  const days = new Map(); // date -> {sum, count}
  for (const [k, e] of map) {
    if (!e.date.startsWith(prefix)) continue;
    const cur = days.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.dmg; cur.count++;
    days.set(e.date, cur);
  }
  return days;
}

/* ---------- рендер ---------- */
function render() {
  const t = todayStr();
  if (!state.month) {
    const [y, mm] = t.split('-').map(Number);
    state.month = { y, m: mm - 1 };
  }
  if (!state.selectedDate || !state.selectedDate.startsWith(`${state.month.y}-${pad(state.month.m + 1)}`)) {
    state.selectedDate = t; // при смене месяца — сброс на сегодня
  }
  const { y, m } = state.month;
  $('month-label').textContent = `${MONTHS_RU[m]} ${y}`;

  const map = cellMap();
  const days = dayTotals(map);

  // игроки месяца, отсортированные по сумме (для карточек и рейтинга)
  const byNick = new Map();
  for (const [k, e] of map) {
    if (!e.date.startsWith(`${y}-${pad(m + 1)}`)) continue;
    const cur = byNick.get(e.nick) || { total: 0, days: 0 };
    cur.total += e.dmg; cur.days++;
    byNick.set(e.nick, cur);
  }
  const nicks = [...byNick.keys()].sort((a, b) => byNick.get(b).total - byNick.get(a).total);

  // карточки
  $('stat-players').textContent = nicks.length;
  const todaySum = days.get(t)?.sum || 0;
  $('stat-today').textContent = todaySum ? fmtDmg(todaySum) : '—';
  const monthSum = [...days.values()].reduce((s, d) => s + d.sum, 0);
  $('stat-month').textContent = monthSum ? fmtDmg(monthSum) : '—';

  renderCalendar(days, t);
  renderDayPanel(map);
  renderLeaderboard(nicks, byNick, map);
}

/* один общий календарь месяца: ячейка = день, значение = сумма урона за день */
function renderCalendar(days, t) {
  const { y, m } = state.month;
  const shift = (new Date(y, m, 1).getDay() + 6) % 7; // Пн = 0
  const dim = daysInMonth(y, m);
  const prefix = `${y}-${pad(m + 1)}-`;
  const maxDay = Math.max(0, ...[...days.values()].map((d) => d.sum));

  const cells = [];
  for (let i = 0; i < shift; i++) cells.push('<span class="cal-cell off"></span>');
  for (let d = 1; d <= dim; d++) {
    const ds = prefix + pad(d);
    const day = days.get(ds);
    let cls = 'cal-cell';
    let style = '';
    let val = '';
    if (ds > t) cls += ' future';
    if (ds === t) cls += ' today';
    if (ds === state.selectedDate) cls += ' selected';
    if (day) {
      cls += ' has';
      style = ` style="background:${heatColor(day.sum, maxDay)}"`;
      val = `<span class="cal-val">${fmtShort(day.sum)}</span><span class="cal-sub">${day.count} 🏹</span>`;
    }
    cells.push(`<button type="button" class="${cls}"${style} data-date="${ds}" title="${ds}"><span class="cal-num">${d}</span>${val}</button>`);
  }
  $('calendar').innerHTML =
    `<div class="cal-weekdays">${WEEKDAYS.map((w, i) => `<span class="${i > 4 ? 'wend' : ''}">${w}</span>`).join('')}</div>` +
    `<div class="cal-grid">${cells.join('')}</div>`;
}

/* панель дня под календарём: урон каждого приславшего за выбранную дату */
function renderDayPanel(map) {
  const ds = state.selectedDate;
  const d = Number(ds.slice(8));
  const mon = Number(ds.slice(5, 7)) - 1;
  const wd = WEEKDAYS_FULL[(new Date(Number(ds.slice(0, 4)), mon, d).getDay() + 6) % 7];
  const rows = [...map.entries()]
    .filter(([k, e]) => e.date === ds)
    .map(([k, e]) => e)
    .sort((a, b) => b.dmg - a.dmg);
  const total = rows.reduce((s, e) => s + e.dmg, 0);

  const list = rows.length
    ? rows.map((e, i) => `
      <li>
        <span class="rank">${i + 1}</span>
        <span class="name">${esc(e.nick)}</span>
        ${e.proof ? `<button type="button" class="proof-btn" data-nick="${esc(e.nick)}" data-date="${ds}" title="Открыть скриншот">🧾</button>` : ''}
        <span class="total">${fmtDmg(e.dmg)}</span>
        <span class="bar"><i style="width:${Math.max(4, Math.round((e.dmg / rows[0].dmg) * 100))}%"></i></span>
      </li>`).join('')
    : `<li class="today-none">За этот день урона не присылали 🏹</li>`;

  $('day-title').textContent = `${d} ${MONTH_GEN[mon]} · ${wd}`;
  $('day-list').innerHTML = list;
  $('day-total').textContent = rows.length ? `Σ ${fmtDmg(total)} от ${rows.length} участник${rows.length === 1 ? 'а' : 'ов'}` : '';
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


/* ---------- события ---------- */
$('prev-month').onclick = () => { const { y, m } = state.month; state.month = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }; render(); };
$('next-month').onclick = () => { const { y, m } = state.month; state.month = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }; render(); };
$('today-btn').onclick = () => { const d = new Date(); state.month = { y: d.getFullYear(), m: d.getMonth() }; state.selectedDate = todayStr(); render(); };

/* клик по дате → детали дня под календарём */
$('calendar').addEventListener('click', (ev) => {
  const cell = ev.target.closest('button.cal-cell[data-date]');
  if (!cell || cell.classList.contains('future')) return;
  state.selectedDate = cell.dataset.date;
  document.querySelectorAll('.cal-cell.selected').forEach((c) => c.classList.remove('selected'));
  cell.classList.add('selected');
  renderDayPanel(cellMap());
});

/* кнопка 🧾 в списке дня → попап со скриншотом */
$('day-list').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button.proof-btn');
  if (!btn) return;
  const e = [...state.raw.entries]
    .filter((x) => x.nick === btn.dataset.nick && x.date === btn.dataset.date && !x.demo)
    .sort((a, b) => b.dmg - a.dmg)[0];
  if (!e) return;
  $('popup-title').textContent = `${e.nick} · ${e.date.split('-').reverse().join('.')}`;
  $('popup-damage').textContent = fmtDmg(e.dmg);
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
