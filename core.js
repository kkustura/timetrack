// core.js — pure time-tracking logic, no DOM.
// Timestamps are epoch milliseconds; days are local-time keys 'YYYY-MM-DD'.
// All durations returned by the stats functions are in minutes.

export const MIN = 60000;

export const ABSENCE_TYPES = {
  vacation:      { label: 'Vacation',            icon: '🌴', timed: false, allowHalf: true },
  sick:          { label: 'Sick leave',          icon: '🤒', timed: false, allowHalf: false },
  doctor:        { label: "Doctor's appointment", icon: '🩺', timed: true },
  appointment:   { label: 'Other appointment',   icon: '📋', timed: true },
  compTime:      { label: 'Comp time (day off)', icon: '⏳', timed: false, allowHalf: false },
  publicHoliday: { label: 'Public holiday',      icon: '🎉', timed: false, allowHalf: false },
};

export const HOLIDAY_REGIONS = {
  none: 'None (add manually)',
  AT: 'Austria',
  DE: 'Germany (nationwide)',
};

export function defaultSettings(today = dateKey(Date.now())) {
  return {
    weeklyHours: 40,
    workdays: [1, 2, 3, 4, 5],        // 0 = Sunday … 6 = Saturday
    vacationDaysPerYear: 25,
    carryOver: {},                    // { 2026: 3 } extra (or negative) vacation days per year
    apptWindowStart: '08:00',         // appointments count as work time inside this window
    apptWindowEnd: '16:00',
    startDate: today,                 // overtime balance is counted from this day
    initialBalanceMin: 0,             // overtime carried in from before startDate
    pauseRule: 'warn',                // 'off' | 'warn' | 'deduct'
    minPauseMin: 30,
    minPauseAfterMin: 360,
    holidayRegion: 'none',
  };
}

export function emptyState(today) {
  return { version: 1, settings: defaultSettings(today), days: {}, current: null, meta: {} };
}

// ---------- date helpers ----------

export const pad = (n) => String(n).padStart(2, '0');

export function dateKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export const weekday = (key) => parseKey(key).getDay();

