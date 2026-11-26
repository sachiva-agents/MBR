/**
 * adminNotice — rate-limited in-app admin notifications for infra gaps (HAG-13).
 *
 * When an external dependency is missing (kitchen printer not installed,
 * Wasachiva/WhatsApp gateway unreachable, gateway key unset) the app must
 * fail ONCE, log a clear line, and surface one in-app admin notice — not
 * emit a notice per failed request. This helper dedupes notices by type on
 * a 1-hour cooldown, so a steady stream of failures produces exactly one
 * notice + one console line per hour.
 *
 * Notices are written to the `notifications` table with user_role='admin',
 * which is what the admin notification feed (notificationController)
 * already renders — no frontend changes needed.
 */

const NotificationModel = require("../models/NotificationModel");

const NOTICE_COOLDOWN_MS = 60 * 60 * 1000; // one notice per type per hour
const lastNotified = new Map(); // type -> last notification timestamp

/**
 * Fire a rate-limited admin notice.
 * Resolves { notified, suppressed } — never throws; a failed insert only
 * degrades to a console line.
 *
 * @param {object} opts
 * @param {string} opts.type - notice type (dedupe key), e.g. "kitchen_printer"
 * @param {string} opts.title - short admin-facing title
 * @param {string} opts.message - one-paragraph details + fix
 * @param {object} [opts.data] - optional JSON payload
 */
const notifyAdmin = async ({ type, title, message, data }) => {
  const now = Date.now();
  const last = lastNotified.get(type);
  if (last && now - last < NOTICE_COOLDOWN_MS) {
    return { notified: false, suppressed: true };
  }
  lastNotified.set(type, now);

  const line = `[admin-notice:${type}] ${title} — ${message}`;
  try {
    await NotificationModel.create({
      user_role: "admin",
      type,
      title,
      message,
      data,
    });
    console.warn(line);
    return { notified: true };
  } catch (err) {
    // In-app notice unavailable (e.g. table not migrated yet) — still log.
    console.warn(`${line} (in-app notice failed: ${err.message})`);
    return { notified: false, error: err.message };
  }
};

/**
 * Test/ops hook: drop the dedupe state so the next notification fires.
 */
const resetNoticeCooldown = () => lastNotified.clear();

module.exports = { notifyAdmin, resetNoticeCooldown, NOTICE_COOLDOWN_MS };
