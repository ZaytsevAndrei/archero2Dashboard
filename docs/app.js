/* Календарь урона — Archero 2, кланы Unity и Unity2.
 * Две вкладки: «Сегодня» (урон за сегодня + рейтинг месяца) и «Календарь»
 * (месяц с уроном по кланам разными цветами; клик по дате — детали дня).
 * Данные: data.json (коммитится ботом). Без фреймворков.
 * Языки интерфейса: ru / en / vi — автораспознавание по браузеру,
 * переключатель в шапке, выбор помнится в localStorage. */
'use strict';

/* ---------- i18n ---------- */
const CAL = {
  ru: {
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    monthGen: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    wd: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    wdFull: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  },
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'],
    monthGen: [],
    wd: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    wdFull: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
  vi: {
    months: ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
      'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'],
    monthGen: [],
    wd: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
    wdFull: ['thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy', 'Chủ nhật'],
  },
};

const I18N = {
  ru: {
    title: 'Unity & Unity2 — Календарь урона · Archero 2',
    brand: 'Календарь урона',
    sub: 'Вторжение монстров',
    loading: 'загрузка…',
    updated: 'обновлено',
    loadFailed: 'не удалось загрузить данные',
    prevMonth: 'Предыдущий месяц',
    nextMonth: 'Следующий месяц',
    today: 'Сегодня',
    viewToday: 'Сегодня',
    viewCalendar: 'Календарь',
    tabAll: 'Все кланы',
    cardPlayers: 'участников',
    cardToday: 'урона сегодня',
    cardMonth: 'сумма за месяц',
    hCalendar: 'Календарь урона',
    hintCalendar: 'Ячейка — урон за день, цвет — клан: золотой Unity, фиолетовый Unity2 (чем ярче, тем больше урон). В виде «Все кланы» ячейка с уроном нескольких кланов делится между ними по доле урона. Приглушённые дни на краях сетки — соседние месяцы. Нажми на дату — ниже появится урон каждого игрока за этот день. 🧾 — скриншот-доказательство.',
    hLeaderboard: 'Рейтинг за месяц',
    hHowto: 'Как попасть в календарь',
    howto1: 'Открой бота',
    howto2: 'Отправь <b>/start</b>, напиши игровой ник и выбери клан — Unity или Unity2',
    howto3: 'Отправь <b>скриншот</b> рейтинга — бот сам распознает урон и запишет его',
    hintBot: 'Бот отвечает мгновенно, данные появляются на сайте через пару минут после отчёта.',
    dayNone: 'За этот день урона не присылали 🏹',
    from: 'от',
    noData: 'Пока нет данных.',
    bestDay: 'лучший день',
    proofTitle: 'Открыть скриншот',
    proofAlt: 'Доказательство',
    noProof: 'Скриншот не приложен',
  },
  en: {
    title: 'Unity & Unity2 — Damage calendar · Archero 2',
    brand: 'Damage calendar',
    sub: 'Monster invasion',
    loading: 'loading…',
    updated: 'updated',
    loadFailed: 'failed to load data',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    viewToday: 'Today',
    viewCalendar: 'Calendar',
    tabAll: 'All clans',
    cardPlayers: 'participants',
    cardToday: 'damage today',
    cardMonth: 'month total',
    hCalendar: 'Damage calendar',
    hintCalendar: "A cell is the day's damage, colored by clan: gold for Unity, purple for Unity2 (the brighter, the more damage). In the “All clans” view a cell with several clans' damage is split between them by damage share. Dimmed days at the edges belong to the neighboring months. Click a date to see each player's damage for that day below. 🧾 — screenshot proof.",
    hLeaderboard: 'Monthly leaderboard',
    hHowto: 'How to get on the calendar',
    howto1: 'Open the bot',
    howto2: 'Send <b>/start</b>, type your in-game nickname and pick your clan — Unity or Unity2',
    howto3: 'Send a <b>rating screenshot</b> — the bot will recognize and record the damage itself',
    hintBot: 'The bot replies instantly; data appears on the site a couple of minutes after the report.',
    dayNone: 'No damage reported this day 🏹',
    from: 'from',
    noData: 'No data yet.',
    bestDay: 'best day',
    proofTitle: 'Open screenshot',
    proofAlt: 'Proof',
    noProof: 'No screenshot attached',
  },
  vi: {
    title: 'Unity & Unity2 — Lịch sát thương · Archero 2',
    brand: 'Lịch sát thương',
    sub: 'Xâm lăng quái vật',
    loading: 'đang tải…',
    updated: 'cập nhật',
    loadFailed: 'không tải được dữ liệu',
    prevMonth: 'Tháng trước',
    nextMonth: 'Tháng sau',
    today: 'Hôm nay',
    viewToday: 'Hôm nay',
    viewCalendar: 'Lịch',
    tabAll: 'Tất cả các bang',
    cardPlayers: 'người tham gia',
    cardToday: 'sát thương hôm nay',
    cardMonth: 'tổng trong tháng',
    hCalendar: 'Lịch sát thương',
    hintCalendar: 'Mỗi ô là sát thương trong ngày, màu theo bang: vàng — Unity, tím — Unity2 (càng sáng càng cao). Ở chế độ «Tất cả các bang», ô có sát thương của nhiều bang được chia theo tỷ lệ của từng bang. Những ngày mờ ở rìa là của tháng lân cận. Bấm vào ngày để xem sát thương của từng người chơi. 🧾 — ảnh bằng chứng.',
    hLeaderboard: 'Bảng xếp hạng tháng',
    hHowto: 'Cách ghi danh vào lịch',
    howto1: 'Mở bot',
    howto2: 'Gửi <b>/start</b>, nhập nickname trong game và chọn bang — Unity hoặc Unity2',
    howto3: 'Gửi <b>ảnh chụp bảng xếp hạng</b> — bot sẽ tự nhận diện và ghi lại sát thương',
    hintBot: 'Bot trả lời ngay lập tức; dữ liệu xuất hiện trên web sau vài phút.',
    dayNone: 'Ngày này chưa ai gửi sát thương 🏹',
    from: 'của',
    noData: 'Chưa có dữ liệu.',
    bestDay: 'ngày tốt nhất',
    proofTitle: 'Mở ảnh chụp màn hình',
    proofAlt: 'Bằng chứng',
    noProof: 'Không có ảnh chụp màn hình',
  },
};

