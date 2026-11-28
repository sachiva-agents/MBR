const mysql = require("mysql2/promise");
require("dotenv").config({ quiet: process.env.NODE_ENV === "test" });
const { getDatabaseName, getDbBaseConfig } = require("../config/databaseConfig");

const pool = mysql.createPool({
  host: getDbBaseConfig().host,
  port: Number(getDbBaseConfig().port || 3306),
  user: getDbBaseConfig().user,
  password: getDbBaseConfig().password,
  database: getDatabaseName(),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 50),
  queueLimit: Number(process.env.DB_QUEUE_LIMIT || 200),
});

/**
 * Compatibility shim for the callback query style, and one shape rule for the
 * whole tree.
 *
 * A mysql2 promise pool's query(sql, args) takes only two arguments, so code
 * written against the callback API
 *
 *   db.query(sql, params, (err, rows) => ...)
 *
 * passes a callback that is silently dropped. The promise still resolves, the
 * callback never fires, and the request hangs until the socket times out.
 *
 * Both query() and execute() always resolve to a [result, fields] tuple.
 * Measured on this server for every statement type, both with and without
 * params, pool-wide and per-connection:
 *
 *   SELECT -> [rows, fields]    result is the row array
 *   INSERT -> [ResultSetHeader, null]
 *   execute -> [ResultSetHeader, null] same for reads and writes
 *
 * promise form always resolves to the raw [result, fields] tuple:
 *
 *   SELECT -> [rows, fields]
 *   INSERT -> [ResultSetHeader, fields]
 *   execute -> the tuple, same for reads and writes
 *
 * That single shape covers every call style in this repo:
 *   const [rows]   = await db.query(SELECT) -> rows[]
 *   const [header] = await db.query(INSERT) -> header.insertId
 *   db.query(sql, params, (err, rows) => ...) -> rows = the SELECT row array,
 *     or the INSERT ResultSetHeader
 *   db.execute(...) -> the tuple, as with query()
 *
 * The callback argument gets result[0]: the row array on a read, the
 * ResultSetHeader on a write. No unwrapping, so the shape never branches on
 * row count, fields, or the SQL text.
 */

const originalQuery = pool.query.bind(pool);
const originalExecute = pool.execute.bind(pool);

// Passes the promise form through to the callback form: the callback gets
// result[0] — the row array on a read, the ResultSetHeader on a write.
const withCallback = (promise, callback) => {
  promise.then(
    (result) => {
      const rows = Array.isArray(result) ? result[0] : result;
      callback(null, rows, rows);
    },
    (err) => callback(err),
  );
};

pool.query = function (sql, params, callback) {
  if (typeof params === "function") {
    callback = params;
    params = undefined;
  }

  const promise = params === undefined ? originalQuery(sql) : originalQuery(sql, params);

  if (typeof callback === "function") {
    withCallback(promise, callback);
  }

  return promise;
};

pool.execute = function (sql, params, callback) {
  if (typeof params === "function") {
    callback = params;
    params = undefined;
  }

  const promise = params === undefined ? originalExecute(sql) : originalExecute(sql, params);

  if (typeof callback === "function") {
    withCallback(promise, callback);
  }

  return promise;
};

const originalGetConnection = pool.getConnection.bind(pool);

pool.getConnection = async (...args) => {
  const connection = await originalGetConnection(...args);

  const originalConnectionQuery = connection.query.bind(connection);
  connection.query = function (sql, params, callback) {
    if (typeof params === "function") {
      callback = params;
      params = undefined;
    }
    const promise =
      params === undefined ? originalConnectionQuery(sql) : originalConnectionQuery(sql, params);
    if (typeof callback === "function") {
      withCallback(promise, callback);
    }
    return promise;
  };

  const originalConnectionExecute = connection.execute.bind(connection);
  connection.execute = function (sql, params, callback) {
    if (typeof params === "function") {
      callback = params;
      params = undefined;
    }
    const promise =
      params === undefined ? originalConnectionExecute(sql) : originalConnectionExecute(sql, params);
    if (typeof callback === "function") {
      withCallback(promise, callback);
    }
    return promise;
  };

  return connection;
};

module.exports = pool;
