/**
 * PrintConfig — printer selection and configuration.
 *
 * Defines all supported print types and their default printer assignments.
 * Admin can override via DB-driven settings in a future iteration.
 *
 * Default Printers:
 *   1. HP Smart Tank 580 Series (A4) — for GST invoices, reports, guest bills
 *   2. HP Smart Tank Kitchen Printer — for KOT (auto-detected via env var)
 *   3. RP326 ESC/POS Thermal Receipt Printer (80mm) — for POS bills,
 *      Room Service bills, and payment receipts (optional)
 *
 * Set KITCHEN_PRINTER_NAME env var to your HP printer's Windows name.
 * Example: KITCHEN_PRINTER_NAME="HP Smart Tank 580-590 series PCL-3 (V4)"
 *
 * Supports:
 *   - ESC/POS Commands (thermal only)
 *   - Auto Paper Cut (thermal only)
 *   - Cash Drawer Open (thermal only)
 *   - Silent Printing
 *   - Browser-based printing (HP path)
 */

/**
 * Supported printer definitions.
 *
 * printerKey: unique identifier used in code and env vars
 * name: human-readable printer name
 * type: "a4" or "thermal"
 * paperSize: "A4" or "80mm"
 * driver: "pdf-to-printer" or "escpos"
 * defaultFor: array of print type identifiers
 */
const PRINTERS = {
  A4_PRINTER: {
    printerKey: "A4_PRINTER",
    name: "HP Smart Tank 580 Series",
    type: "a4",
    paperSize: "A4",
    driver: "pdf-to-printer",
    defaultFor: [
      "gst_invoice",
      "advance_payment",
      "final_invoice",
      "restaurant_bill_a4",
      "room_service_bill_a4",
      "credit_settlement",
      "reservation_confirmation",
      "guest_registration",
      "checkout_bill",
      "folio_statement",
    ],
  },
  KITCHEN_PRINTER: {
    printerKey: "KITCHEN_PRINTER",
    // HAG-13: KOT_PRINTER_NAME is the explicit KOT override; it wins over the
    // legacy KITCHEN_PRINTER_NAME. Default stays "kitchen".
    name:
      process.env.KOT_PRINTER_NAME ||
      process.env.KITCHEN_PRINTER_NAME ||
      "kitchen",
    type: "inkjet",
    paperSize: "A5",
    driver: "pdf-to-printer",
    defaultFor: [
      "kot",
      "kot_customer_copy",
    ],
  },
  THERMAL_PRINTER: {
    printerKey: "THERMAL_PRINTER",
    name: "RP326 ESC/POS Thermal Receipt Printer",
    type: "thermal",
    paperSize: "80mm",
    driver: "escpos",
    defaultFor: [
      "restaurant_pos_bill",
      "room_service_bill",
      "advance_receipt",
      "cash_receipt",
      "refund_receipt",
      "payment_receipt",
    ],
  },
};

/**
 * Print type metadata — describes what each print type means and which printer.
 */
const PRINT_TYPES = {
  gst_invoice: {
    label: "GST Invoice",
    printerKey: "A4_PRINTER",
    description: "GST compliant invoice for guest stay",
  },
  final_invoice: {
    label: "Final Invoice",
    printerKey: "A4_PRINTER",
    description: "Final billing invoice at checkout",
  },
  checkout_bill: {
    label: "Checkout Bill",
    printerKey: "A4_PRINTER",
    description: "Bill printed at guest checkout",
  },
  advance_payment: {
    label: "Advance Payment Receipt",
    printerKey: "A4_PRINTER",
    description: "Receipt for advance payment",
  },
  advance_receipt: {
    label: "Advance Payment Receipt",
    printerKey: "THERMAL_PRINTER",
    description: "Thermal receipt for advance payment",
  },
  restaurant_bill_a4: {
    label: "Restaurant Bill (A4)",
    printerKey: "A4_PRINTER",
    description: "A4 copy of restaurant bill",
  },
  room_service_bill_a4: {
    label: "Room Service Bill (A4)",
    printerKey: "A4_PRINTER",
    description: "A4 copy of room service bill",
  },
  restaurant_pos_bill: {
    label: "Restaurant POS Bill",
    printerKey: "THERMAL_PRINTER",
    description: "Thermal customer bill from restaurant",
  },
  room_service_bill: {
    label: "Room Service Bill",
    printerKey: "THERMAL_PRINTER",
    description: "Thermal bill for room service",
  },
  credit_settlement: {
    label: "Credit Settlement",
    printerKey: "A4_PRINTER",
    description: "Credit card settlement document",
  },
  reservation_confirmation: {
    label: "Reservation Confirmation",
    printerKey: "A4_PRINTER",
    description: "Booking confirmation document",
  },
  guest_registration: {
    label: "Guest Registration Form",
    printerKey: "A4_PRINTER",
    description: "Guest registration document",
  },
  kot: {
    label: "Kitchen Order Ticket",
    printerKey: "KITCHEN_PRINTER",
    description: "Auto-printed KOT for kitchen",
  },
  cash_receipt: {
    label: "Cash Receipt",
    printerKey: "THERMAL_PRINTER",
    description: "Thermal cash payment receipt",
  },
  refund_receipt: {
    label: "Refund Receipt",
    printerKey: "THERMAL_PRINTER",
    description: "Thermal refund receipt",
  },
  payment_receipt: {
    label: "Payment Receipt",
    printerKey: "THERMAL_PRINTER",
    description: "Thermal general payment receipt",
  },
  folio_statement: {
    label: "Folio Statement",
    printerKey: "A4_PRINTER",
    description: "Guest folio statement",
  },
};

/**
 * Resolve the printer key for a given print type.
 * Falls back to env var override, then default assignment.
 */
const getPrinterForType = (printType) => {
  const typeConfig = PRINT_TYPES[printType];
  if (typeConfig) {
    return typeConfig.printerKey;
  }
  // Unknown print types default to A4 printer
  return "A4_PRINTER";
};

/**
 * Get printer definition by key.
 */
const getPrinter = (printerKey) => PRINTERS[printerKey] || PRINTERS.A4_PRINTER;

/**
 * Get all configured printers.
 */
const getAllPrinters = () => Object.values(PRINTERS);

/**
 * Get all print types for a printer key.
 */
const getPrintTypesForPrinter = (printerKey) => {
  return Object.entries(PRINT_TYPES)
    .filter(([, config]) => config.printerKey === printerKey)
    .map(([key, config]) => ({ printType: key, ...config }));
};

/**
 * Resolve printer from environment override.
 * Env var: PRINT_PRINTER_OVERRIDE_<printType>
 * e.g., PRINT_PRINTER_OVERRIDE_kot=KITCHEN_PRINTER
 *
 * Special handling: if printer is KITCHEN_PRINTER and KITCHEN_PRINTER_NAME
 * env var is set, the printer name will be the actual Windows printer name.
 */
const resolvePrinterWithOverride = (printType) => {
  const envKey = `PRINT_PRINTER_OVERRIDE_${printType.toUpperCase()}`;
  const override = process.env[envKey];
  if (override && PRINTERS[override]) {
    return override;
  }
  return getPrinterForType(printType);
};

module.exports = {
  PRINTERS,
  PRINT_TYPES,
  getPrinterForType,
  getPrinter,
  getAllPrinters,
  getPrintTypesForPrinter,
  resolvePrinterWithOverride,
};
