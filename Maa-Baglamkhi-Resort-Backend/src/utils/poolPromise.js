/**
 * Re-export the single shared mysql2 pool from src/config/db.js.
 *
 * All 80+ models require this file, so consolidating here means every
 * query/transaction goes through one pool with the DB_CONNECTION_LIMIT cap.
 *
 * HAG-24: previously this module created its own pool (limit 10) while
 * controllers used src/config/db.js (limit 50) — effective ceiling 60.
 * Now a single pool with configurable limit (default 50) and queueLimit (200).
 */
const db = require("../config/db");

const pool = db;
const getConnection = () => db.getConnection();
const runQuery = (sql, params = []) => db.query(sql, params);

module.exports = { pool, getConnection, runQuery };
