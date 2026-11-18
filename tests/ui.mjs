// End-to-end check in WebKit (Safari engine) on an iPhone-sized screen.
// Usage: node tests/ui.mjs   (expects the app served at http://localhost:8765)
import { webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:8765/';
mkdirSync('shots', { recursive: true });

const browser = await webkit.launch();
const errors = [];

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.clock.install({ time: new Date('2026-11-16T08:02:00') }); // Monday
  await page.goto(URL);

  // settings first: start date + region
  await page.click('[data-tab="settings"]');
  await page.fill('[data-set="startDate"]', '2026-11-01');
  await page.dispatchEvent('[data-set="startDate"]', 'change');
  await page.selectOption('[data-set="holidayRegion"]', 'AT');
  await page.fill('[data-set="weeklyHours"]', '38,5');
  await page.dispatchEvent('[data-set="weeklyHours"]', 'change');
  assert.match(await page.textContent('#view'), /7:42 h per working day/);
  await page.fill('[data-set="weeklyHours"]', '40');
  await page.dispatchEvent('[data-set="weeklyHours"]', 'change');
  if (scheme === 'light') await page.screenshot({ path: `shots/settings-${scheme}.png`, fullPage: true });

  await page.click('[data-tab="today"]');
  await page.click('[data-act="in"]');
  await page.click('[data-act="toggle-since"]');
  await page.fill('#sinceInput', '8.2');
  await page.press('#sinceInput', 'Tab');
  assert.equal(await page.getAttribute('#sinceInput', 'class'), 'tm bad');
  await page.fill('#sinceInput', '802');
  await page.press('#sinceInput', 'Tab');
  assert.match(await page.textContent('#view'), /Working since 08:02/);
  await page.click('[data-act="toggle-since"]');
  await page.clock.fastForward('03:58:00'); // 12:00
  await page.click('[data-act="pause"]');
  await page.clock.fastForward('00:31:00'); // 12:31
  assert.match(await page.textContent('#livePause'), /^0:3[01]:\d\d$/);
  if (scheme === 'light') await page.screenshot({ path: 'shots/today-pause-light.png' });
  await page.click('[data-act="resume"]');
  assert.equal(await page.$('#livePause'), null);
  await page.clock.fastForward('02:00:00'); // 14:31
  await page.screenshot({ path: `shots/today-working-${scheme}.png`, fullPage: true });
  const clock = await page.textContent('#liveClock');
  assert.equal(clock, '5:58:00', `live clock ${clock}`);
  assert.match((await page.textContent('#view')).replace(/\s+/g, ' '), /Pause ?0:31/);

  // doctor appointment via quick add, 15:00–17:30 → 1h credit
  await page.click('[data-act="quick"][data-type="doctor"]');
  await page.fill('[data-a="0"][data-f="start"]', '1500');
  await page.press('[data-a="0"][data-f="start"]', 'Tab');
  assert.equal(await page.inputValue('[data-a="0"][data-f="start"]'), '15:00');
  await page.fill('[data-a="0"][data-f="end"]', '17,30');
  await page.screenshot({ path: `shots/editor-${scheme}.png` });
  await page.click('[data-act="dlg-save"]');
  await page.clock.fastForward('00:29:00'); // 15:00
  await page.click('[data-act="out"]');
  const txt = await page.textContent('#view');
  assert.match(txt, /Clocked out at 15:00/);
  assert.match(txt.replace(/\s+/g, ' '), /Today ±\s*−0:33/);
  await page.screenshot({ path: `shots/today-done-${scheme}.png`, fullPage: true });

  // vacation
  await page.click('[data-tab="vacation"]');
  await page.fill('#vFrom', '2026-12-21');
  await page.fill('#vTo', '2027-01-08');
  await page.click('[data-act="add-vac"]');
  assert.match(await page.textContent('#toast'), /Added 12 vacation days/);
  await page.click('[data-act="vyear"][data-d="-1"]');
  await page.click('[data-act="vyear"][data-d="1"]');
  assert.match(await page.textContent('#view'), /Planned 8|Planned 4/);
  await page.screenshot({ path: `shots/vacation-${scheme}.png`, fullPage: true });

  // month
  await page.click('[data-tab="month"]');
  await page.screenshot({ path: `shots/month-${scheme}.png`, fullPage: true });
  await page.click('.day.today');
  await page.click('[data-act="dlg-add-work"]');
  await page.click('[data-act="dlg-cancel"]');

  // day navigation: arrows, buttons, swipe
  await page.click('[data-tab="today"]');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.textContent('h1'), 'Yesterday');
  await page.click('[data-act="day"][data-d="-1"]');
  assert.equal(await page.textContent('h1'), 'Saturday');
  await page.click('[data-act="day-today"]');
  assert.equal(await page.textContent('h1'), 'Today');
  const swipe = (x0, x1) => page.evaluate(([a, b]) => {
    const el = document.getElementById('view');
    const mk = (type, x) => {
      // plain Event carrying touch coordinates (WebKit on macOS can't construct TouchEvent)
      const t = { identifier: 1, target: el, clientX: x, clientY: 300 };
      const ev = new Event(type, { bubbles: true });
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
      Object.defineProperty(ev, 'changedTouches', { value: [t] });
      el.querySelector('.card').dispatchEvent(ev);
    };
    mk('touchstart', a); mk('touchend', b);
  }, [x0, x1]);
  let touchOk = true;
  try { await swipe(300, 100); } catch { touchOk = false; }
  if (touchOk) {
    assert.equal(await page.textContent('h1'), 'Yesterday', 'swipe left → previous day');
    await swipe(100, 300);
    assert.equal(await page.textContent('h1'), 'Today', 'swipe right → next day');
  } else console.log('(touch events not constructible in this WebKit build; swipe not tested)');
  // past day shows summary + doctor visit was today, yesterday (Sunday) is empty
  await page.keyboard.press('ArrowLeft');
  assert.match(await page.textContent('#view'), /Nothing recorded\./);
  await page.click('[data-tab="today"]');
  if (scheme === 'light') {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.screenshot({ path: 'shots/pastday-light.png', fullPage: true });
    await page.click('[data-act="day-today"]');
  }

  // backup reminder after 30 days without backup
  assert.doesNotMatch(await page.textContent('#view'), /Time for a backup/);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('timetrack.v1'));
    s.meta.firstUse -= 31 * 864e5;
    localStorage.setItem('timetrack.v1', JSON.stringify(s));
  });
  await page.reload();
  await page.click('[data-tab="today"]');
  assert.match(await page.textContent('#view'), /Time for a backup/);
  if (scheme === 'light') await page.screenshot({ path: 'shots/reminder-light.png' });
  await page.click('[data-act="backup-later"]');
  assert.doesNotMatch(await page.textContent('#view'), /Time for a backup/);

  // persistence across reload
  await page.reload();
  await page.click('[data-tab="today"]');
  assert.match(await page.textContent('#view'), /Doctor's appointment 15:00–17:30/);
  await ctx.close();
}

