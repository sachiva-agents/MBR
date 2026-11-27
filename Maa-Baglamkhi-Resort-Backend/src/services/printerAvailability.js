/**
 * printerAvailability — "is this printer actually usable here?" (HAG-13).
 *
 * The KOT pipeline (PrintQueue → KitchenPrintService → ThermalPrintService)
 * used to assume the target Windows printer exists: on a host without it,
 * every queued job failed and the 3-retry loop re-queued it — a retry
 * storm that never succeeded and flooded logs/notices.
 *
 * This module answers one question up front: does the printer named in
 * PrintConfig exist on this machine (pdf-to-printer getPrinters), AND does
 * sending a job to it actually succeed? Results are cached with a TTL so
 * the check costs one getPrinters() call per minute at most, and a
 * printer that was unavailable is marked degraded — jobs for it are
 * skipped (status 'skipped', no retry) instead of retried into the
 * bit-bucket.
 *
 * The admin-facing "printer missing" notice is emitted here (rate-limited
 * by adminNotice), so the notice appears once, not once per failed job.
 */

const { getPrinters } = require("pdf-to-printer");
const { notifyAdmin } = require("./adminNotice");
// HAG-23: the auto-print flag + printer name come from the live DB-backed
// snapshot (admin editable in-app). dynamicSettings is safe to require here:
// it depends on PrintConfig, not on printerAvailability (no cycle).
const dynamicSettings = require("./dynamicSettings");

const CACHE_TTL_MS = 60 * 1000; // re-check at most every minute
const cache = new Map(); // printerName -> { ok, at, error }

/**
 * Resolve the effective auto-print switch. Precedence (HAG-23):
 * app_settings.auto_print_enabled (admin's in-app choice) → AUTO_PRINT_ENABLED
 * env → enabled. Reads the live snapshot, so a saved value applies without a
 * restart. Genuinely disables the KOT auto-print path (skip, no retry).
 */
const isAutoPrintEnabled = () => dynamicSettings.isAutoPrintEnabled();

/**
 * Is `printerName` present on this machine AND can we actually reach it?
 * @returns {Promise<{ok:boolean, exists:boolean, error?:string}>}
 */
const checkPrinter = async (printerName) => {
  const entry = cache.get(printerName);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return { ok: entry.ok, exists: entry.ok, error: entry.error };
  }

  let exists = false;
  let error;
  try {
    const printers = await getPrinters();
    exists = printers.some((p) => p.name === printerName);
  } catch (err) {
    error = err.message;
  }

  // A printer name present in the Windows list is not enough on flaky
  // drivers — but we do NOT send a test page here (that would itself be a
  // print). Presence is the availability signal; send failures still get
  // their one retry via PrintQueue's max_retries, after which the job is
  // 'failed' and the retry chain stops.
  const result = { ok: exists, exists, error };
  cache.set(printerName, { ok: exists, at: Date.now(), error });
  return result;
};

/**
 * Enqueue-time gate: if the printer is not present, fail ONCE —
 * log a clear line, fire the rate-limited admin notice, mark degraded.
 * Callers use this to decide "skip the job, do not retry".
 */
const gateForJob = async ({ printerName, printerKey, jobLabel }) => {
  const status = await checkPrinter(printerName);
  if (status.ok) return { proceed: true, status };

  const reason = status.exists ? `printer ${printerName} unreachable: ${status.error}` : `no Windows printer named "${printerName}"`;
  console.error(
    `[PrintQueue][HAG-13] ${jobLabel} skipped — ${reason}. ` +
    `Fix in Settings → Printers (or KOT_PRINTER_NAME in .env) to a real printer, or set AUTO_PRINT_ENABLED=false.`,
  );
  await notifyAdmin({
    type: "printer_degraded",
    title: `Printer ${printerName} not available`,
    message:
      `${jobLabel} was skipped: ${reason}. Auto-print will keep skipping (no retry storm) ` +
      `until the printer is installed/restarted or the KOT printer name is set (Settings → Printers, ` +
      `KOT_PRINTER_NAME) to a real one. Set AUTO_PRINT_ENABLED=false to stop auto-print entirely.`,
    data: { printerKey, printerName, reason, at: new Date().toISOString() },
  });
  return { proceed: false, status, reason };
};

/** Test hook: drop the cache (e.g. after a printer is installed). */
const invalidate = () => cache.clear();

module.exports = { checkPrinter, gateForJob, isAutoPrintEnabled, invalidate };
