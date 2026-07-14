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
- Local dev, tests, and production builds use the same loading path

## Upgrade checklist (sql.js)

1. Bump `sql.js` in `package.json`
2. Run `yarn install`
3. Run `yarn lint`
4. Run `yarn typecheck`
5. Run `yarn test`
6. Run `yarn build`
7. Open the app and confirm data loads from IndexedDB and sync still works

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