// Friday: how much is still needed to finish the week at zero
{
  const ctx = await browser.newContext({ ...devices['iPhone 15'], colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-20T08:00:00') }); // Friday
  await page.goto(URL);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('timetrack.v1'));
    s.settings.startDate = '2026-11-16';
    s.settings.weeklyHours = 38.5;
    for (const d of ['16', '17', '18', '19']) {
      s.days[`2026-11-${d}`] = { work: [{ start: new Date(`2026-11-${d}T08:00`).getTime(), end: new Date(`2026-11-${d}T12:00`).getTime() },
        { start: new Date(`2026-11-${d}T12:30`).getTime(), end: new Date(`2026-11-${d}T17:00`).getTime() }] };
    }
    localStorage.setItem('timetrack.v1', JSON.stringify(s));
  });
  await page.reload();
  await page.click('[data-tab="today"]');
  let note = (await page.textContent('.friday-note')).replace(/\s+/g, ' ');
  assert.match(note, /^Weekly balance – 4:30 h to go today 🏖️$/, note);
  await page.click('[data-act="in"]');
  note = (await page.textContent('.friday-note')).replace(/\s+/g, ' ');
  assert.match(note, /^Weekly balance – you can leave at 12:30 🏖️$/, note);
  await page.screenshot({ path: 'shots/friday-light.png' });
  await page.keyboard.press('ArrowLeft'); // Thursday: no note
  assert.equal(await page.$('.friday-note'), null);
  await ctx.close();
}

// render PNG icons from the SVG
const ictx = await browser.newContext({ deviceScaleFactor: 1 });
const ip = await ictx.newPage();
for (const size of [180, 192, 512]) {
  await ip.setViewportSize({ width: size, height: size });
  await ip.goto(`${URL}icons/icon.svg`);
  await ip.screenshot({ path: `icons/icon-${size}.png` });
}

await browser.close();
assert.deepEqual(errors, [], 'page errors');
console.log('UI test passed; screenshots in shots/');