const CLANS = { unity: 'Unity', unity2: 'Unity2' };
const clanOf = (e) => e.clan || 'unity2'; // записи до разделения кланов — все из Unity2
/* цвета кланов (rgb-триплеты): Unity — золото, Unity2 — фиолетовый; такими же
 * подсвечены значения в ячейках календаря и бейджи кланов */
const CLAN_COLORS = { unity: '245,185,66', unity2: '179,157,255' };
const clanColor = (c) => CLAN_COLORS[c] || '232,235,242';

const state = {
  raw: { entries: [], users: {}, updatedAt: null },
  month: null,            // {y, m} — просматриваемый месяц
  selectedDate: null,     // выбранная дата 'YYYY-MM-DD' (по умолчанию сегодня)
  clan: 'all',            // вкладка клана: 'all' | 'unity' | 'unity2'
  view: 'today',          // вкладка раздела: 'today' | 'calendar'
  lang: null,             // язык интерфейса: 'ru' | 'en' | 'vi'
};

/* язык: сохранённый выбор → первый поддерживаемый из настроек браузера → ru */
function detectLang() {
  try {
    const saved = localStorage.getItem('lang');
    if (saved && I18N[saved]) return saved;
  } catch (e) { /* приватный режим — просто автоопределение */ }
  const prefs = (navigator.languages || [navigator.language]).map((s) => String(s).slice(0, 2).toLowerCase());
  for (const p of prefs) if (I18N[p]) return p;
  return 'ru';
}

/* вкладка раздела: сохранённый выбор, по умолчанию «Сегодня» */
function detectView() {
  try {
    const v = localStorage.getItem('view');
    if (v === 'today' || v === 'calendar') return v;
  } catch (e) { /* приватный режим */ }
  return 'today';
}
const L = (key) => I18N[state.lang]?.[key] ?? I18N.ru[key] ?? key;
const cal = () => CAL[state.lang] || CAL.ru;

