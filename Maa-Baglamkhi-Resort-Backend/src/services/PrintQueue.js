/**
 * PrintQueue — background print job queue with retry logic.
 *
 * Features:
 *   - Job queuing with priority
 *   - Automatic retry on failure (configurable max retries)
 *   - Sequential processing (one print job at a time)
 *   - Status tracking (queued → processing → success/failed)
 *   - Auto-flush on startup
 */

const db = require("../config/db");

// Print job reference number, e.g. PRN-20260414-123456
const buildPrintNo = () =>
  `PRN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`;

// print_logs.printed_by is a bigint FK, but callers pass labels like "System".
const numericUserId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const { ensureSchema } = require("../models/PrintLogsModel");
const PrintConfig = require("../PrintConfig");
const { gateForJob, isAutoPrintEnabled } = require("./printerAvailability");


const isTestEnv = () => process.env.NODE_ENV === "test";

class PrintQueue {
  constructor() {
    this.processing = false;
    this.queueInterval = null;
    this.logger = isTestEnv() ? () => {} : console.log.bind(console, "[PrintQueue]");
  }

  /**
   * Add a print job to the queue.
   * @param {string} printType - one of the PRINT_TYPES keys
   * @param {object} payload - job data passed to the print service
   * @param {number} priority - higher = processed first
   * @param {number} maxRetries - max retry attempts on failure
   * @returns {Promise<string>} jobId
   */
  async enqueue(printType, payload = {}, priority = 0, maxRetries = 3) {
    await ensureSchema();

    const printerKey = PrintConfig.resolvePrinterWithOverride(printType);
    const printer = PrintConfig.getPrinter(printerKey);
    const jobId = `JOB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await db.query(
      `INSERT INTO print_queue (job_id, print_type, payload, printer_name, priority, max_retries, status)
       VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
      [jobId, printType, JSON.stringify(payload), printer.name, priority, maxRetries],
    );

