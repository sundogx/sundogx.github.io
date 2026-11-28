# r16-stab3: UI and online stability (branch r16-stab3)

## Resume here
- Current task: reproducing open findings (desktop layout shift entering a table, home CLS, api() timeout, offline dds-worker, T.history trim, online-stab limit flake).
- Playwright: `NODE_PATH=/private/tmp/claude-501/-Users-admin/c95d256f-4c77-4778-9fcf-01deefc13883/scratchpad/pw/node_modules node tests/soak.pw.mjs ...`
- Next: repro each, fix, commit.
