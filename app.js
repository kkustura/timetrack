import * as C from './core.js';

const STORAGE_KEY = 'timetrack.v1';
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const $view = document.getElementById('view');
const $dlg = document.getElementById('editor');

let state = load();
let tab = localGet('timetrack.tab') || 'today';
const t0 = new Date();
let cursor = { y: t0.getFullYear(), m: t0.getMonth() };
let vacYear = t0.getFullYear();
let editSince = false;
let dayView = null; // day shown on the Today tab (null = today)
let slide = '';     // 'prev' | 'next' animation for the next render
let vacFrom = null; // prefill for the vacation form
let draft = null; // day editor working copy

// ---------- persistence ----------

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { toast('Could not save — storage unavailable'); } }

function load() {
  const today = C.dateKey(Date.now());
  try {
    const raw = localGet(STORAGE_KEY);
    if (raw) return C.normalizeState(JSON.parse(raw), today);
  } catch (e) { console.error(e); }
  return C.emptyState(today);
}
function save() { localSet(STORAGE_KEY, JSON.stringify(state)); }

function ensureMeta() {
  state.meta ||= {};
  if (!state.meta.firstUse) { state.meta.firstUse = Date.now(); save(); }
}
ensureMeta();

navigator.storage?.persist?.();

// ---------- helpers ----------

