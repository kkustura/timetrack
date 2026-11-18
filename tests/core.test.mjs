import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

const at = (key, hm) => C.atTime(key, hm);
const MON = '2026-11-16'; // a Monday

function fresh() {
  const s = C.emptyState('2026-11-01');
  return s;
}

test('easter dates', () => {
  assert.equal(C.easterSunday(2026), '2026-04-05');
  assert.equal(C.easterSunday(2025), '2025-04-20');
  assert.equal(C.easterSunday(2027), '2027-03-28');
});

test('clock in, pause, resume, clock out', () => {
  const s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  C.startPause(s, at(MON, '12:00'));
  C.resume(s, at(MON, '12:30'));
  let d = C.dayStats(s, MON, at(MON, '14:00'));
  assert.equal(d.worked, 5 * 60 + 30);
  assert.equal(d.pause, 30);
  assert.ok(d.running);
  C.clockOut(s, at(MON, '16:30'));
  d = C.dayStats(s, MON, at(MON, '20:00'));
  assert.equal(d.worked, 8 * 60);
  assert.equal(d.pause, 30);
  assert.equal(d.target, 8 * 60);
  assert.equal(d.diff, 0);
  assert.equal(s.current, null);
});

test('ongoing pause counts as pause, not work', () => {
  const s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  C.startPause(s, at(MON, '12:00'));
  const d = C.dayStats(s, MON, at(MON, '12:20'));
  assert.equal(d.worked, 240);
  assert.equal(d.pause, 20);
  assert.ok(d.onPause);
});

test('doctor appointment counts only inside 08–16 and not twice', () => {
  const s = fresh();
  s.days[MON] = {
    work: [{ start: at(MON, '07:00'), end: at(MON, '09:00') }],
    absences: [{ id: 'a', type: 'doctor', start: '08:30', end: '17:00' }],
  };
  const d = C.dayStats(s, MON, at(MON, '20:00'));
  // work 2h; appointment 08:30–17:00 → window-clipped 08:30–16:00, minus work overlap 08:30–09:00 → 7h
  assert.equal(d.worked, 120);
  assert.equal(d.apptCredit, 7 * 60);
  assert.equal(d.credited, 9 * 60);
});

test('vacation and sick credit the daily target; half vacation half', () => {
  const s = fresh();
  s.settings.weeklyHours = 38.5;
  s.days[MON] = { absences: [{ id: 'v', type: 'vacation' }] };
  s.days['2026-11-17'] = { absences: [{ id: 's', type: 'sick' }] };
  s.days['2026-11-18'] = {
    absences: [{ id: 'h', type: 'vacation', half: true }],
    work: [{ start: at('2026-11-18', '08:00'), end: at('2026-11-18', '11:51') }],
  };
  const target = 38.5 * 60 / 5;
  assert.equal(C.dayStats(s, MON).diff, 0);
  assert.equal(C.dayStats(s, '2026-11-17').diff, 0);
  const half = C.dayStats(s, '2026-11-18');
  assert.equal(half.credited, 231 + target / 2);
  assert.equal(half.vacationDays, 0.5);
});

test('weekends and public holidays have no target', () => {
  const s = fresh();
  assert.equal(C.dailyTarget(s, '2026-11-21'), 0); // Saturday
  s.settings.holidayRegion = 'AT';
  assert.equal(C.dailyTarget(s, '2026-12-08'), 0); // Immaculate Conception, Tuesday
  assert.equal(C.holidayName(s, '2026-04-06'), 'Easter Monday');
  s.settings.holidayRegion = 'DE';
  assert.equal(C.holidayName(s, '2026-04-03'), 'Good Friday');
  assert.equal(C.holidayName(s, '2026-12-08'), null);
});

test('pause rule: warn vs deduct', () => {
  const s = fresh();
  s.days[MON] = { work: [{ start: at(MON, '08:00'), end: at(MON, '16:00') }] };
  let d = C.dayStats(s, MON);
  assert.equal(d.worked, 480);
  assert.equal(d.warnings.length, 1);
  s.settings.pauseRule = 'deduct';
  d = C.dayStats(s, MON);
  assert.equal(d.worked, 450);
  s.settings.pauseRule = 'off';
  assert.equal(C.dayStats(s, MON).warnings.length, 0);
});

test('vacation range skips weekends/holidays and summary counts', () => {
  const s = fresh();
  s.settings.holidayRegion = 'AT';
  const n = C.addVacationRange(s, '2026-12-21', '2027-01-08');
  // Dec 21–24 (4), 28–31 (4), Jan 4–5,7–8 (4) — 25/26 Dec, 1 and 6 Jan are holidays
  assert.equal(n, 12);
  const v26 = C.vacationSummary(s, 2026, '2026-12-22');
  assert.equal(v26.taken, 2);
  assert.equal(v26.planned, 6);
  assert.equal(v26.remaining, 17);
  s.settings.carryOver = { 2027: 3 };
  assert.equal(C.vacationSummary(s, 2027, '2026-12-22').remaining, 24);
});

test('balance accumulates from start date', () => {
  const s = fresh();
  s.settings.startDate = MON;
  s.settings.initialBalanceMin = 60;
  s.days[MON] = { work: [{ start: at(MON, '08:00'), end: at(MON, '17:30') }] }; // 9.5h, warn only
  assert.equal(C.balanceBefore(s, '2026-11-17'), 60 + 90);
  assert.equal(C.balanceBefore(s, MON), 60);
});

