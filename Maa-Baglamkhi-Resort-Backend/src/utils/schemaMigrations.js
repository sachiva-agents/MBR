// Portable column/key migrations that work on both MariaDB and plain MySQL.
//
// `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `ADD KEY IF NOT EXISTS` is
// MariaDB-only syntax: MySQL rejects it as a syntax error, which broke every
// ensureSchema() on MySQL deployments (logged as "Schema error for ...").
// The information_schema pre-check below is standard on both flavors, so the
// plain ALTER only ever runs when the object is actually missing.
//
// `runner` is anything exposing promise query(sql, params) that resolves to a
// [rows, fields] tuple: the pool from config/db.js, or a pooled connection
// from utils/poolPromise.

async function columnExists(runner, table, column) {
  const [rows] = await runner.query(
    "SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function keyExists(runner, table, keyName) {
  const [rows] = await runner.query(
    "SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
    [table, keyName]
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

/**
 * Add `table.column definition` when it does not exist yet.
 * Returns true when the column was created, false when it was already there.
 */
async function addColumnIfMissing(runner, table, column, definition) {
  if (await columnExists(runner, table, column)) return false;
  await runner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  return true;
}

/**
 * Add a secondary index when it does not exist yet (skipped on PRIMARY/UNIQUE
 * callers — use a regular index name). columnDefs looks like "`col_a`,`col_b`".
 */
async function addKeyIfMissing(runner, table, keyName, columnDefs) {
  if (await keyExists(runner, table, keyName)) return false;
  await runner.query(`ALTER TABLE \`${table}\` ADD KEY \`${keyName}\` (${columnDefs})`);
  return true;
}

module.exports = {
  columnExists,
  keyExists,
  addColumnIfMissing,
  addKeyIfMissing,
};
