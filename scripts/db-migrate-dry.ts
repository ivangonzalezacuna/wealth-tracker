/**
 * db-migrate-dry — Schema migration dry-run script.
 *
 * Validates that any PENDING migration entries (those with index > SCHEMA_VERSION)
 * apply cleanly against the current in-memory schema. Exits with code 0 on
 * success, code 1 on the first SQL error.
 *
 * Usage:
 *   yarn db:migrate-dry
 *
 * Recommended workflow when adding a new migration:
 *   1. Add SQL statements to MIGRATIONS[SCHEMA_VERSION + 1] in src/db/migrations.ts.
 *      (Do NOT yet bump SCHEMA_VERSION — leave it pointing at the last known-good version.)
 *   2. Run `yarn db:migrate-dry` to verify the new statements apply cleanly
 *      against the current schema (SCHEMA_DDL at SCHEMA_VERSION).
 *   3. Once the dry-run passes, also update SCHEMA_DDL to reflect the changes
 *      and bump SCHEMA_VERSION by 1.
 *
 * How the simulation works:
 *   - A fresh in-memory SQLite database is created from SCHEMA_DDL (the up-to-date
 *     schema that reflects all migrations up to and including SCHEMA_VERSION).
 *   - The simulated DB version is set to SCHEMA_VERSION.
 *   - Any MIGRATIONS entries at indices > SCHEMA_VERSION are treated as pending
 *     and executed in order.
 *   - If there are no pending entries, the script reports that the schema is
 *     current and exits cleanly.
 *
 * This is a pure dry-run: it never touches any real user data.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { SCHEMA_DDL, SCHEMA_VERSION } from '../src/db/schema.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// sql.js ships a native WASM file. We read it from disk so we don't need a
// browser environment or a Vite ?url import shim.
const wasmPath = resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
const wasmBinary = readFileSync(wasmPath);

async function main(): Promise<void> {
  console.log('wealth-tracker — schema migration dry-run\n');
  console.log(`Current SCHEMA_VERSION: ${SCHEMA_VERSION}`);
  console.log(
    `Total migration slots:  ${MIGRATIONS.length - 1} (indices 1–${MIGRATIONS.length - 1})\n`,
  );

  const SQL = await initSqlJs({ wasmBinary });
  const db = new SQL.Database();

  // ── Step 1: create the current schema from SCHEMA_DDL ────────────────────
  // SCHEMA_DDL reflects all migrations up to and including SCHEMA_VERSION,
  // so this simulates a live database that is fully up-to-date.
  for (const stmt of SCHEMA_DDL) {
    try {
      db.run(stmt);
    } catch (err) {
      console.error('✗ SCHEMA_DDL statement failed:');
      console.error(`  ${stmt.trim().split('\n')[0]}…`);
      console.error(`  Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`);
  console.log(`✓ Base schema initialised at version ${SCHEMA_VERSION} (SCHEMA_DDL).\n`);

  // ── Step 2: identify and run any pending migrations ───────────────────────
  // Pending = any MIGRATIONS slot whose index is strictly greater than SCHEMA_VERSION.
  const pendingIndices: number[] = [];
  for (let v = SCHEMA_VERSION + 1; v < MIGRATIONS.length; v++) {
    if (MIGRATIONS[v] && MIGRATIONS[v].length > 0) {
      pendingIndices.push(v);
    }
  }

  if (pendingIndices.length === 0) {
    console.log('No pending migrations found. Schema is current.');
    console.log(
      '\nTo test a new migration, add SQL to MIGRATIONS[SCHEMA_VERSION + 1] in\n' +
        'src/db/migrations.ts (without bumping SCHEMA_VERSION yet), then re-run\n' +
        'this script.',
    );
    db.close();
    console.log('\nDry-run complete. ✓');
    return;
  }

  console.log(`Pending migrations to run: [${pendingIndices.join(', ')}]\n`);

  let applied = 0;
  for (const v of pendingIndices) {
    const stmts = MIGRATIONS[v];
    db.run('BEGIN');
    try {
      for (const stmt of stmts) {
        db.run(stmt);
      }
      db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '${v}')`);
      db.run('COMMIT');
      console.log(
        `✓ Migration [${v}] OK (${stmts.length} statement${stmts.length === 1 ? '' : 's'})`,
      );
      applied++;
    } catch (err) {
      db.run('ROLLBACK');
      console.error(`\n✗ Migration [${v}] FAILED.`);
      console.error(`  Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  db.close();
  console.log(`\n${applied} pending migration${applied === 1 ? '' : 's'} applied successfully. ✓`);
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
