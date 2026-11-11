# CCCP

Cyber, Compliance, Continuity, Platform: a view-only application register as a standalone Google
Apps Script web app. Agents: read `CLAUDE.md` first. Provenance of reused code: `VENDOR.md`.

## Dev loop

```
npm install
npm run check          # typecheck, lint, vendor:verify, test
npm run vendor:verify  # sha256 + import containment of src/vendor
```

Later work packages add `build`, `dev` (port 8791), `test:build` and `e2e`.

## Vendoring

`src/vendor` is verbatim sidekick code pinned at `77bcf22` (see `VENDOR.md`). Re-sync:

```
npm run vendor:diff -- --to <sha>
node tools/vendor.mjs sync --from /home/user/sidekick --commit <sha>
```

## Deploy

Added by a later work package (clasp login as owner, `clasp create --rootDir dist`, push, run
`setup('<sheet url>')`, `deploy:new`, then `DEPLOYMENT_ID=... npm run deploy`).