const now = () => Date.now();
const TIME_ATTRS = 'type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5"';
const todayKey = () => C.dateKey(now());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signCls = (m) => (Math.abs(m) < 1 ? '' : m > 0 ? 'pos' : 'neg');
/** Accepts "38.5", "38,5", "-1,5" or "−1.5"; returns null if not a number. */
function parseNum(v) {
  const t = String(v).trim().replace(',', '.').replace('−', '-');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const fmtDays = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function longDate(key) {
  return C.parseKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function shortDate(key) {
  return C.parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function absLabel(a) {
  const t = C.ABSENCE_TYPES[a.type] || { label: a.type, icon: '•' };
  let s = `${t.icon} ${t.label}`;
  if (t.timed && a.start) s += ` ${a.start}–${a.end}`;
  if (a.half) s += ' (½ day)';
  return s;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function deliverFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

function goDay(delta) {
  const today = todayKey();
  const next = C.addDays(dayView || today, delta);
  dayView = next === today ? null : next;
  editSince = false;
  slide = delta < 0 ? 'prev' : 'next';
  render();
}

function goMonth(delta) {
  const d = new Date(cursor.y, cursor.m + delta, 1);
  cursor = { y: d.getFullYear(), m: d.getMonth() };
  slide = delta < 0 ? 'prev' : 'next';
  render();
}

async function exportBackup() {
  const ok = await deliverFile(`timetracker-backup-${todayKey()}.json`, JSON.stringify(state, null, 1), 'application/json');
  if (!ok) return;
  state.meta.lastBackup = Date.now();
  delete state.meta.backupSnoozeUntil;
  save();
  render();
  toast('Backup created');
}

// ---------- views ----------

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const views = { today: viewToday, month: viewMonth, vacation: viewVacation, settings: viewSettings };
  $view.innerHTML = (views[tab] || viewToday)();
  if (slide) {
    $view.classList.remove('slide-prev', 'slide-next');
    void $view.offsetWidth; // restart the animation
    $view.classList.add(`slide-${slide}`);
    slide = '';
  }
}

const DAY = 24 * 60 * C.MIN;

function backupReminder(t) {
  const meta = state.meta;
  if (!Object.keys(state.days).length) return '';
  const ref = meta.lastBackup || meta.firstUse || t;
  if (t - ref < 30 * DAY || (meta.backupSnoozeUntil || 0) > t) return '';
  const msg = meta.lastBackup
    ? `Your last backup was ${Math.floor((t - meta.lastBackup) / DAY)} days ago.`
    : "You haven't saved a backup yet.";
  return `<div class="card reminder">
    <b>📦 Time for a backup</b>
    <div class="small muted" style="margin:4px 0 10px">${msg} Save one to iCloud Drive so your data is safe if something happens to this phone.</div>
    <div class="row"><button class="b-small b-accent" data-act="backup-now">Back up now</button>
    <button class="b-small" data-act="backup-later">Remind me in a week</button></div>
  </div>`;
}

/** On the last working day of the week: what's still needed to finish this week at zero. */
function fridayNote(key, d, t) {
  const work = state.settings.workdays;
  if (!work.length) return '';
  const lastWorkday = [1, 2, 3, 4, 5, 6, 0].filter((x) => work.includes(x)).pop();
  if (C.weekday(key) !== lastWorkday) return '';
  const monday = C.addDays(key, -((C.weekday(key) + 6) % 7));
  const wk = C.rangeTotals(state, monday, C.addDays(monday, 6), key, t);
  if (!wk.target) return '';
  const goal = wk.target - (wk.credited - d.credited); // what today must credit
  const still = goal - d.credited;
  let msg;
  if (still <= 0) {
    msg = 'Weekly balance reached – enjoy your weekend! 🏖️';
  } else {
    const leave = C.leaveAt(state, d, goal, t);
    msg = leave && C.dateKey(leave) === key
      ? `Weekly balance – you can leave at ${C.timeOf(leave)} 🏖️`
      : `Weekly balance – ${C.fmtDur(still)} h to go today 🏖️`;
  }
  return `<div class="friday-note">${msg}</div>`;
}

function dayTitle(key, today) {
  if (key === today) return 'Today';
  if (key === C.addDays(today, -1)) return 'Yesterday';
  if (key === C.addDays(today, 1)) return 'Tomorrow';
  return C.parseKey(key).toLocaleDateString(undefined, { weekday: 'long' });
}

function viewToday() {
  const t = now();
  const today = todayKey();
  const key = dayView && dayView !== today ? dayView : today;
  const isToday = key === today;
  const isPast = key < today;
  const d = C.dayStats(state, key, t);
  const cur = state.current;
  const before = C.balanceBefore(state, key, t);
  const counts = C.countsTowardBalance(d, today, state.settings.startDate);
  const balance = before + (counts ? d.diff : 0);
  const stale = isToday && cur && C.dateKey(cur.since) !== key;

  let html = `<div class="dayhead">
    <button class="b-nav" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
    <div class="grow"><h1>${dayTitle(key, today)}</h1>
      <div class="sub">${esc(longDate(key))}${d.holiday ? ` · 🎉 ${esc(d.holiday)}` : ''}</div></div>
    ${isToday ? '' : '<button class="b-small b-accent" data-act="day-today">Today</button>'}
    <button class="b-nav" data-act="day" data-d="1" aria-label="Next day">›</button>
  </div>`;

  if (isToday) html += backupReminder(t);

  if (stale) {
    const k = C.dateKey(cur.since);
    html += `<div class="warn">
      <b>Still ${cur.mode === 'work' ? 'clocked in' : 'on pause'} since ${esc(shortDate(k))}, ${C.timeOf(cur.since)}.</b> Forgot to clock out?
      <div class="row" style="margin-top:8px">
        ${cur.mode === 'work' ? `<span>Clock out at</span><input ${TIME_ATTRS} id="staleOut" value="${C.timeOf(Math.max(cur.since, C.atTime(k, '16:30')))}">` : ''}
        <button class="b-small b-accent" data-act="fix-stale">${cur.mode === 'work' ? 'Save' : 'End pause'}</button>
      </div></div>`;
  }

  const leave = isToday ? C.leaveAt(state, d, d.target, t) : null;

  if (isToday) html += fridayNote(key, d, t);

  if (isToday) {
    // status card with the clock buttons
    const mode = stale ? null : cur?.mode;
    const pill = mode === 'work' ? ['st-work', `Working since ${C.timeOf(cur.since)}`]
      : mode === 'pause' ? ['st-pause', `On pause since ${C.timeOf(cur.since)}`]
      : ['', d.intervals.length ? `Clocked out at ${C.timeOf(d.last)}` : 'Not clocked in'];
    html += `<section class="card">
      <div class="spread">
        <span class="status-pill ${pill[0]}"><span class="dot"></span>${pill[1]}</span>
        ${mode ? `<button class="b-link b-small" data-act="toggle-since">${editSince ? 'Done' : 'Adjust'}</button>` : ''}
      </div>
      ${mode && editSince ? `<div class="row" style="margin-top:10px"><span class="muted small">${mode === 'work' ? 'Started' : 'Pause started'} at</span>
        <input ${TIME_ATTRS} id="sinceInput" value="${C.timeOf(cur.since)}"></div>` : ''}
      <div class="timers">
        <div class="big" id="liveClock">${C.fmtClock(d.worked)}</div>
        ${mode === 'pause' ? `<div class="pause-timer" title="Current pause">⏸ <span id="livePause">${C.fmtClock((t - cur.since) / C.MIN)}</span></div>` : ''}
      </div>
      <div class="muted small">worked today${d.target ? ` of ${C.fmtDur(d.target)} h target` : ''}${d.absenceCredit ? ` · +${C.fmtDur(d.absenceCredit)} absence credit` : ''}${leave ? `<br>(target reached at ${C.timeOf(leave)})` : ''}</div>
      <div class="btns">
        ${!cur || stale ? `<button class="b-work full" data-act="in" ${stale ? 'disabled style="opacity:.4"' : ''}>▶︎ Clock in</button>` : ''}
        ${mode === 'work' ? `<button class="b-pause" data-act="pause">⏸ Pause</button><button class="b-stop" data-act="out">■ Clock out</button>` : ''}
        ${mode === 'pause' ? `<button class="b-work" data-act="resume">▶︎ Resume</button><button class="b-stop" data-act="out">■ Clock out</button>` : ''}
      </div>
    </section>`;
  } else {
    // summary card for another day
    html += `<section class="card">
      <div class="big">${C.fmtDur(d.credited)}</div>
      <div class="muted small">${isPast ? 'h credited' : 'h planned'}${d.target ? ` of ${C.fmtDur(d.target)} h target` : ' · no target (day off)'}${d.absenceCredit && d.worked ? ` · ${C.fmtDur(d.worked)} worked + ${C.fmtDur(d.absenceCredit)} absence credit` : ''}</div>
    </section>`;
  }

  d.warnings.forEach((w) => { html += `<div class="warn">⚠️ ${esc(w)}</div>`; });

  // stats
  if (isToday) {
    const leaveZero = C.leaveAt(state, d, d.target - before, t);
    html += `<section class="card"><div class="stats three">
      <div class="stat"><div class="k">Pause</div><div class="v">${C.fmtDur(d.pause)}</div></div>
      <div class="stat"><div class="k">Today ±</div><div class="v ${signCls(d.diff)}">${C.fmtDur(d.diff, true)}</div></div>
      <div class="stat"><div class="k">Overtime${counts ? '' : ' <span class="nowrap">(until yesterday)</span>'}</div><div class="v ${signCls(balance)}">${C.fmtDur(balance, true)}</div></div>
    </div>
    ${leaveZero && C.dateKey(leaveZero) === key && Math.abs(leaveZero - (leave || 0)) > C.MIN ? `<div class="muted small" style="margin-top:10px">Leave at ${C.timeOf(leaveZero)} to bring your overall balance to zero.</div>` : ''}
    </section>`;
  } else if (isPast) {
    html += `<section class="card"><div class="stats">
      <div class="stat"><div class="k">Pause</div><div class="v">${C.fmtDur(d.pause)}</div></div>
      <div class="stat"><div class="k">Day ±</div><div class="v ${signCls(d.diff)}">${counts ? C.fmtDur(d.diff, true) : '–'}</div></div>
      <div class="stat"><div class="k">Balance at end of day</div><div class="v ${signCls(balance)}">${C.fmtDur(balance, true)}</div></div>
      <div class="stat"><div class="k">First in · last out</div><div class="v">${d.first ? `${C.timeOf(d.first)}–${d.running ? '…' : C.timeOf(d.last)}` : '–'}</div></div>
    </div></section>`;
  }

  // timeline
  html += `<h2>Entries</h2><div class="list">`;
  const rows = [];
  d.intervals.forEach((iv, i) => {
    if (i > 0 && iv.start > d.intervals[i - 1].end) {
      const prev = d.intervals[i - 1].end;
      rows.push(`<div class="li"><span class="tag pause">Pause</span><span class="grow num">${C.timeOf(prev)}–${C.timeOf(iv.start)}${state.days[key]?.autoPause ? ' <span class="muted small">auto</span>' : ''}</span><span class="num muted">${C.fmtDur((iv.start - prev) / C.MIN)}</span></div>`);
    }
    rows.push(`<div class="li"><span class="tag work">Work</span><span class="grow num">${C.timeOf(iv.start)}–${iv.running ? 'now' : C.timeOf(iv.end)}</span><span class="num muted">${C.fmtDur((iv.end - iv.start) / C.MIN)}</span></div>`);
  });
  if (d.onPause && !stale) rows.push(`<div class="li"><span class="tag pause">Pause</span><span class="grow num">${C.timeOf(cur.since)}–now</span><span class="num muted">${C.fmtDur((t - cur.since) / C.MIN)}</span></div>`);
  d.absences.forEach((a) => rows.push(`<div class="li"><span class="grow">${esc(absLabel(a))}${a.note ? ` <span class="muted small">· ${esc(a.note)}</span>` : ''}</span></div>`));
  if (d.note) rows.push(`<div class="li muted small">📝 ${esc(d.note)}</div>`);
  if (!rows.length) rows.push(`<div class="li muted">Nothing recorded${isToday ? ' yet' : ''}.</div>`);
  html += rows.join('') + `<div class="li"><button class="b-link" data-act="edit" data-key="${key}">${isToday ? 'Edit today' : 'Edit this day'} / add appointment…</button></div></div>`;

  // quick add (for the day shown)
  html += `<div class="quick">
    <button class="b-small" data-act="quick" data-type="doctor" data-key="${key}">🩺 Doctor</button>
    <button class="b-small" data-act="quick" data-type="appointment" data-key="${key}" aria-label="Other appointment">📋 Appt.</button>
    <button class="b-small" data-act="quick" data-type="sick" data-key="${key}">🤒 Sick</button>
    <button class="b-small" data-act="quick" data-type="vacation" data-key="${key}">🌴 Vacation</button>
  </div>`;

  // week of the day shown
  const monday = C.addDays(key, -((C.weekday(key) + 6) % 7));
  const sunday = C.addDays(monday, 6);
  const wk = C.rangeTotals(state, monday, sunday, today, t);
  const scale = Math.max(480, ...wk.days.map((x) => Math.max(x.target, x.credited)));
  const thisWeek = today >= monday && today <= sunday;
  html += `<h2>${thisWeek ? 'This week' : `Week of ${esc(shortDate(monday))}`}</h2><section class="card">
    <div class="spread"><span><b class="num">${C.fmtDur(wk.credited)}</b> <span class="muted">of ${C.fmtDur(wk.target)} h</span></span>
    <span class="num ${signCls(wk.diff)}">${C.fmtDur(wk.diff, true)}</span></div>
    <div class="week">${wk.days.map((x) => `
      <div class="wk ${x.key === key ? 'today' : ''}" data-act="goto-day" data-key="${x.key}">
        <div class="bar">
          <i style="height:${(x.worked / scale) * 100}%"></i>
          ${x.absenceCredit ? `<i class="abs" style="height:${(x.absenceCredit / scale) * 100}%;position:absolute;bottom:${(x.worked / scale) * 100}%"></i>` : ''}
          ${x.target ? `<b style="bottom:${(x.target / scale) * 100}%"></b>` : ''}
        </div>
        <span>${WD_SHORT[C.weekday(x.key)].slice(0, 2)}</span>
      </div>`).join('')}</div>
  </section>
  <p class="muted small" style="text-align:center">Swipe left for the previous day, right for the next.</p>`;
  return html;
}

function viewMonth() {
  const t = now();
  const today = todayKey();
  const first = `${cursor.y}-${C.pad(cursor.m + 1)}-01`;
  const last = C.dateKey(new Date(cursor.y, cursor.m + 1, 0));
  const tot = C.rangeTotals(state, first, last, today, t);
  const endBal = C.balanceBefore(state, last < today ? C.addDays(last, 1) : C.addDays(today, 1), t);

  let html = `<div class="monthnav">
    <button class="b-small" data-act="month" data-d="-1" aria-label="Previous month">‹</button>
    <h1>${MONTHS[cursor.m]} ${cursor.y}</h1>
    <button class="b-small" data-act="month" data-d="1" aria-label="Next month">›</button>
  </div>
  <section class="card"><div class="stats">
    <div class="stat"><div class="k">Credited</div><div class="v">${C.fmtDur(tot.credited)}</div></div>
    <div class="stat"><div class="k">Target (whole month)</div><div class="v">${C.fmtDur(tot.target)}</div></div>
    <div class="stat"><div class="k">Month ±</div><div class="v ${signCls(tot.diff)}">${C.fmtDur(tot.diff, true)}</div></div>
    <div class="stat"><div class="k">Balance at ${last < today ? 'month end' : 'today'}</div><div class="v ${signCls(endBal)}">${C.fmtDur(endBal, true)}</div></div>
  </div>
  <div class="row" style="margin-top:12px"><button class="b-small" data-act="csv">⬇︎ Export CSV</button>
  <span class="muted small">Worked ${C.fmtDur(tot.worked)} · pause ${C.fmtDur(tot.pause)}</span></div></section>`;

  // calendar grid, Monday first
  const lead = (C.weekday(first) + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell other" aria-hidden="true"></div>');
  const holidays = [];
  for (const d of tot.days) {
    const wd = C.weekday(d.key);
    const weekend = !state.settings.workdays.includes(wd);
    const vacation = d.absences.some((a) => a.type === 'vacation');
    const dayOff = !!d.holiday || vacation;
    if (d.holiday) holidays.push(d);
    const showDiff = C.countsTowardBalance(d, today, state.settings.startDate) && (d.target || d.credited);
    const icons = [...new Set(d.absences.filter((a) => a.type !== 'publicHoliday' && a.type !== 'vacation')
      .map((a) => C.ABSENCE_TYPES[a.type]?.icon))].join('') + (d.note ? '📝' : '') + (d.warnings.length ? '⚠️' : '');
    const title = [shortDate(d.key), d.holiday, ...d.absences.filter((a) => a.type !== 'publicHoliday').map(absLabel)].filter(Boolean).join(' · ');
    cells.push(`<div class="cal-cell${weekend ? ' weekend' : ''}${dayOff ? ' dayoff' : ''}${d.key === today ? ' today' : ''}${d.running || d.onPause ? ' live' : ''}"
        data-act="edit" data-key="${d.key}" title="${esc(title)}" role="button" aria-label="${esc(title)}">
      <span class="cn">${Number(d.key.slice(8))}</span>
      ${vacation ? '<span class="ci">🌴</span>' : d.credited >= 1 ? `<span class="ch">${C.fmtDur(d.credited)}</span>` : ''}
      ${showDiff && !vacation ? `<span class="cd ${signCls(d.diff)}">${C.fmtDur(d.diff, true)}</span>` : ''}
      ${icons ? `<span class="ci">${icons}</span>` : ''}
    </div>`);
  }
  while (cells.length % 7) cells.push('<div class="cal-cell other" aria-hidden="true"></div>');

  html += `<div class="cal">
    ${WD_ORDER.map((w) => `<div class="cal-h">${WD_SHORT[w].slice(0, 2)}</div>`).join('')}
    ${cells.join('')}
  </div>
  <div class="legend" style="margin:10px 4px 0">
    <span style="--c:var(--neg)">Holiday / vacation</span><span style="--c:var(--pos)">Above target</span><span style="--c:var(--accent)">Today</span>
  </div>`;
  if (holidays.length) {
    html += `<h2>Public holidays</h2><div class="list">${holidays.map((d) =>
      `<div class="li"><span class="cal-hn">${Number(d.key.slice(8))}</span><span class="grow">${esc(d.holiday)}</span><span class="muted small">${WD_SHORT[C.weekday(d.key)]}</span></div>`).join('')}</div>`;
  }
  return html;
}

function viewVacation() {
  const today = todayKey();
  const v = C.vacationSummary(state, vacYear, today);
  const pct = (n) => (v.entitlement > 0 ? Math.max(0, (n / v.entitlement) * 100) : 0);
  const hol = C.publicHolidays(vacYear, state.settings.holidayRegion);
  const manualHol = Object.entries(state.days).filter(([k, d]) => k.startsWith(`${vacYear}-`) && d.absences?.some((a) => a.type === 'publicHoliday'));
  const allHol = { ...hol };
  manualHol.forEach(([k]) => { allHol[k] = C.holidayName(state, k); });

  let html = `<div class="monthnav">
    <button class="b-small" data-act="vyear" data-d="-1" aria-label="Previous year">‹</button>
    <h1>Vacation ${vacYear}</h1>
    <button class="b-small" data-act="vyear" data-d="1" aria-label="Next year">›</button>
  </div>
  <section class="card">
    <div class="spread"><span><span class="big" style="font-size:40px">${fmtDays(v.remaining)}</span> <span class="muted">days left</span></span>
    <span class="muted">of ${fmtDays(v.entitlement)}</span></div>
    <div class="meter">
      <i style="width:${pct(v.taken)}%;background:var(--vac)"></i>
      <i style="width:${pct(v.planned)}%;background:color-mix(in srgb, var(--vac) 45%, transparent)"></i>
    </div>
    <div class="legend">
      <span style="--c:var(--vac)">Taken ${fmtDays(v.taken)}</span>
      <span style="--c:color-mix(in srgb, var(--vac) 45%, transparent)">Planned ${fmtDays(v.planned)}</span>
      <span style="--c:var(--chip)">Remaining ${fmtDays(v.remaining)}</span>
    </div>
  </section>

  <h2>Add vacation</h2>
  <div class="list">
    <label class="field inline"><span class="k">From</span><input type="date" id="vFrom" value="${vacFrom || today}"></label>
    <label class="field inline"><span class="k">To</span><input type="date" id="vTo" value="${vacFrom || today}"></label>
    <label class="field inline"><span class="k">Half day</span><input type="checkbox" id="vHalf"></label>
    <div class="li"><button class="b-accent grow" data-act="add-vac">Add vacation</button></div>
  </div>
  <p class="muted small" style="margin:-4px 4px 0">Weekends and public holidays in the range are skipped automatically.</p>

  <h2>Days off in ${vacYear}</h2><div class="list">`;
  html += v.list.length ? v.list.map((x) => `<div class="li">
      <span class="grow tap" data-act="edit" data-key="${x.key}">${esc(shortDate(x.key))}${x.key > today ? ' <span class="tag vac">planned</span>' : ''}${x.note ? ` <span class="muted small">${esc(x.note)}</span>` : ''}</span>
      <span class="num muted">${x.days === 0.5 ? '½' : x.days} d</span>
      <button class="b-icon" data-act="del-vac" data-key="${x.key}" data-id="${x.id}" aria-label="Delete">✕</button>
    </div>`).join('') : '<div class="li muted">No vacation entered yet.</div>';
  html += `</div>

  <h2>Allowance</h2><div class="list">
    <label class="field inline"><span class="k">Days per year</span><input type="text" inputmode="decimal" data-set="vacationDaysPerYear" value="${state.settings.vacationDaysPerYear}"></label>
    <label class="field inline"><span class="k">Carry-over / adjustment ${vacYear}</span><input type="text" data-carry="${vacYear}" value="${state.settings.carryOver?.[vacYear] ?? 0}"></label>
  </div>
  <p class="muted small" style="margin:-4px 4px 0">Use the adjustment for leftover days from last year (positive) or days already taken before you started using this app (negative).</p>

  <h2>Public holidays ${vacYear}</h2><div class="list">`;
  const hk = Object.keys(allHol).sort();
  html += hk.length ? hk.map((k) => `<div class="li"><span class="grow">${esc(allHol[k])}</span><span class="muted small">${esc(shortDate(k))}</span></div>`).join('')
    : `<div class="li muted">None. Choose a region in Settings, or add “Public holiday” to a day in the Month view.</div>`;
  return html + '</div>';
}

function viewSettings() {
  const s = state.settings;
  const perDay = s.workdays.length ? (s.weeklyHours * 60) / s.workdays.length : 0;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<h1>Settings</h1>
  ${standalone ? '' : `<div class="card small"><b>📲 Install on your iPhone:</b> open this page in Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen and works offline.</div>`}

  <h2>Working time</h2><div class="list">
    <label class="field inline"><span class="k">Hours per week</span><input type="text" inputmode="decimal" data-set="weeklyHours" value="${s.weeklyHours}"></label>
    <div class="field"><span class="k">Working days</span><div class="wdays">
      ${WD_ORDER.map((d) => `<label><input type="checkbox" data-wd="${d}" ${s.workdays.includes(d) ? 'checked' : ''}><span>${WD_SHORT[d].slice(0, 2)}</span></label>`).join('')}
    </div><div class="muted small" style="margin-top:8px">= ${C.fmtDur(perDay)} h per working day</div></div>
    <label class="field inline"><span class="k">Track balance from</span><input type="date" data-set="startDate" value="${s.startDate}"></label>
    <label class="field inline"><span class="k">Starting overtime (h)</span><input type="text" data-set="initialBalanceH" value="${(s.initialBalanceMin / 60).toFixed(2).replace(/\.?0+$/, '') || 0}"></label>
  </div>

  <h2>Appointments</h2><div class="list">
    <label class="field inline"><span class="k">Count as work from</span><input type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5" data-set="apptWindowStart" value="${s.apptWindowStart}"></label>
    <label class="field inline"><span class="k">until</span><input type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5" data-set="apptWindowEnd" value="${s.apptWindowEnd}"></label>
  </div>
  <p class="muted small" style="margin:-4px 4px 0">A doctor's appointment from 15:00–17:30 credits 1:00 h (15:00–16:00).</p>

  <h2>Pause rule</h2><div class="list">
    <label class="field inline"><span class="k">If pause is too short</span><select data-set="pauseRule">
      <option value="off" ${s.pauseRule === 'off' ? 'selected' : ''}>Do nothing</option>
      <option value="warn" ${s.pauseRule === 'warn' ? 'selected' : ''}>Warn me</option>
      <option value="deduct" ${s.pauseRule === 'deduct' ? 'selected' : ''}>Auto-deduct</option>
    </select></label>
    <label class="field inline"><span class="k">Minimum pause (min)</span><input type="number" min="0" step="5" inputmode="numeric" data-set="minPauseMin" value="${s.minPauseMin}"></label>
    <label class="field inline"><span class="k">Add pause if none taken</span><input type="checkbox" data-set="autoPause" ${s.autoPause ? 'checked' : ''}></label>
    ${s.autoPause ? `<label class="field inline"><span class="k">Automatic pause starts at</span><input ${TIME_ATTRS} data-set="autoPauseStart" value="${s.autoPauseStart}"></label>` : ''}
    <label class="field inline"><span class="k">Required after (h)</span><input type="text" inputmode="decimal" data-set="minPauseAfterH" value="${s.minPauseAfterMin / 60}"></label>
  </div>
  ${s.autoPause ? `<p class="muted small" style="margin:-4px 4px 0">When you clock out after more than ${C.fmtDur(s.minPauseAfterMin)} h without any pause, ${s.autoPauseStart}–${C.timeOf(C.atTime('2000-01-01', s.autoPauseStart) + s.minPauseMin * C.MIN)} is recorded as pause.</p>` : ''}

  <h2>Public holidays</h2><div class="list">
    <label class="field inline"><span class="k">Region</span><select data-set="holidayRegion">
      ${Object.entries(C.HOLIDAY_REGIONS).map(([k, l]) => `<option value="${k}" ${s.holidayRegion === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
  </div>

  <h2>Your data</h2><div class="list">
    <div class="li"><span class="grow small muted">Everything is stored only on this device. Export a backup regularly (e.g. to iCloud Drive). Import the file on another device to move your data.</span></div>
    <div class="li"><button class="grow" data-act="export">⬇︎ Export backup</button><button class="grow" data-act="import">⬆︎ Import backup</button></div>
    <div class="li"><button class="b-link" style="color:var(--danger)" data-act="reset">Delete all data…</button></div>
  </div>
  <input type="file" id="importFile" accept="application/json,.json" hidden>
  <p class="muted small" style="text-align:center;margin-top:24px">Time Tracker · your personal time tracking</p>`;
}

// ---------- day editor ----------

function openEditor(key, preset) {
  const day = state.days[key] || {};
  draft = {
    key,
    work: (day.work || []).map((w) => ({ start: C.timeOf(w.start), end: C.timeOf(w.end) })),
    absences: (day.absences || []).map((a) => ({ ...a })),
    note: day.note || '',
  };
  if (preset) draft.absences.push(newAbsence(preset));
  renderEditor();
  $dlg.showModal();
}

function newAbsence(type) {
  const a = { id: C.uid(), type };
  if (C.ABSENCE_TYPES[type].timed) { a.start = '09:00'; a.end = '10:00'; }
  return a;
}

function renderEditor() {
  const { key } = draft;
  const s = state.settings;
  const cur = state.current;
  const running = cur && C.dateKey(cur.since) === key;
  const holiday = C.holidayName(state, key);
  $dlg.innerHTML = `<form class="dlg" method="dialog" onsubmit="return false">
    <div class="dlg-head">
      <button type="button" class="b-link" data-act="dlg-cancel">Cancel</button>
      <h3>${esc(shortDate(key))}</h3>
      <button type="button" class="b-link" style="font-weight:700" data-act="dlg-save">Save</button>
    </div>
    ${holiday ? `<p class="muted small">🎉 ${esc(holiday)}</p>` : ''}
    <h2>Work periods</h2>
    <div class="list">
      ${draft.work.map((w, i) => `<div class="erow">
        <input type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5" data-w="${i}" data-f="start" value="${w.start}" aria-label="Start">
        <span class="muted">–</span>
        <input type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5" data-w="${i}" data-f="end" value="${w.end}" aria-label="End">
        <span class="grow"></span>
        <button type="button" class="b-icon" data-act="dlg-del-work" data-i="${i}" aria-label="Delete period">✕</button>
      </div>`).join('')}
      ${running ? `<div class="erow muted small">${cur.mode === 'work' ? `▶︎ Running since ${C.timeOf(cur.since)} (adjust on the Today screen)` : `⏸ On pause since ${C.timeOf(cur.since)}`}</div>` : ''}
      <div class="erow"><button type="button" class="b-link" data-act="dlg-add-work">+ Add work period</button></div>
    </div>
    <p class="muted small" style="margin:-4px 4px 0">Gaps between work periods count as pause.</p>

    <h2>Absences &amp; appointments</h2>
    <div class="list">
      ${draft.absences.map((a, i) => {
        const t = C.ABSENCE_TYPES[a.type];
        return `<div class="erow">
          <select data-a="${i}" data-f="type" aria-label="Type">
            ${Object.entries(C.ABSENCE_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
          </select>
          <button type="button" class="b-icon" data-act="dlg-del-abs" data-i="${i}" aria-label="Delete">✕</button>
          ${t.timed ? `<input type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5" data-a="${i}" data-f="start" value="${a.start || ''}" aria-label="From"><span class="muted">–</span><input type="text" inputmode="decimal" class="tm" placeholder="8:24" autocomplete="off" maxlength="5" data-a="${i}" data-f="end" value="${a.end || ''}" aria-label="Until">` : ''}
          ${t.allowHalf ? `<label class="row small"><input type="checkbox" data-a="${i}" data-f="half" ${a.half ? 'checked' : ''}> Half day</label>` : ''}
          <input type="text" data-a="${i}" data-f="note" value="${esc(a.note || '')}" placeholder="${a.type === 'publicHoliday' ? 'Name of holiday' : 'Note (optional)'}">
          ${t.timed ? `<span class="muted small">Counts as work between ${s.apptWindowStart} and ${s.apptWindowEnd}.</span>` : ''}
        </div>`;
      }).join('')}
      <div class="erow"><select id="addAbsType" aria-label="Add absence">
        <option value="">+ Add absence or appointment…</option>
        ${Object.entries(C.ABSENCE_TYPES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
      </select></div>
    </div>

    <h2>Note</h2>
    <textarea id="dayNote" placeholder="What did you work on?">${esc(draft.note)}</textarea>
  </form>`;
}

function saveEditor() {
  const { key } = draft;
  const typed = [...draft.work.flatMap((w) => [w.start, w.end]), ...draft.absences.filter((a) => C.ABSENCE_TYPES[a.type].timed).flatMap((a) => [a.start, a.end])];
  if (typed.some((v) => C.parseTime(v) === null)) { toast('Please enter times like 8:24 (or 824)'); return; }
  draft.work.forEach((w) => { w.start = C.parseTime(w.start); w.end = C.parseTime(w.end); });
  draft.absences.forEach((a) => { if (a.start) a.start = C.parseTime(a.start); if (a.end) a.end = C.parseTime(a.end); });
  const work = [];
  for (const w of draft.work) {
    if (!w.start || !w.end) continue;
    const start = C.atTime(key, w.start);
    let end = C.atTime(key, w.end);
    if (end <= start) end = C.atTime(C.addDays(key, 1), w.end); // past midnight
    work.push({ start, end });
  }
  work.sort((a, b) => a.start - b.start);
  const absences = draft.absences.map((a) => {
    const out = { id: a.id, type: a.type };
    if (C.ABSENCE_TYPES[a.type].timed) { out.start = a.start || '09:00'; out.end = a.end || out.start; }
    if (C.ABSENCE_TYPES[a.type].allowHalf && a.half) out.half = true;
    if (a.note?.trim()) out.note = a.note.trim();
    return out;
  });
  const bad = absences.find((a) => a.start && a.end <= a.start);
  if (bad) { toast('Appointment end must be after its start'); return; }
  const day = { work, absences, note: draft.note.trim() };
  if (!work.length && !absences.length && !day.note) delete state.days[key];
  else state.days[key] = day;
  save();
  $dlg.close();
  draft = null;
  render();
  toast('Saved');
}

$dlg.addEventListener('input', (e) => {
  const el = e.target;
  if (!draft) return;
  if (el.id === 'dayNote') draft.note = el.value;
  else if (el.dataset.w) draft.work[el.dataset.w][el.dataset.f] = el.value;
  else if (el.dataset.a) {
    const a = draft.absences[el.dataset.a];
    a[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.f === 'type') {
      if (C.ABSENCE_TYPES[a.type].timed && !a.start) { a.start = '09:00'; a.end = '10:00'; }
      renderEditor();
    }
  }
});
$dlg.addEventListener('change', (e) => {
  if (e.target.id === 'addAbsType' && e.target.value) {
    draft.absences.push(newAbsence(e.target.value));
    renderEditor();
  }
});
$dlg.addEventListener('close', () => { draft = null; });
$dlg.addEventListener('click', (e) => { if (e.target === $dlg) $dlg.close(); });

// ---------- actions ----------

const actions = {
  in() { C.clockIn(state, now()); editSince = false; toast('Clocked in — have a good day!'); },
  pause() { C.startPause(state, now()); toast('Enjoy your break'); },
  resume() { C.resume(state, now()); toast('Back to work'); },
  out() {
    const auto = C.clockOut(state, now());
    editSince = false;
    const d = C.dayStats(state, todayKey(), now());
    toast(`Clocked out · ${C.fmtDur(d.worked)} h worked${auto ? ` · ${state.settings.minPauseMin} min pause added` : ''}`);
  },
  'toggle-since'() { editSince = !editSince; },
  'fix-stale'() {
    const cur = state.current;
    const k = C.dateKey(cur.since);
    const v = C.parseTime(document.getElementById('staleOut')?.value);
    if (v === null) { toast('Please enter a time like 16:30'); return false; }
    let end = v ? C.atTime(k, v) : cur.since;
    if (end < cur.since) end = cur.since;
    const auto = C.clockOut(state, end);
    toast(auto ? `Fixed · ${state.settings.minPauseMin} min pause added` : 'Fixed');
  },
  edit(el) { openEditor(el.dataset.key); return false; },
  quick(el) {
    const type = el.dataset.type;
    const key = el.dataset.key || todayKey();
    if (type === 'vacation') { tab = 'vacation'; vacFrom = key; vacYear = Number(key.slice(0, 4)); return; }
    openEditor(key, type);
    return false;
  },
  day(el) { goDay(Number(el.dataset.d)); return false; },
  'day-today'() { const back = dayView > todayKey(); dayView = null; slide = back ? 'prev' : 'next'; },
  'goto-day'(el) {
    const k = el.dataset.key;
    const from = dayView || todayKey();
    if (k === from) return false;
    slide = k < from ? 'prev' : 'next';
    dayView = k === todayKey() ? null : k;
  },
  'backup-now'() { exportBackup(); return false; },
  'backup-later'() { state.meta.backupSnoozeUntil = Date.now() + 7 * DAY; toast("OK, I'll remind you in a week"); },
  month(el) { goMonth(Number(el.dataset.d)); return false; },
  vyear(el) { vacYear += Number(el.dataset.d); },
  'add-vac'() {
    const from = document.getElementById('vFrom').value;
    const to = document.getElementById('vTo').value || from;
    const half = document.getElementById('vHalf').checked;
    if (!from || to < from) { toast('Please choose a valid date range'); return false; }
    const n = C.addVacationRange(state, from, to, half);
    toast(n ? `Added ${half ? n / 2 : n} vacation day${n === 1 && !half ? '' : 's'}` : 'No working days in that range');
    vacYear = Number(from.slice(0, 4));
  },
  'del-vac'(el) {
    const day = state.days[el.dataset.key];
    if (!day) return false;
    day.absences = (day.absences || []).filter((a) => a.id !== el.dataset.id);
    if (!day.absences.length && !day.work?.length && !day.note) delete state.days[el.dataset.key];
    toast('Removed');
  },
  csv() {
    const first = `${cursor.y}-${C.pad(cursor.m + 1)}-01`;
    const last = C.dateKey(new Date(cursor.y, cursor.m + 1, 0));
    deliverFile(`timesheet-${cursor.y}-${C.pad(cursor.m + 1)}.csv`, C.toCSV(state, first, last, todayKey()), 'text/csv');
    return false;
  },
  export() { exportBackup(); return false; },
  import() { document.getElementById('importFile').click(); return false; },
  reset() {
    if (!confirm('Delete ALL your time entries and settings on this device? This cannot be undone.')) return false;
    state = C.emptyState(todayKey());
    toast('All data deleted');
  },
  'dlg-cancel'() { $dlg.close(); return false; },
  'dlg-save'() { saveEditor(); return false; },
  'dlg-add-work'() {
    const lastEnd = draft.work[draft.work.length - 1]?.end;
    draft.work.push({ start: lastEnd || '08:00', end: lastEnd ? '' : '16:30' });
    renderEditor();
    return false;
  },
  'dlg-del-work'(el) { draft.work.splice(Number(el.dataset.i), 1); renderEditor(); return false; },
  'dlg-del-abs'(el) { draft.absences.splice(Number(el.dataset.i), 1); renderEditor(); return false; },
};

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
    if (tab === 'today') dayView = null;
    if (tab !== 'vacation') vacFrom = null;
    localSet('timetrack.tab', tab); render(); window.scrollTo(0, 0); return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  // false = no state change (no save/render needed)
  if (actions[el.dataset.act](el) !== false) { save(); render(); }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.closest('dialog')) return;
  const s = state.settings;
  if (el.id === 'sinceInput' && state.current && el.value) {
    const hm = C.parseTime(el.value);
    if (!hm) return; // invalid input is flagged by the time-field handler
    const since = C.atTime(C.dateKey(state.current.since), hm);
    if (since > now()) { toast('That time is in the future'); render(); return; }
    // keep the pause/work order intact: can't start before the previous work period ended
    const prev = (state.days[C.dateKey(since)]?.work || []).map((w) => w.end).filter((x) => x <= state.current.since);
    state.current.since = Math.max(since, ...prev);
  } else if (el.id === 'importFile') {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const next = C.normalizeState(JSON.parse(text), todayKey());
        if (!confirm('Replace all data on this device with the backup?')) return;
        state = next; ensureMeta(); state.meta.lastBackup = Date.now(); save(); render(); toast('Backup imported');
      } catch (err) { toast(err.message || 'Could not read that file'); }
    });
    return;
  } else if (el.dataset.wd) {
    const d = Number(el.dataset.wd);
    s.workdays = el.checked ? [...new Set([...s.workdays, d])].sort() : s.workdays.filter((x) => x !== d);
  } else if (el.dataset.carry) {
    const n = parseNum(el.value);
    if (n === null) { toast('Please enter a number, e.g. 2 or -1.5'); render(); return; }
    s.carryOver = { ...s.carryOver, [el.dataset.carry]: n };
  } else if (el.dataset.set) {
    const k = el.dataset.set;
    const num = el.type === 'text' ? parseNum(el.value) : Number(el.value);
    if (num === null) { toast('Please enter a number, e.g. 38.5 or 38,5'); render(); return; }
    if (el.type === 'checkbox') s[k] = el.checked;
    else if (k === 'initialBalanceH') s.initialBalanceMin = Math.round((num || 0) * 60);
    else if (k === 'minPauseAfterH') s.minPauseAfterMin = Math.round((num || 0) * 60);
    else if (['weeklyHours', 'vacationDaysPerYear', 'minPauseMin'].includes(k)) s[k] = Math.max(0, num || 0);
    else if (el.classList.contains('tm')) { const hm = C.parseTime(el.value); if (!hm) return; s[k] = hm; }
    else if (el.value) s[k] = el.value;
  } else return;
  save(); render();
});

// Tidy a typed time when you leave the field: "824" → "08:24"; flag it if it isn't a time.
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.classList?.contains('tm')) return;
  const hm = C.parseTime(el.value);
  el.classList.toggle('bad', hm === null);
  if (hm === null) { toast('Please enter a time like 8:24 (or 824)'); return; }
  el.value = hm;
  if (draft && el.dataset.w) draft.work[el.dataset.w][el.dataset.f] = hm;
  if (draft && el.dataset.a) draft.absences[el.dataset.a][el.dataset.f] = hm;
}, true);