/* формы множественного числа: ru — 1/2-4/5+, остальные — 1/many (vi не пользуется) */
function plural(n, one, few, many) {
  if (state.lang !== 'ru') return n === 1 ? one : many;
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
}
const participantsWord = (n) => {
  if (state.lang === 'en') return plural(n, 'participant', '', 'participants');
  if (state.lang === 'vi') return 'người tham gia';
  return plural(n, 'участник', 'участника', 'участников');
};
const daysWord = (n) => {
  if (state.lang === 'en') return plural(n, 'day', '', 'days');
  if (state.lang === 'vi') return 'ngày';
  return 'дн.';
};

/* «5 октября · понедельник» / «October 5 · Monday» / «5 tháng 10 · thứ Hai» */
function dayTitle(d, mon, wdIdx) {
  const wd = cal().wdFull[wdIdx];
  if (state.lang === 'en') return `${cal().months[mon]} ${d} · ${wd}`;
  if (state.lang === 'vi') return `${d} tháng ${mon + 1} · ${wd}`;
  return `${d} ${cal().monthGen[mon]} · ${wd}`;
}

/* ---------- утилиты ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Игровой день длится с 03:00 до 03:00: до трёх утра «сегодня» — ещё вчерашний день */
const todayStr = () => {
  const d = new Date();
  if (d.getHours() >= 3) return new Intl.DateTimeFormat('sv-SE').format(d);
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('sv-SE').format(d);
}; // YYYY-MM-DD

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

/* цвет полосы рейтинга по месту: топ-25% зелёные, середина жёлтая, низ-25% красные */
function rankColor(idx, total) {
  if (total <= 1) return 'hsl(140, 72%, 48%)';
  const t = idx / (total - 1); // 0 = первое место, 1 = последнее
  const hue = t < 0.5 ? 140 - 80 * (t / 0.5) : 60 - 60 * ((t - 0.5) / 0.5);
  return `hsl(${Math.round(hue)}, 72%, 48%)`;
}

/* ---------- данные ---------- */
/* статичные тексты (data-i18n / data-i18n-title / data-i18n-alt) + заголовок;
 * разметка в значениях словаря (<b> в howto) — наша, не пользовательская */
function applyI18n() {
  document.documentElement.lang = state.lang;
  document.title = L('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = L(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = L(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-alt]').forEach((el) => { el.alt = L(el.dataset.i18nAlt); });
  document.querySelectorAll('#lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.lang));
}

function fmtUpdated() {
  if (!state.raw.updatedAt) return L('loading');
  const upd = new Date(state.raw.updatedAt);
  return `${L('updated')} ${pad(upd.getHours())}:${pad(upd.getMinutes())}`;
}

async function loadData() {
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    state.raw = await res.json();
  } catch (e) {
    $('updated').textContent = L('loadFailed');
    return;
  }
  $('updated').textContent = fmtUpdated();
  render();
}

