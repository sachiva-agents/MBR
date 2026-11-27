require("dotenv").config({ quiet: process.env.NODE_ENV === "test" });

// HAG-22 zero-config defaults: on a machine with a stock local MariaDB/
// MySQL (root, empty password, 127.0.0.1:3306) and no .env at all, the
// server must just work. `resort_management` is the out-of-box schema name;
// boot auto-creates it when missing (app.js ensureDatabaseExists).
const DEFAULT_DB_HOST = "127.0.0.1";
const DEFAULT_DB_PORT = 3306;
const DEFAULT_DB_USER = "root";
const DEFAULT_DB_NAME = "resort_management";

function parseDbPort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DB_PORT;
}

function getDatabaseName() {
  if (process.env.NODE_ENV === "test" && process.env.DB_NAME_TEST) {
    return process.env.DB_NAME_TEST;
  }

  return process.env.DB_NAME || "employee3";
}

function getDbBaseConfig() {
  return {
    host: process.env.DB_HOST || DEFAULT_DB_HOST,
    port: parseDbPort(process.env.DB_PORT),
    user: process.env.DB_USER || DEFAULT_DB_USER,
    password: process.env.DB_PASSWORD || "",
    connectTimeout: 10000,
  };
}

function getDbConnectionLabel() {
  const { host, port } = getDbBaseConfig();
  return `${host}:${port}`;
}

module.exports = {
  getDatabaseName,
  getDbBaseConfig,
  getDbConnectionLabel,
};
