/**
 * InvoicePrintService — A4 invoice PDF generation and printing.
 *
 * Uses the existing pdfkit-based invoice generation and sends to the
 * HP Smart Tank 580 Series A4 printer via pdf-to-printer.
 *
 * Supports:
 *   - GST invoices (hotel stays)
 *   - Final invoices (checkout)
 *   - Restaurant bills (A4 copy)
 *   - Room service bills (A4 copy)
 *   - Credit settlements
 *   - Reservation confirmations
 *   - Guest registration forms
 *   - Folio statements
 */

const path = require("path");
const fs = require("fs");
const PrintConfig = require("../PrintConfig");
const PrintLogModel = require("../models/PrintLogsModel");
const { printQueue } = require("./PrintQueue");
const { generateA4InvoicePdf, printPdfToPrinter } = require("./PrintUtils");

const { generateInvoicePdf: generateLegacyInvoicePdf } = require("./invoicePdfService");
const { generateRestaurantInvoicePdf } = require("./restaurantInvoicePdfService");

/**
 * Print an A4 invoice of the given type.
 * Queues for background processing.
 */
const printInvoice = async (printType, invoiceData, printerKey) => {
  const resolvedPrinterKey = printerKey || PrintConfig.resolvePrinterWithOverride(printType);
  const printer = PrintConfig.getPrinter(resolvedPrinterKey);

  try {
    // Queue for background printing
    await printQueue.enqueue(printType, invoiceData, 5, 3);

    return {
      success: true,
      message: "Invoice queued for printing",
      printType,
      printerName: printer.name,
    };
  } catch (err) {
    return {
      success: false,
      printType,
      printerName: printer.name,
      error: err.message,
    };
  }
};

/**
 * Immediately print an A4 invoice (synchronous).
 */
const immediatePrintInvoice = async (printType, invoiceData, printerKey) => {
  const resolvedPrinterKey = printerKey || PrintConfig.resolvePrinterWithOverride(printType);
  const printer = PrintConfig.getPrinter(resolvedPrinterKey);

  try {
    // Generate PDF using the appropriate generator
    let pdfResult;
    try {
      // Try using the specialized generator based on print type
      // `advance_payment` uses the SAME full GST-design generator as the
      // downloaded/WhatsApp'd "Tax_Invoice_..." file (invoicePdfService),
      // so an advance print is 100% identical to that invoice — the old
      // generic `invoice_ADV-<id>.pdf` receipt layout was dropped.
      if (
        printType === "gst_invoice" ||
        printType === "final_invoice" ||
        printType === "checkout_bill" ||
        printType === "advance_payment"
      ) {
        pdfResult = await generateLegacyInvoicePdf(invoiceData);
      } else if (printType === "restaurant_bill_a4") {
        pdfResult = await generateRestaurantInvoicePdf(invoiceData);
      } else {
        // Generic invoice using our shared A4 generator
        pdfResult = await generateA4InvoicePdf(invoiceData);
      }
    } catch (pdfErr) {
      // Fallback to generic A4 generator
      console.warn(`[InvoicePrint] Specialized PDF failed for ${printType}, using generic:`, pdfErr.message);
      pdfResult = await generateA4InvoicePdf(invoiceData);
    }

    // Send to printer
    const printResult = await printPdfToPrinter(pdfResult.filePath, printer.name);

    // Log the print
    const printNo = PrintLogModel.buildPrintNo();
    await PrintLogModel.createPrintLog({
      printNo,
      invoiceNo: invoiceData.invoiceNo || null,
      printType,
      printerName: printer.name,
      printedBy: invoiceData.printedBy || "System",
      status: printResult.success ? "success" : "failed",
      errorMessage: printResult.error || null,
      metadata: {
        fileName: pdfResult.fileName,
        filePath: pdfResult.filePath,
        subtotal: invoiceData.subtotal,
        totalAmount: invoiceData.totalAmount,
      },
    });

    return {
      success: printResult.success,
      printType,
      printerName: printer.name,
      printNo,
      fileName: pdfResult.fileName,
      error: printResult.error || null,
    };
  } catch (err) {
    console.error(`[InvoicePrint] Failed to print ${printType}:`, err.message);

    await PrintLogModel.createPrintLog({
      printType,
      printerName: printer.name,
      printedBy: invoiceData.printedBy || "System",
      status: "failed",
      errorMessage: err.message,
      metadata: { invoiceNo: invoiceData.invoiceNo },
    });

    return {
      success: false,
      printType,
      printerName: printer.name,
      error: err.message,
    };
  }
};

/**
 * Reproduce an invoice print (reprint).
 */
const reprintInvoice = async (printType, invoiceNo, printedBy) => {
  try {
    // Fetch the original print log
    const history = await PrintLogModel.getPrintHistory({
      invoiceNo,
      printType,
    });
    const lastPrint = history[0];

    if (!lastPrint) {
      return { success: false, error: "Invoice not found in print history" };
    }

    // Re-queue for reprint
    const metadata = typeof lastPrint.metadata === "string" ? JSON.parse(lastPrint.metadata) : lastPrint.metadata || {};

    const invoiceData = {
      invoiceNo,
      printedBy: printedBy || lastPrint.printed_by || "System",
    };

    const resolvedPrinterKey = PrintConfig.resolvePrinterWithOverride(printType);
    const printer = PrintConfig.getPrinter(resolvedPrinterKey);

    // Log the reprint
    await PrintLogModel.createPrintLog({
      invoiceNo,
      printType,
      printerName: printer.name,
      printedBy: invoiceData.printedBy,
      status: "queued",
      metadata: { reprint: true, originalPrintId: lastPrint.id },
    });

    return {
      success: true,
      message: "Reprint queued",
      invoiceNo,
      printType,
      isReprint: true,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

/**
 * Get print history for an invoice.
 */
const getInvoicePrintHistory = async (invoiceNo) => {
  return PrintLogModel.getPrintHistory({ invoiceNo });
};

/**
 * Get print count for an invoice.
 */
const getInvoicePrintCount = async (invoiceNo) => {
  return PrintLogModel.getPrintCount(invoiceNo, null);
};

module.exports = {
  InvoicePrintService: {
    printInvoice,
    immediatePrintInvoice,
    reprintInvoice,
    getInvoicePrintHistory,
    getInvoicePrintCount,
  },
};