test('leave-at accounts for target', () => {
  const s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  const now = at(MON, '10:00');
  const d = C.dayStats(s, MON, now);
  assert.equal(C.timeOf(C.leaveAt(s, d, d.target, now)), '16:30'); // includes 30 min break
  s.settings.pauseRule = 'deduct';
  assert.equal(C.timeOf(C.leaveAt(s, C.dayStats(s, MON, now), d.target, now)), '16:30');
  s.settings.pauseRule = 'off';
  assert.equal(C.timeOf(C.leaveAt(s, C.dayStats(s, MON, now), d.target, now)), '16:00');
});

test('38.5 h week: leave time includes the remaining break', () => {
  const s = fresh();
  s.settings.weeklyHours = 38.5; // 7:42 per day
  C.clockIn(s, at(MON, '08:00'));
  C.startPause(s, at(MON, '12:00'));
  C.resume(s, at(MON, '12:10')); // 10 min taken, 20 min still owed
  const now = at(MON, '13:00');
  const d = C.dayStats(s, MON, now);
  assert.equal(C.timeOf(C.leaveAt(s, d, d.target, now)), '16:12');
  // late in the day with deduct active, leave time stays consistent
  s.settings.pauseRule = 'deduct';
  const late = at(MON, '15:00');
  assert.equal(C.timeOf(C.leaveAt(s, C.dayStats(s, MON, late), d.target, late)), '16:12');
});

test('formatting', () => {
  assert.equal(C.fmtDur(90), '1:30');
  assert.equal(C.fmtDur(-30), '−0:30');
  assert.equal(C.fmtDur(75, true), '+1:15');
  assert.equal(C.fmtDur(0.4, true), '0:00');
  assert.equal(C.fmtClock(61.5), '1:01:30');
});

test('csv and import roundtrip', () => {
  const s = fresh();
  s.days[MON] = { work: [{ start: at(MON, '08:00'), end: at(MON, '16:30') }], note: 'hello, "world"' };
  const csv = C.toCSV(s, MON, MON, MON);
  assert.match(csv, /2026-11-16,Mon,08:00,16:30,0.00,8.50,,8.50,8.00,0.50,"hello, ""world"""/);
  const back = C.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.days, s.days);
  assert.throws(() => C.normalizeState({ foo: 1 }));
});

test('pause is counted right after resuming', () => {
  const s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  C.startPause(s, at(MON, '12:00'));
  C.resume(s, at(MON, '12:30'));
  assert.equal(C.dayStats(s, MON, at(MON, '12:30')).pause, 30);
});

test('today only counts toward balance after clocking out', () => {
  const s = fresh();
  s.settings.startDate = MON;
  const noon = at(MON, '12:00');
  assert.equal(C.balanceBefore(s, C.addDays(MON, 1), noon), 0); // nothing recorded yet
  C.clockIn(s, at(MON, '08:00'));
  assert.equal(C.balanceBefore(s, C.addDays(MON, 1), noon), 0); // still working
  C.clockOut(s, at(MON, '15:00'));
  // 7 h without a break → 30 min automatic pause → 6:30 credited
  assert.equal(C.balanceBefore(s, C.addDays(MON, 1), at(MON, '16:00')), -90);
  assert.equal(C.balanceBefore(s, '2026-11-18', at('2026-11-18', '09:00')), -90 - 480); // Tue missed
});

test('typed times', () => {
  const ok = { '8:24': '08:24', '08:24': '08:24', '8.24': '08:24', '8,24': '08:24', '824': '08:24', '0824': '08:24',
    '1630': '16:30', '8': '08:00', '16': '16:00', '8:': '08:00', ' 9h15 ': '09:15', '': '' };
  for (const [inp, out] of Object.entries(ok)) assert.equal(C.parseTime(inp), out, inp);
  for (const bad of ['25:00', '8:60', '8:5', '8.2', 'abc', '12345', '7:30pm']) assert.equal(C.parseTime(bad), null, bad);
});

test('days before the start date do not count toward week/month ±', () => {
  const s = fresh();
  s.settings.startDate = '2026-11-18'; // Wednesday
  s.days[MON] = { work: [{ start: at(MON, '08:00'), end: at(MON, '16:00') }] };
  const wk = C.rangeTotals(s, MON, '2026-11-22', '2026-11-19', at('2026-11-19', '07:00'));
  assert.equal(wk.credited, 480);   // hours are still shown
  assert.equal(wk.diff, -480);      // only Wednesday (missed) counts
});

test('automatic pause on clock-out', () => {
  // full day without pause → 12:00–12:30 inserted
  let s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  assert.equal(C.clockOut(s, at(MON, '16:30')), true);
  let d = C.dayStats(s, MON, at(MON, '18:00'));
  assert.equal(d.worked, 480);
  assert.equal(d.pause, 30);
  assert.equal(C.timeOf(s.days[MON].work[0].end), '12:00');
  assert.equal(d.warnings.length, 0);

  // short day (≤ 6 h) → untouched
  s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  assert.equal(C.clockOut(s, at(MON, '12:45')), false);
  assert.equal(C.dayStats(s, MON).pause, 0);

  // pause already taken → untouched
  s = fresh();
  C.clockIn(s, at(MON, '08:00'));
  C.startPause(s, at(MON, '11:00'));
  C.resume(s, at(MON, '11:10'));
  assert.equal(C.clockOut(s, at(MON, '16:30')), false);
  assert.equal(C.dayStats(s, MON).pause, 10);

  // started after 12:00 → window not inside work time → untouched
  s = fresh();
  C.clockIn(s, at(MON, '12:15'));
  assert.equal(C.clockOut(s, at(MON, '19:00')), false);

  // switched off → untouched
  s = fresh();
  s.settings.autoPause = false;
  C.clockIn(s, at(MON, '08:00'));
  assert.equal(C.clockOut(s, at(MON, '16:30')), false);
});