// ---------- swipe / arrow keys between days ----------
// Swipe left → previous day, swipe right → next day (as requested).
let touch = null;
$view.addEventListener('touchstart', (e) => {
  touch = (tab === 'today' || tab === 'month') && e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() } : null;
}, { passive: true });
$view.addEventListener('touchend', (e) => {
  if (!touch) return;
  const p = e.changedTouches[0];
  const dx = p.clientX - touch.x, dy = p.clientY - touch.y;
  const quick = Date.now() - touch.at < 800;
  touch = null;
  if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  if (e.target.closest('input, textarea, select')) return;
  if (tab === 'month') goMonth(dx < 0 ? -1 : 1); else goDay(dx < 0 ? -1 : 1);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if ((tab !== 'today' && tab !== 'month') || $dlg.open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement?.matches('input, textarea, select')) return;
  const go = tab === 'month' ? goMonth : goDay;
  if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
});

// ---------- live updates ----------

// Update the running clock every second; re-render the whole screen once a minute
// (not every second, so taps on buttons are never swallowed by a re-render).
let lastMinute = Math.floor(Date.now() / C.MIN);
function tick() {
  if (tab !== 'today' || dayView || $dlg.open || document.hidden) return;
  const minute = Math.floor(Date.now() / C.MIN);
  const active = document.activeElement;
  const typing = active && $view.contains(active) && active.matches('input, select, textarea');
  if (minute !== lastMinute && !typing) { lastMinute = minute; render(); return; }
  if (state.current) {
    const clock = document.getElementById('liveClock');
    if (clock) clock.textContent = C.fmtClock(C.dayStats(state, todayKey(), now()).worked);
    const pause = document.getElementById('livePause');
    if (pause && state.current.mode === 'pause') pause.textContent = C.fmtClock((now() - state.current.since) / C.MIN);
  }
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { state = load(); ensureMeta(); render(); }
});
window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); render(); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
  // When a new version takes over, reload once so it is used right away (your data is unaffected).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !draft) location.reload();
  });
}

render();
