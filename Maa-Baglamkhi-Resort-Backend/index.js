const { server, initializeDatabase, shutdown } = require("./src/app");

const PORT = process.env.PORT || 5002;

// A single failing request must not take down the whole process. Log loudly,
// keep serving — otherwise one broken endpoint makes every later test look
// like "connection refused" and hides the real error.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason && reason.stack ? reason.stack : reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && err.stack ? err.stack : err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

initializeDatabase().then(() => {
  // HAG-23: prime the live connector settings (DB app_settings → env → default)
  // before the print queue / ZK scheduler start, so an admin's saved printer
  // name / gateway / auto-sync values apply on this boot without a restart.
  // Never throws — on any DB hiccup it falls back to the .env/default snapshot.
  try {
    require("./src/services/dynamicSettings").refresh().catch(() => {});
  } catch (e) {
    console.error("Dynamic settings init failed:", e.message);
  }
  try {
    const { printQueue } = require("./src/services/PrintQueue");
    printQueue.start();
  } catch (e) {
    console.error("Print queue init failed:", e.message);
  }
  try {
    require("./src/services/backupScheduler").start();
  } catch (e) {
    console.error("Backup scheduler init failed:", e.message);
  }
  try {
    require("./src/services/zkAutoSync").start();
  } catch (e) {
    console.error("ZK auto-sync init failed:", e.message);
  }
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGUSR2", () => shutdown("SIGUSR2"));
