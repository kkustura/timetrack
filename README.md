# Time Tracker

A personal time tracker (clock in/out, pause, appointments, vacation, overtime balance).
A plain web app (PWA): no build step, no server, no account. All data stays on the device.

## Use
- **iPhone:** open the hosted URL in Safari → Share → *Add to Home Screen*. Works offline.
- **Laptop:** open the same URL in any browser (Chrome/Edge can “Install app”).
- **Moving data between devices:** Settings → Export backup / Import backup (e.g. via iCloud Drive).

## Develop
    python3 -m http.server 8765      # then open http://localhost:8765
    npm test                         # logic tests (node)
    node tests/ui.mjs                # WebKit/iPhone UI test + screenshots in shots/, regenerates PNG icons

After changing files that are already deployed, bump `CACHE` in `sw.js` so installed copies update.

## Rules implemented
- Daily target = weekly hours ÷ number of working days. Public holidays (AT/DE presets or manual) have no target.
- Gaps between work periods are pause and don't count.
- Doctor's / other appointments count as work only inside the configured window (default 08:00–16:00), never twice where you were clocked in anyway.
- Vacation and sick days credit the daily target (half-day vacation = half). Comp time credits nothing (reduces overtime).
- Optional minimum-pause rule (default: warn if < 30 min after 6 h; can auto-deduct).