/* одна запись на ник+день (максимальная); демо-записи не показываем */
function cellMap(clan = state.clan) {
  const map = new Map(); // key nick|date -> entry
  for (const e of state.raw.entries) {
    if (!e.date || e.demo) continue;
    if (clan !== 'all' && clanOf(e) !== clan) continue;
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

/* суммы урона по всем датам (без фильтра месяца) с разбивкой по кланам —
 * для сетки календаря, включая «хвосты» из соседних месяцев */
function totalsByDate(map) {
  const days = new Map(); // date -> {sum, count, clans: Map(clan -> {sum, count})}
  for (const [, e] of map) {
    const cur = days.get(e.date) || { sum: 0, count: 0, clans: new Map() };
    cur.sum += e.dmg; cur.count++;
    const c = clanOf(e);
    const cc = cur.clans.get(c) || { sum: 0, count: 0 };
    cc.sum += e.dmg; cc.count++;
    cur.clans.set(c, cc);
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
  if (!state.selectedDate) state.selectedDate = t; // выбор дня меняет клик по сетке, не перерисовка
  const { y, m } = state.month;
  $('month-label').textContent = `${cal().months[m]} ${y}`;

  const map = cellMap();
  const days = dayTotals(map);

  // игроки месяца, отсортированные по сумме (для карточек и рейтинга);
  // клан игрока = клан его последней записи (переход между кланами редкость)
  const byNick = new Map();
  for (const [k, e] of map) {
    if (!e.date.startsWith(`${y}-${pad(m + 1)}`)) continue;
    const cur = byNick.get(e.nick) || { total: 0, days: 0, clan: null, last: '' };
    cur.total += e.dmg; cur.days++;
    if (!cur.last || e.date >= cur.last) { cur.clan = clanOf(e); cur.last = e.date; }
    byNick.set(e.nick, cur);
  }
  const nicks = [...byNick.keys()].sort((a, b) => byNick.get(b).total - byNick.get(a).total);

  // вкладки кланов: подпись с числом участников месяца (по всем кланам, без фильтра)
  const perClan = { all: new Set(), unity: new Set(), unity2: new Set() };
  for (const [, e] of cellMap('all')) {
    if (!e.date.startsWith(`${y}-${pad(m + 1)}`)) continue;
    perClan.all.add(e.nick);
    perClan[clanOf(e)]?.add(e.nick);
  }
  document.querySelectorAll('#clan-tabs .clan-tab').forEach((b) => {
    const base = b.dataset.clan === 'all' ? L('tabAll') : CLANS[b.dataset.clan];
    b.textContent = perClan[b.dataset.clan].size ? `${base} · ${perClan[b.dataset.clan].size}` : base;
  });

  // карточки
  $('stat-players').textContent = nicks.length;
  const todaySum = days.get(t)?.sum || 0;
  $('stat-today').textContent = todaySum ? fmtDmg(todaySum) : '—';
  const monthSum = [...days.values()].reduce((s, d) => s + d.sum, 0);
  $('stat-month').textContent = monthSum ? fmtDmg(monthSum) : '—';

  renderCalendar(totalsByDate(map), t);
  fillDayPanel('today', t, map);                 // вкладка «Сегодня» — всегда сегодняшний день
  fillDayPanel('day', state.selectedDate, map);  // вкладка «Календарь» — выбранный день
  renderLeaderboard(nicks, byNick, map);
}

/* один общий календарь месяца: ячейка = день, урон — по кланам разными цветами
 * (Unity — золотой, Unity2 — фиолетовый), яркость фона растёт с уроном; шкала —
 * рекорд месяца этого же клана. В виде «Все кланы» ячейка с уроном нескольких
 * кланов делится градиентом по доле урона, значения подписаны цветом клана
 * (Unity сверху). Края сетки — дни соседних месяцев (класс out, приглушены) */
function renderCalendar(daysAll, t) {
  const { y, m } = state.month;
  const shift = (new Date(y, m, 1).getDay() + 6) % 7; // Пн = 0
  const dim = daysInMonth(y, m);
  const prefix = `${y}-${pad(m + 1)}-`;
  // рекорд месяца по каждому клану отдельно — яркость клана не зависит от другого;
  // считаем только по дням самого месяца: соседние не искажают шкалу
  const maxByClan = new Map();
  for (const [d, v] of daysAll) {
    if (!d.startsWith(prefix)) continue;
    for (const [c, s] of v.clans) maxByClan.set(c, Math.max(maxByClan.get(c) || 0, s.sum));
  }
  const bg = (c, sum) =>
    `rgba(${clanColor(c)},${(maxByClan.get(c) ? 0.16 + 0.5 * Math.sqrt(sum / maxByClan.get(c)) : 0.3).toFixed(2)})`;

  const cell = (ds, d, out) => {
    const day = daysAll.get(ds);
    let cls = 'cal-cell' + (out ? ' out' : '');
    let style = '';
    let val = '';
    if (ds > t) cls += ' future';
    if (ds === t) cls += ' today';
    if (ds === state.selectedDate) cls += ' selected';
    if (day) {
      cls += ' has';
      const clans = Object.keys(CLANS).filter((c) => day.clans.has(c));
      if (clans.length === 1) {
        const c = clans[0];
        const s = day.clans.get(c).sum;
        style = ` style="background:${bg(c, s)}"`;
        val = `<span class="cal-val" style="color:rgb(${clanColor(c)})">${fmtShort(s)}</span><span class="cal-sub">${day.count} 🏹</span>`;
      } else {
        const total = clans.reduce((sum, c) => sum + day.clans.get(c).sum, 0);
        let acc = 0;
        const stops = clans.map((c) => {
          const from = acc;
          acc += day.clans.get(c).sum / total;
          return `${bg(c, day.clans.get(c).sum)} ${(from * 100).toFixed(1)}% ${(acc * 100).toFixed(1)}%`;
        });
        style = ` style="background:linear-gradient(180deg,${stops.join(',')})"`;
        val = clans
          .map((c) => `<span class="cal-val" style="color:rgb(${clanColor(c)})">${fmtShort(day.clans.get(c).sum)}</span>`)
          .join('');
      }
    }
    return `<button type="button" class="${cls}"${style} data-date="${ds}" title="${ds}"><span class="cal-num">${d}</span>${val}</button>`;
  };

  const cells = [];
  // начало: последние дни предыдущего месяца
  const py = m === 0 ? y - 1 : y;
  const pdim = daysInMonth(py, m === 0 ? 11 : m - 1);
  for (let i = shift; i > 0; i--) {
    const d = pdim - i + 1;
    cells.push(cell(`${py}-${pad(m === 0 ? 12 : m)}-${pad(d)}`, d, true));
  }
  for (let d = 1; d <= dim; d++) cells.push(cell(prefix + pad(d), d, false));
  // конец: первые дни следующего месяца (добиваем ряд до воскресенья)
  const tail = (7 - ((shift + dim) % 7)) % 7;
  const ny = m === 11 ? y + 1 : y;
  for (let d = 1; d <= tail; d++) cells.push(cell(`${ny}-${pad(m === 11 ? 1 : m + 2)}-${pad(d)}`, d, true));

  $('calendar').innerHTML =
    `<div class="cal-weekdays">${cal().wd.map((w, i) => `<span class="${i > 4 ? 'wend' : ''}">${w}</span>`).join('')}</div>` +
    `<div class="cal-grid">${cells.join('')}</div>`;
}

/* бейдж клана у ника — только в общем виде (на вкладке клана он не нужен);
 * U = Unity, U2 = Unity2 */
function clanChip(clan) {
  if (state.clan !== 'all' || !clan) return '';
  return `<span class="clan-chip ${clan === 'unity2' ? 'c-unity2' : 'c-unity'}" title="${CLANS[clan]}">${clan === 'unity2' ? 'U2' : 'U'}</span>`;
}

/* панель дня: урон каждого приславшего за дату. prefix = 'today' (вкладка
 * «Сегодня», всегда сегодняшний день) или 'day' (вкладка «Календаря», выбранный) */
function fillDayPanel(prefix, ds, map) {
  const d = Number(ds.slice(8));
  const mon = Number(ds.slice(5, 7)) - 1;
  const wd = (new Date(Number(ds.slice(0, 4)), mon, d).getDay() + 6) % 7;
  const rows = [...map.values()]
    .filter((e) => e.date === ds)
    .sort((a, b) => b.dmg - a.dmg);
  const total = rows.reduce((s, e) => s + e.dmg, 0);

  const list = rows.length
    ? rows.map((e, i) => `
      <li>
        <span class="rank">${i + 1}</span>
        <span class="name">${esc(e.nick)}${clanChip(clanOf(e))}</span>
        ${e.proof ? `<button type="button" class="proof-btn" data-nick="${esc(e.nick)}" data-date="${ds}" title="${L('proofTitle')}">🧾</button>` : ''}
        <span class="total">${fmtDmg(e.dmg)}</span>
        <span class="bar"><i style="width:${Math.max(4, Math.round((e.dmg / rows[0].dmg) * 100))}%;background:${rankColor(i, rows.length)}"></i></span>
      </li>`).join('')
    : `<li class="today-none">${L('dayNone')}</li>`;

  $(`${prefix}-title`).textContent = dayTitle(d, mon, wd);
  $(`${prefix}-list`).innerHTML = list;
  $(`${prefix}-total`).textContent = rows.length
    ? `Σ ${fmtDmg(total)} ${L('from')} ${rows.length} ${participantsWord(rows.length)}` : '';
}

function renderLeaderboard(nicks, byNick, map) {
  const best = nicks.length ? byNick.get(nicks[0]).total : 1;
  const shown = nicks.slice(0, 20);
  $('leaderboard').innerHTML = shown.map((nick, i) => {
    const st = byNick.get(nick);
    let bestDay = null;
    for (const [k, e] of map) if (k.startsWith(nick + '|') && (!bestDay || e.dmg > bestDay.dmg)) bestDay = e;
    const w = Math.max(4, Math.round((st.total / best) * 100));
    return `<li>
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(nick)}${clanChip(st.clan)}</span>
      <span class="total">${fmtDmg(st.total)}</span>
      <span class="bar"><i style="width:${w}%;background:${rankColor(i, shown.length)}"></i></span>
      <span class="meta">${st.days} ${daysWord(st.days)} · ${L('bestDay')} ${bestDay ? fmtDmg(bestDay.dmg) : '—'}</span>
    </li>`;
  }).join('') || `<li class="meta" style="grid-template-columns:1fr">${L('noData')}</li>`;
}


/* ---------- события ---------- */
/* смена месяца: выбранная дата сохраняется, если попадает в новый месяц
 * (в т.ч. день соседнего месяца с края сетки), иначе сброс на сегодня */
function shiftMonth(delta) {
  const { y, m } = state.month;
  state.month = delta < 0
    ? (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })
    : (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });
  if (!state.selectedDate?.startsWith(`${state.month.y}-${pad(state.month.m + 1)}`)) state.selectedDate = todayStr();
  render();
}
$('prev-month').onclick = () => shiftMonth(-1);
$('next-month').onclick = () => shiftMonth(1);
$('today-btn').onclick = () => { const [y, mm] = todayStr().split('-').map(Number); state.month = { y, m: mm - 1 }; state.selectedDate = todayStr(); render(); };

/* вкладка раздела «Сегодня»/«Календарь»: показываем нужную, выбор помним */
$('view-tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button.view-tab');
  if (!btn || btn.dataset.view === state.view) return;
  state.view = btn.dataset.view;
  try { localStorage.setItem('view', state.view); } catch (e) { /* приватный режим */ }
  syncView();
});
function syncView() {
  document.querySelectorAll('#view-tabs .view-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('view-today').hidden = state.view !== 'today';
  $('view-calendar').hidden = state.view !== 'calendar';
}

/* вкладка клана: фильтруем календарь, карточки, день и рейтинг */
$('clan-tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button.clan-tab');
  if (!btn || btn.dataset.clan === state.clan) return;
  state.clan = btn.dataset.clan;
  document.querySelectorAll('#clan-tabs .clan-tab').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});

