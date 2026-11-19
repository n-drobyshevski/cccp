# C0 baseline (before the gas-kit migration)

## Run

- All e2e: `npm run e2e -- --trace off` (20 specs, 225 tests, all passing at baseline).
- Visual baselines alone: `npx playwright test e2e/shots.spec.ts`; regenerate with `--update-snapshots`.
- Without Chrome installed, point Playwright at a Chromium binary: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`
  (only read when set; CI and local Chrome behaviour are unchanged).
- Snapshots are Linux Chromium renders in `e2e/shots.spec.ts-snapshots/` (64 PNGs, about 4 MB).
  Regenerate on the same platform; other OSes will differ in font rendering.

## Visual snapshots

Each name is `<viewport>-<theme>-<page>.png`; viewport is desktop (1280x800) or mobile (390x844),
theme is light or dark, viewport-sized (not full page). 16 pages x 2 themes x 2 viewports = 64.

Pages: overview, inventory, heatmap, landscape, factsheet, settings-source, settings-fields,
settings-rules, settings-access, settings-display, denied (stranger), only-admins (viewer on
Settings), no-source-owner, no-source-viewer, not-found, splash (held with `?slow`).
Masked: `[data-loaded]` (Settings "Last loaded" time). Animations disabled, reduced motion on.

## Bundle sizes (`npm run build`, bytes)

| file | bytes |
| --- | --- |
| dist/server.js | 119292 |
| dist/js_app.html | 181890 |
| dist/styles.html | 59220 |

CI (`CI=true`) skips `shots.spec.ts`: the baselines are this machine's Chromium and fonts, and a
CI runner draws text a few pixels differently. Set `SHOTS=1` to run them there anyway.
