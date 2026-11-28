/**
 * PrintController — HTTP API endpoints for the printing system.
 *
 * Endpoints:
 *   POST /api/print/queue           — Queue a print job
 *   POST /api/print/reprint         — Reprint by invoice/KOT number
 *   GET  /api/print/history         — Print history with filters
 *   GET  /api/print/status          — Printer status check
 *   GET  /api/print/queue           — Current print queue status
 *   DELETE /api/print/queue/:jobId  — Cancel a queued print job
 *   GET  /api/print/types           — List supported print types
 *   POST /api/print/test            — Test print on a printer
 */

const db = require("../config/db");
const PrintConfig = require("../PrintConfig");
const { printQueue, PrintQueue } = require("../services/PrintQueue");
const { ThermalPrintService } = require("../services/ThermalPrintService");
const { InvoicePrintService } = require("../services/InvoicePrintService");
const { RestaurantPrintService } = require("../services/RestaurantPrintService");
const PrintLogModel = require("../models/PrintLogsModel");
const { getRequestActor } = require("../utils/requestActor");
const { printPdfToPrinter, checkPrinterStatus } = require("../services/PrintUtils");
const path = require("path");
const fs = require("fs");

/**
 * POST /api/print/queue
 * Queue a print job for background processing.
 * Body: { printType, payload, priority, maxRetries }
 */
exports.queuePrint = async (req, res) => {
  try {
    const { printType, payload = {}, priority, maxRetries } = req.body;

    if (!printType) {
      return res.status(400).json({ message: "printType is required" });
    }

    if (!PrintConfig.PRINT_TYPES[printType]) {
      return res.status(400).json({
        message: "Unknown print type",
        validTypes: Object.keys(PrintConfig.PRINT_TYPES),
      });
    }

    const actor = getRequestActor(req);
    payload.printedBy = actor.name || actor.email || "System";

    const jobId = await printQueue.enqueue(printType, payload, priority || 0, maxRetries || 3);

    res.json({
      message: "Print job queued",
      jobId,
      printType,
    });
  } catch (err) {
    console.error("[Print/queue] Error:", err.message);
    res.status(500).json({ message: "Failed to queue print job", error: "Internal server error" });
  }
};

/**
 * POST /api/print/reprint
 * Reprint an existing document.
 * Body: { printType, invoiceNo, kotNo, printedBy }
 */
exports.reprint = async (req, res) => {
  try {
    const { printType, invoiceNo, kotNo } = req.body;
    const actor = getRequestActor(req);
    const printedBy = actor.name || actor.email || "System";

    let result;
    if (printType === "restaurant_pos_bill" || printType === "restaurant_bill_a4") {
      const refNo = invoiceNo || kotNo;
      if (!refNo) return res.status(400).json({ message: "invoiceNo or kotNo is required" });
      result = await RestaurantPrintService.reprintRestaurantBill(refNo);
    } else if (printType === "kot") {
      if (!kotNo) return res.status(400).json({ message: "kotNo is required" });
      const { KitchenPrintService } = require("../services/KitchenPrintService");
      result = await KitchenPrintService.reprintKOT(kotNo, printedBy);
    } else {
      if (!invoiceNo) return res.status(400).json({ message: "invoiceNo is required" });
      result = await InvoicePrintService.reprintInvoice(printType, invoiceNo, printedBy);
    }

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error("[Print/reprint] Error:", err.message);
    res.status(500).json({ message: "Reprint failed", error: "Internal server error" });
  }
};

/**
 * GET /api/print/history
 * Get print history with optional filters.
 * Query: ?printType=&printerName=&invoiceNo=&kotNo=&status=&fromDate=&toDate=&limit=&offset=
 */
exports.getHistory = async (req, res) => {
  try {
    const filters = {
      printType: req.query.printType,
      printerName: req.query.printerName,
      invoiceNo: req.query.invoiceNo,
      kotNo: req.query.kotNo,
      status: req.query.status,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    };

    const history = await PrintLogModel.getPrintHistory(filters);
    res.json({ history, count: history.length });
  } catch (err) {
    console.error("[Print/history] Error:", err.message);
    res.status(500).json({ message: "Failed to fetch print history", error: "Internal server error" });
  }
};

/**
 * GET /api/print/status
 * Check printer status.
 * Query: ?printerName= (defaults to configured printer)
 */