/* клик по дате → детали дня под календарём */
$('calendar').addEventListener('click', (ev) => {
  const cell = ev.target.closest('button.cal-cell[data-date]');
  if (!cell || cell.classList.contains('future')) return;
  state.selectedDate = cell.dataset.date;
  document.querySelectorAll('.cal-cell.selected').forEach((c) => c.classList.remove('selected'));
  cell.classList.add('selected');
  fillDayPanel('day', state.selectedDate, cellMap());
});

/* кнопка 🧾 в списках дня (обе вкладки) → попап со скриншотом */
const openProof = (ev) => {
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
};
$('today-list').addEventListener('click', openProof);
$('day-list').addEventListener('click', openProof);
$('popup-close').onclick = () => { $('cell-popup').hidden = true; };
$('cell-popup').addEventListener('click', (ev) => { if (ev.target === $('cell-popup')) $('cell-popup').hidden = true; });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('cell-popup').hidden = true; });

/* переключатель языка: запоминаем выбор и перерисовываем весь интерфейс */
$('lang-switch').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-lang]');
  if (!btn || btn.dataset.lang === state.lang) return;
  state.lang = btn.dataset.lang;
  try { localStorage.setItem('lang', state.lang); } catch (e) { /* приватный режим */ }
  applyI18n();
  $('updated').textContent = fmtUpdated();
  render();
});

/* старт + автообновление раз в минуту */
state.lang = detectLang();
state.view = detectView();
applyI18n();
syncView();
loadData();
setInterval(loadData, 60_000);