export function hmToMin(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function atTime(key, hm) {
  const d = parseKey(key);
  const m = hmToMin(hm);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d.getTime();
}

/** Typed time → 'HH:MM'. Accepts "8:24", "08:24", "8.24", "8,24", "8h24", "824", "0824", "8".
 *  A single minute digit ("8:5") is rejected because it is ambiguous.
 *  Returns '' for empty input and null if it isn't a valid time. */
export function parseTime(str) {
  const t = String(str ?? '').trim().replace(/[.,hH ]/g, ':');
  if (t === '') return '';
  let h, m;
  let match;
  if ((match = t.match(/^(\d{1,2}):(\d{2})?$/))) { h = +match[1]; m = +(match[2] || 0); }
  else if ((match = t.match(/^\d{1,4}$/))) {
    const d = match[0];
    if (d.length <= 2) { h = +d; m = 0; } else { h = +d.slice(0, -2); m = +d.slice(-2); }
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function timeOf(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes → "7:45", "−0:30", or "+1:15" when signed. */
export function fmtDur(min, signed = false) {
  const abs = Math.round(Math.abs(min));
  if (abs === 0) return '0:00';
  const s = `${Math.floor(abs / 60)}:${pad(abs % 60)}`;
  if (min < 0) return `−${s}`;
  return signed ? `+${s}` : s;
}

/** Minutes → "7:45:12". */
export function fmtClock(min) {
  const sec = Math.max(0, Math.floor(min * 60));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}

export function keysBetween(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

// ---------- public holidays ----------

export function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateKey(new Date(y, month - 1, day));
}

const holidayCache = new Map();

export function publicHolidays(year, region) {
  const cacheKey = `${year}-${region}`;
  if (holidayCache.has(cacheKey)) return holidayCache.get(cacheKey);
  const out = {};
  if (region === 'AT' || region === 'DE') {
    const e = easterSunday(year);
    const fixed = (m, d, name) => { out[`${year}-${pad(m)}-${pad(d)}`] = name; };
    const rel = (n, name) => { out[addDays(e, n)] = name; };
    fixed(1, 1, "New Year's Day");
    rel(1, 'Easter Monday');
    fixed(5, 1, 'Labour Day');
    rel(39, 'Ascension Day');
    rel(50, 'Whit Monday');
    fixed(12, 25, 'Christmas Day');
    if (region === 'AT') {
      fixed(1, 6, 'Epiphany');
      rel(60, 'Corpus Christi');
      fixed(8, 15, 'Assumption Day');
      fixed(10, 26, 'National Day');
      fixed(11, 1, "All Saints' Day");
      fixed(12, 8, 'Immaculate Conception');
      fixed(12, 26, "St. Stephen's Day");
    } else {
      rel(-2, 'Good Friday');
      fixed(10, 3, 'German Unity Day');
      fixed(12, 26, 'Boxing Day');
    }
  }
  holidayCache.set(cacheKey, out);
  return out;
}

export function holidayName(state, key) {
  const manual = (state.days[key]?.absences || []).find((a) => a.type === 'publicHoliday');
  if (manual) return manual.note || 'Public holiday';
  return publicHolidays(Number(key.slice(0, 4)), state.settings.holidayRegion)[key] || null;
}

/** A regular working day (ignores the tracking start date). */
export function isWorkday(state, key) {
  return state.settings.workdays.includes(weekday(key)) && !holidayName(state, key);
}

export function dailyTarget(state, key) {
  const s = state.settings;
  if (key < s.startDate || !isWorkday(state, key) || !s.workdays.length) return 0;
  return (s.weeklyHours * 60) / s.workdays.length;
}

// ---------- interval math ----------

function merge(ranges) {
  const sorted = ranges.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(ranges, [c, d]) {
  const out = [];
  for (const [a, b] of ranges) {
    if (d <= a || c >= b) { out.push([a, b]); continue; }
    if (c > a) out.push([a, c]);
    if (d < b) out.push([d, b]);
  }
  return out;
}

const total = (ranges) => ranges.reduce((s, [a, b]) => s + (b - a), 0) / MIN;

// ---------- per-day statistics ----------

export function dayIntervals(state, key, now) {
  const list = (state.days[key]?.work || []).map((w) => ({ start: w.start, end: w.end }));
  const cur = state.current;
  if (cur?.mode === 'work' && dateKey(cur.since) === key) {
    list.push({ start: cur.since, end: Math.max(now, cur.since), running: true });
  }
  return list.sort((a, b) => a.start - b.start);
}

export function dayStats(state, key, now = Date.now()) {
  const s = state.settings;
  const day = state.days[key] || {};
  const target = dailyTarget(state, key);
  const intervals = dayIntervals(state, key, now);
  const merged = merge(intervals.map((i) => [i.start, i.end]));

  let worked = total(merged);
  let pause = 0;
  for (let i = 1; i < merged.length; i++) pause += (merged[i][0] - merged[i - 1][1]) / MIN;
  const cur = state.current;
  const onPause = cur?.mode === 'pause' && dateKey(cur.since) === key;
  if (onPause) pause += Math.max(0, now - cur.since) / MIN;

  const warnings = [];
  let pauseDeducted = 0;
  if (s.pauseRule !== 'off' && worked > s.minPauseAfterMin && pause < s.minPauseMin) {
    const shortfall = Math.min(s.minPauseMin - pause, worked - s.minPauseAfterMin);
    const after = fmtDur(s.minPauseAfterMin);
    if (s.pauseRule === 'deduct') {
      worked -= shortfall;
      pauseDeducted = shortfall;
      warnings.push(`${fmtDur(shortfall)} deducted: at least ${s.minPauseMin} min pause is required after ${after} h of work.`);
    } else {
      warnings.push(`Pause is shorter than ${s.minPauseMin} min after more than ${after} h of work.`);
    }
  }

  let fullDayCredit = 0;
  let vacationDays = 0;
  const appts = [];
  for (const a of day.absences || []) {
    if (a.type === 'vacation') {
      if (isWorkday(state, key)) vacationDays += a.half ? 0.5 : 1;
      fullDayCredit += a.half ? target / 2 : target;
    } else if (a.type === 'sick') {
      fullDayCredit += target;
    } else if (ABSENCE_TYPES[a.type]?.timed && a.start && a.end) {
      const st = Math.max(atTime(key, a.start), atTime(key, s.apptWindowStart));
      const en = Math.min(atTime(key, a.end), atTime(key, s.apptWindowEnd));
      if (en > st) appts.push([st, en]);
    }
  }
  fullDayCredit = Math.min(fullDayCredit, target);
  // Appointment time only counts inside the window and where you weren't already clocked in.
  let apptRanges = merge(appts);
  for (const m of merged) apptRanges = subtract(apptRanges, m);
  const apptCredit = total(apptRanges);

  const absenceCredit = fullDayCredit + apptCredit;
  const credited = worked + absenceCredit;
  return {
    key, target, worked, pause, pauseDeducted, absenceCredit, apptCredit, credited,
    diff: credited - target,
    intervals,
    first: intervals[0]?.start ?? null,
    last: intervals.length ? Math.max(...intervals.map((i) => i.end)) : null,
    running: intervals.some((i) => i.running),
    onPause,
    holiday: holidayName(state, key),
    vacationDays,
    absences: day.absences || [],
    note: day.note || '',
    warnings,
  };
}

/** Days from the start date on count; past days always, today only once you've
 *  clocked out and recorded something. */
export function countsTowardBalance(d, today, startDate = '') {
  if (d.key < startDate) return false;
  return d.key < today || (d.key === today && !d.running && !d.onPause && d.credited > 0);
}

/** Overtime balance accumulated before `key` (exclusive). */
export function balanceBefore(state, key, now = Date.now()) {
  let b = Number(state.settings.initialBalanceMin) || 0;
  const today = dateKey(now);
  for (let k = state.settings.startDate; k < key && k <= today; k = addDays(k, 1)) {
    const d = dayStats(state, k, now);
    if (countsTowardBalance(d, today)) b += d.diff;
  }
  return b;
}

export function rangeTotals(state, from, to, today, now = Date.now()) {
  const t = { target: 0, targetSoFar: 0, worked: 0, pause: 0, credited: 0, diff: 0, days: [] };
  for (const k of keysBetween(from, to)) {
    const d = dayStats(state, k, now);
    t.days.push(d);
    t.target += d.target;
    if (k <= today) {
      t.targetSoFar += d.target;
      t.worked += d.worked;
      t.pause += d.pause;
      t.credited += d.credited;
      if (countsTowardBalance(d, today, state.settings.startDate)) t.diff += d.diff;
    }
  }
  return t;
}

/** When to leave so that today's credited time reaches `goalMin`. */
/** When to leave so that today's credited time reaches `goalMin`, including any
 *  part of the minimum pause still to be taken (unless the pause rule is off). */
export function leaveAt(state, stats, goalMin, now) {
  if (!stats.running && !stats.onPause) return null;
  const s = state.settings;
  const worked = stats.worked + stats.pauseDeducted; // undo any deduction; it is re-added below
  let remaining = goalMin - (worked + stats.absenceCredit);
  if (remaining <= 0) return null;
  if (s.pauseRule !== 'off' && stats.pause < s.minPauseMin && worked + remaining > s.minPauseAfterMin) {
    remaining += Math.min(s.minPauseMin - stats.pause, worked + remaining - s.minPauseAfterMin);
  }
  return now + remaining * MIN;
}

// ---------- vacation ----------

export function vacationSummary(state, year, today) {
  const entitlement = (Number(state.settings.vacationDaysPerYear) || 0) + (Number(state.settings.carryOver?.[year]) || 0);
  let taken = 0, planned = 0;
  const list = [];
  for (const [key, day] of Object.entries(state.days)) {
    if (!key.startsWith(`${year}-`)) continue;
    (day.absences || []).forEach((a) => {
      if (a.type !== 'vacation') return;
      const days = isWorkday(state, key) ? (a.half ? 0.5 : 1) : 0;
      if (key <= today) taken += days; else planned += days;
      list.push({ key, id: a.id, days, half: !!a.half, note: a.note || '' });
    });
  }
  list.sort((a, b) => a.key.localeCompare(b.key));
  return { entitlement, taken, planned, remaining: entitlement - taken - planned, list };
}

export function addVacationRange(state, from, to, half = false) {
  let added = 0;
  for (const k of keysBetween(from, to)) {
    if (!isWorkday(state, k)) continue;
    const day = (state.days[k] ||= {});
    day.absences ||= [];
    if (day.absences.some((a) => a.type === 'vacation')) continue;
    day.absences.push({ id: uid(), type: 'vacation', half });
    added++;
  }
  return added;
}

// ---------- clock actions ----------

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function closeWork(state, end) {
  const since = state.current.since;
  if (end - since < MIN) return; // ignore accidental sub-minute taps
  const day = (state.days[dateKey(since)] ||= {});
  (day.work ||= []).push({ start: since, end });
}

export function clockIn(state, now) {
  if (!state.current) state.current = { mode: 'work', since: now };
}

export function startPause(state, now) {
  if (state.current?.mode !== 'work') return;
  closeWork(state, now);
  state.current = { mode: 'pause', since: now };
}

export function resume(state, now) {
  if (state.current?.mode === 'pause') state.current = { mode: 'work', since: now };
}

export function clockOut(state, now) {
  if (!state.current) return;
  if (state.current.mode === 'work') closeWork(state, Math.max(now, state.current.since));
  state.current = null;
}

// ---------- export / import ----------

const hours = (min) => (min / 60).toFixed(2);

export function toCSV(state, from, to, today, now = Date.now()) {
  const rows = [['Date', 'Weekday', 'First in', 'Last out', 'Pause (h)', 'Worked (h)', 'Absences', 'Credited (h)', 'Target (h)', 'Difference (h)', 'Note']];
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const k of keysBetween(from, to)) {
    const d = dayStats(state, k, now);
    const abs = d.absences.map((a) => {
      const t = ABSENCE_TYPES[a.type]?.label || a.type;
      return a.start ? `${t} ${a.start}-${a.end}` : a.half ? `${t} (half)` : t;
    });
    if (d.holiday && !d.absences.some((a) => a.type === 'publicHoliday')) abs.push(d.holiday);
    const future = k > today;
    rows.push([
      k, wd[weekday(k)],
      d.first ? timeOf(d.first) : '', d.last ? timeOf(d.last) : '',
      hours(d.pause), hours(d.worked), abs.join('; '), hours(d.credited), hours(d.target),
      future ? '' : hours(d.diff), d.note,
    ]);
  }
  return rows.map((r) => r.map((c) => (/[",;\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

export function normalizeState(raw, today) {
  if (!raw || typeof raw !== 'object' || typeof raw.days !== 'object' || !raw.settings) {
    throw new Error('This file does not look like a Time Tracker backup.');
  }
  return {
    version: 1,
    settings: { ...defaultSettings(today), ...raw.settings },
    days: raw.days,
    current: raw.current || null,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
  };
}
