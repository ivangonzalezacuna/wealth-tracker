# sql.js + WASM integration guide

This repository uses `sql.js` to run SQLite in the browser.

## Single source of truth

- Runtime import: `src/db/connection.ts` imports `initSqlJs` from `sql.js`
- WASM asset import: `src/db/connection.ts` imports `sql.js/dist/sql-wasm-browser.wasm?url`
- Runtime wiring: `initSqlJs({ locateFile: () => sqlWasmBrowserUrl })`

With this setup, Vite fingerprints and ships the WASM file as a build asset. We do not copy WASM files into `public/`.

## Why this is stable

- JS glue and WASM come from the same installed `sql.js` package version
- The build pipeline owns asset paths, so file name changes in `dist/` do not require manual path updates
- Development and production use the Vite-managed URL. Database tests mock that
  URL to the installed browser WASM file; the migration CLI reads the package's
  Node WASM file directly.

## Upgrade checklist (sql.js)

1. Bump `sql.js` in `package.json`
2. Run `yarn install`
3. Run `yarn lint`, `yarn typecheck`, `yarn test` and `yarn build`
4. Run `yarn playwright test --config playwright.pdf-production.config.ts` to
   check real-browser WASM/PDF worker precaching and cold offline loading
5. Open the app and confirm data loads from IndexedDB and sync still works

If all checks pass, no WASM path update should be needed.

## Troubleshooting

### Error loading WASM file

Check browser network tab for a failed `.wasm` request:

- If request is 404, run `yarn install` and `yarn build` again
- If request is blocked by CSP, verify `netlify.toml` still allows `'wasm-unsafe-eval'` in `script-src`

### App boots but DB operations fail

- Confirm `src/db/connection.ts` still uses `locateFile: () => sqlWasmBrowserUrl`
- Confirm no manual `public/sql-wasm*.wasm` files were reintroduced

### Unexpected break after dependency bump

- Check `node_modules/sql.js/package.json` exports and `dist/` file names
- Keep the browser WASM import (`sql-wasm-browser.wasm?url`) aligned with the browser entrypoint

## Migration dry-run

`yarn db:migrate-dry` creates a fresh in-memory database from `SCHEMA_DDL` and
applies only migration entries above `SCHEMA_VERSION`. Add the pending migration
before updating the version and current DDL, run the command, then update both.
It does not load an old database or validate already-versioned upgrade paths;
keep regression tests for historical data and migrations.