exports.getPrinterStatus = async (req, res) => {
  try {
    const { printerKey } = req.query;
    const resolvedKey = printerKey || "A4_PRINTER";
    const printer = PrintConfig.getPrinter(resolvedKey);

    const status = await checkPrinterStatus(printer.name);

    res.json({
      printerKey: resolvedKey,
      printerName: printer.name,
      type: printer.type,
      paperSize: printer.paperSize,
      ...status,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to check printer status", error: "Internal server error" });
  }
};

/**
 * GET /api/print/queue
 * Get current print queue status.
 */
exports.getQueueStatus = async (req, res) => {
  try {
    const [queued, processing, completed, failed] = await Promise.all([
      db.query("SELECT COUNT(*) AS cnt FROM print_queue WHERE status = 'queued'"),
      db.query("SELECT COUNT(*) AS cnt FROM print_queue WHERE status = 'processing'"),
      db.query("SELECT COUNT(*) AS cnt FROM print_queue WHERE status = 'completed'"),
      db.query("SELECT COUNT(*) AS cnt FROM print_queue WHERE status = 'failed'"),
    ]);

    const [recent] = await db.query(
      `SELECT * FROM print_queue ORDER BY priority DESC, created_at DESC LIMIT 20`
    );

    res.json({
      counts: {
        queued: queued[0]?.cnt || 0,
        processing: processing[0]?.cnt || 0,
        completed: completed[0]?.cnt || 0,
        failed: failed[0]?.cnt || 0,
      },
      recentJobs: recent,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to get queue status", error: "Internal server error" });
  }
};

/**
 * DELETE /api/print/queue/:jobId
 * Cancel a queued print job.
 */
exports.cancelQueueJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const [rows] = await db.query(
      "SELECT * FROM print_queue WHERE job_id = ? LIMIT 1",
      [jobId],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (rows[0].status !== "queued") {
      return res.status(400).json({
        message: `Cannot cancel job with status: ${rows[0].status}`,
      });
    }

    await db.query("DELETE FROM print_queue WHERE job_id = ?", [jobId]);

    res.json({ message: "Job cancelled", jobId });
  } catch (err) {
    console.error("[Print/cancel] Error:", err.message);
    res.status(500).json({ message: "Failed to cancel job", error: "Internal server error" });
  }
};

/**
 * GET /api/print/types
 * List all supported print types with their printer assignments.
 */
exports.getPrintTypes = async (req, res) => {
  try {
    const types = Object.entries(PrintConfig.PRINT_TYPES).map(([key, config]) => ({
      printType: key,
      label: config.label,
      description: config.description,
      printerKey: config.printerKey,
      printerName: PrintConfig.getPrinter(config.printerKey).name,
    }));

    const printers = PrintConfig.getAllPrinters().map((p) => ({
      printerKey: p.printerKey,
      name: p.name,
      type: p.type,
      paperSize: p.paperSize,
      driver: p.driver,
    }));

    res.json({ types, printers });
  } catch (err) {
    res.status(500).json({ message: "Failed to get print types", error: "Internal server error" });
  }
};

/**
 * POST /api/print/test
 * Send a test print to a printer.
 * Body: { printerKey, message }
 */
exports.testPrint = async (req, res) => {
  try {
    const { printerKey, message = "Test Print - Maa Baglamukhi Resort" } = req.body;
    const resolvedKey = printerKey || "A4_PRINTER";
    const printer = PrintConfig.getPrinter(resolvedKey);

    if (printer.type === "thermal") {
      // Generate a simple test receipt
      const receiptData = {
        hotelName: "Maa Baglamukhi Resort",
        receiptNo: "TEST-" + Date.now(),
        date: new Date(),
        notes: message,
        printedBy: "System (Test)",
      };

      const { ThermalPrintService } = require("../services/ThermalPrintService");
      const result = await ThermalPrintService.printReceipt("cash_receipt", receiptData, resolvedKey);

      return res.json({
        success: result.success,
        printer: printer.name,
        type: "thermal",
        error: result.error,
      });
    } else {
      // A4 test print — generate a simple PDF
      const { generateA4InvoicePdf } = require("../services/PrintUtils");
      const pdfResult = await generateA4InvoicePdf({
        invoiceNo: "TEST-" + Date.now(),
        customerName: "Test Print",
        date: new Date().toISOString().slice(0, 10),
        items: [{ name: "Test Print", quantity: 1, total: 0 }],
        subtotal: 0,
        tax: 0,
        totalAmount: 0,
      });

      const printResult = await printPdfToPrinter(pdfResult.filePath, printer.name);

      return res.json({
        success: printResult.success,
        printer: printer.name,
        type: "a4",
        fileName: pdfResult.fileName,
        error: printResult.error,
      });
    }
  } catch (err) {
    console.error("[Print/test] Error:", err.message);
    res.status(500).json({ message: "Test print failed", error: "Internal server error" });
  }
};