    this.logger(`Job queued: ${jobId} type=${printType} printer=${printer.name}`);
    return jobId;
  }

  /**
   * Start the background processor that polls the queue.
   */
  start() {
    if (this.queueInterval) return;

    this.logger("Print queue processor started");

    // Flush existing queued jobs on startup
    this.flushPendingJobs();

    // Poll every 2 seconds
    this.queueInterval = setInterval(() => {
      this.processNext().catch((err) => {
        this.logger("Queue processing error:", err.message);
      });
    }, 2000);
  }

  /**
   * Stop the background processor.
   */
  stop() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
      this.logger("Print queue processor stopped");
    }
  }

  /**
   * Process the next queued job (highest priority first).
   */
  async processNext() {
    if (this.processing) return;
    this.processing = true;

    try {
      const [rows] = await db.query(
        `SELECT * FROM print_queue
         WHERE status = 'queued'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`,
      );

      if (!rows || !rows.length) {
        this.processing = false;
        return;
      }

      const job = rows[0];
      await this.processJob(job);
    } catch (err) {
      this.logger("Failed to fetch next job:", err.message);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single job.
   */
  async processJob(job) {
    const startTime = Date.now();
    this.logger(`Processing job: ${job.job_id} type=${job.print_type}`);

    // Mark as processing
    await db.query(
      `UPDATE print_queue SET status = 'processing', processed_at = NOW() WHERE id = ?`,
      [job.id],
    );

    try {
      // ── HAG-13 graceful degradation ─────────────────────────────────────
      // 1) Auto-print explicitly disabled (AUTO_PRINT_ENABLED=false):
      //    skip without retry — this is operator intent, not an error.
      if (!isAutoPrintEnabled()) {
        await this.skipJob(job, "auto-print disabled (AUTO_PRINT_ENABLED=false)");
        return;
      }

      // 2) KOT printer absent/degraded: fail ONCE (skip, no retry storm).
      //    The parked round-1 gap was specifically the kitchen printer —
      //    gate the KITCHEN_PRINTER jobs (kot / kot_customer_copy). Other
      //    print types keep their legacy fail-retry-to-final-failed path
      //    (HAG-13 adds one rate-limited admin notice on final failure).
      const printerKey = PrintConfig.resolvePrinterWithOverride(job.print_type);
      const printer = PrintConfig.getPrinter(printerKey);
      if (printerKey === "KITCHEN_PRINTER") {
        const gate = await gateForJob({
          printerName: printer.name,
          printerKey,
          jobLabel: `KOT print job ${job.job_id} (${job.print_type})`,
        });
        if (!gate.proceed) {
          await this.skipJob(job, gate.reason);
          return;
        }
      }

      const result = await this.executePrintJob(job);

      // FIX: executePrintJob can resolve normally with { success: false, error }
      // (e.g. printer offline, pdf-to-printer failure) instead of throwing.
      // Previously this branch didn't check result.success, so a genuinely
      // failed print was still marked 'completed'/'success' here — hiding
      // the failure and skipping retries. Now we explicitly throw so the
      // catch block below handles retry/failure logging correctly.
      if (!result || result.success === false) {
        throw new Error(result?.error || "Print job failed");
      }

      // Success
      await db.query(`UPDATE print_queue SET status = 'completed' WHERE id = ?`, [job.id]);

      const printNo = `PRN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`;
      await db.query(
        `INSERT INTO print_logs
          (print_type, reference_id, reference_type, printer_name, printed_by, printed_at, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`,
        [
          job.print_type,
          job.id,
          job.print_type,
          job.printer_name,
          numericUserId(result.printedBy),
          new Date(),
          null,
        ],
      );

      this.logger(`Job completed: ${job.job_id} in ${Date.now() - startTime}ms (${printNo})`);
    } catch (err) {
      this.logger(`Job failed: ${job.job_id} error=${err.message}`);

      const newRetryCount = (job.retry_count || 0) + 1;

      if (newRetryCount >= (job.max_retries || 3)) {
        // Final failure
        await db.query(
          `UPDATE print_queue SET status = 'failed', retry_count = ?, error_message = ? WHERE id = ?`,
          [newRetryCount, err.message, job.id],
        );

        // HAG-13: printer exists but the send keeps failing (offline /
        // driver error) — surface ONE rate-limited admin notice.
        const { notifyAdmin } = require("./adminNotice");
        await notifyAdmin({
          type: "printer_degraded",
          title: `Print job ${job.job_id} failed after ${job.max_retries || 3} attempts`,
          message:
            `Printer "${job.printer_name}" is installed but the print job ${job.job_id} (${job.print_type}) ` +
            `failed: ${err.message}. Check that the printer is online/ready and the paper form is loaded; ` +
            `or point the printer override (KOT_PRINTER_NAME / KITCHEN_PRINTER_NAME) at a working one.`,
          data: { job: job.job_id, printType: job.print_type, printer: job.printer_name, error: err.message },
        }).catch(() => {});

        // Log failure
        await db.query(
          `INSERT INTO print_logs
            (print_type, reference_id, reference_type, printer_name, printed_by, printed_at, status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`,
          [
            job.print_type,
            job.id,
            job.print_type,
            job.printer_name,
            null,
            new Date(),
            err.message,
          ],
        );
      } else {
        // Retry — re-queue
        await db.query(
          `UPDATE print_queue SET status = 'queued', retry_count = ? WHERE id = ?`,
          [newRetryCount, job.id],
        );
        this.logger(`Job re-queued for retry: ${job.job_id} attempt=${newRetryCount}/${job.max_retries}`);
      }
    }
  }

  /**
   * Execute the actual print job by delegating to the appropriate service.
   */
  async executePrintJob(job) {
    const { print_type, payload } = job;

    let payloadObj = {};
    if (typeof payload === "string") {
      try {
        payloadObj = JSON.parse(payload);
      } catch {
        payloadObj = { raw: payload };
      }
    } else if (typeof payload === "object") {
      payloadObj = payload;
    }

    const printerKey = PrintConfig.resolvePrinterWithOverride(print_type);
    const printer = PrintConfig.getPrinter(printerKey);

    // Dispatch to the right print service
    switch (print_type) {
      case "kot":
      case "room_service_bill":
      case "kot_customer_copy": {
        const { KitchenPrintService } = require("./KitchenPrintService");
        return KitchenPrintService.printKOT(payloadObj, printerKey);
      }

      case "restaurant_pos_bill": {
        const { RestaurantPrintService } = require("./RestaurantPrintService");
        return RestaurantPrintService.printBill(payloadObj, printerKey);
      }

      case "cash_receipt":
      case "refund_receipt":
      case "payment_receipt":
      case "advance_receipt": {
        const { ThermalPrintService } = require("./ThermalPrintService");
        return ThermalPrintService.printReceipt(print_type, payloadObj, printerKey);
      }

      case "gst_invoice":
      case "final_invoice":
      case "restaurant_bill_a4":
      case "room_service_bill_a4":
      case "credit_settlement":
      case "reservation_confirmation":
      case "guest_registration":
      case "checkout_bill":
      case "folio_statement": {
        const { InvoicePrintService } = require("./InvoicePrintService");
        return InvoicePrintService.printInvoice(print_type, payloadObj, printerKey);
      }

      default: {
        // Fallback: try thermal for receipt types, A4 for everything else
        const isThermal =
          print_type.includes("receipt") || print_type.includes("bill") || print_type.includes("kot");

        if (isThermal) {
          const { ThermalPrintService } = require("./ThermalPrintService");
          return ThermalPrintService.printReceipt(print_type, payloadObj, printerKey);
        } else {
          const { InvoicePrintService } = require("./InvoicePrintService");
          return InvoicePrintService.printInvoice(print_type, payloadObj, printerKey);
        }
      }
    }
  }

  /**
   * Mark jobs as skipped without retry (used when the printer is absent /
   * auto-print is off — HAG-13 graceful degradation).
   */
  async skipJob(job, reason) {
    await db.query(
      `UPDATE print_queue SET status = 'skipped', error_message = ? WHERE id = ?`,
      [reason, job.id],
    );
    this.logger(`Job skipped: ${job.job_id} type=${job.print_type} — ${reason} (no retry)`);
  }

  /**
   * Flush existing pending jobs (called on startup).
   */
  async flushPendingJobs() {
    try {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM print_queue WHERE status IN ('queued', 'processing')`,
      );
      const count = rows?.[0]?.cnt || 0;
      if (count > 0) {
        this.logger(`Resetting ${count} stale print jobs to queued`);
        await db.query(`UPDATE print_queue SET status = 'queued', processed_at = NULL WHERE status = 'processing'`);
      }
    } catch (err) {
      this.logger("Flush failed:", err.message);
    }
  }
}

// Singleton
const printQueue = new PrintQueue();

module.exports = { printQueue, PrintQueue };
