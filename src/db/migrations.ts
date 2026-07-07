/**
 * Schema migrations - each entry migrates from version N-1 → N.
 *
 * Index 0 is unused (version 0 means "no DB yet", handled by SCHEMA_DDL).
 * Each migration is an array of SQL statements run in a transaction.
 */

export const MIGRATIONS: string[][] = [
  // [0] placeholder - version 0 → 1 is handled by SCHEMA_DDL in schema.ts
  [],
];
