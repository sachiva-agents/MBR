require("dotenv").config({ quiet: process.env.NODE_ENV === "test" });
const express = require("express");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");

const db = require("./config/db");
const { getDbConnectionLabel } = require("./config/databaseConfig");
const { ensureSchema: ensureHotelRoomInventorySchema } = require("./models/RoomsModel");
const { ensureSchema: ensureGuestSchema } = require("./models/GuestProfilesModel");
const { ensureSchema: ensureGuestDocumentSchema } = require("./models/GuestIdentificationsModel");
const { ensureSchema: ensureOtherBookingSchema } = require("./models/BookingSourcesModel");
const { ensureSchema: ensureReferenceNotesSchema } = require("./models/SpecialRequestsModel");
const { ensureSchema: ensureAdvancePaymentSchema } = require("./models/PaymentsModel");
const { ensureSchema: ensureAccountsSchema } = require("./models/ChartOfAccountsModel");
const { ensureSchema: ensureAttendanceSchema } = require("./models/AttendanceRecordsModel");
const { ensureSchema: ensureZkMachinesSchema } = require("./models/AttendanceMachinesModel");
const { ensureSchema: ensureBanquetSchema } = require("./models/BanquetHallsModel");
const { ensureSchema: ensureCompanySchema } = require("./models/ResortProfilesModel");
const { ensureSchema: ensurePaymentHistorySchema } = require("./models/PaymentsModel");
const { ensureSchema: ensurePaxSchema } = require("./models/BookingGuestsModel");
const { ensureSchema: ensurePaymentSchema } = require("./models/PaymentsModel");
const { ensureSchema: ensureRoomServiceSchema } = require("./models/RoomServiceModel");
const { ensureSchema: ensureRoomTariffSchema } = require("./models/RatePlansModel");
const { ensureSchema: ensureTokenSchema } = require("./models/TokensModel");
const { ensureSchema: ensureRestaurantSchema } = require("./models/RestaurantTablesModel");
const { ensureSchema: ensureKitchenSchema } = require("./models/KotOrdersModel");
const { ensureSchema: ensureHousekeepingSchema } = require("./models/HousekeepingStatusesModel");
const { ensureSchema: ensureAuditLogSchema } = require("./models/AuditLogsModel");
const { ensureSchema: ensureCompletedCleaningLogSchema } = require("./models/HousekeepingLogsModel");
const { ensureSchema: ensureAccountsExpansionSchema } = require("./models/AccountsExpansionModel");
const { ensureSchema: ensureAccountsTransactionsSchema } = require("./models/AccountsModel");
const { ensureSchema: ensureInventoryMastersSchema } = require("./models/InventoryCategoriesModel");
const { ensureSchema: ensureMenuRecipeSchema } = require("./models/MenuItemIngredientsModel");
const { ensureSchema: ensureAssignmentSchema } = require("./models/HousekeepingAssignmentsModel");
const { ensureSchema: ensureGroupBookingSchema } = require("./models/BookingsModel");
const { ensureSchema: ensureNotificationSchema } = require("./models/NotificationsModel");
const { ensureSchema: ensureRegisterSchema } = require("./models/UsersModel");
const auditLogger = require("./middleware/auditLogger");
const { getCorsOptions } = require("./config/security");
const { errorMiddleware, notFoundMiddleware } = require("./middleware/errorHandler");

const app = express();
const server = http.createServer(app);
const corsOptions = getCorsOptions();

const io = new Server(server, {
  cors: corsOptions,
});

global.io = io;

app.disable("etag");

io.on("connection", () => {
  console.log("User connected");
});

const isProd = process.env.NODE_ENV === "production";

// helmet only hardens the API responses. The CORS headers below must apply
// everywhere, including /uploads, because the frontend loads uploaded photos
// directly as <img src> and the browser blocks them otherwise.
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
    hsts: isProd ? {} : false,
  }),
);
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});
app.use(auditLogger);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/hotel", require("./routes/bookingRoutes"));
app.use("/api/booking", require("./routes/bookingRoutes"));  // alias
app.use("/api/restaurant", require("./routes/restaurantRoutes"));
app.use("/api/web/dining", require("./routes/diningRoutes"));
app.use("/api/dining", require("./routes/diningRoutes"));  // alias
app.use("/api/room-service", require("./routes/roomServiceRoutes"));
app.use("/api/roomservice", require("./routes/roomServiceRoutes"));  // alias
app.use("/api/room-service-delivery", require("./routes/roomServiceDeliveryRoutes"));
app.use("/api/waiter", require("./routes/waiterRoutes"));
app.use("/api/accounts", require("./routes/accountsRoutes"));
app.use("/api/banquet", require("./routes/banquetRoutes"));
app.use("/api/attendance", require("./routes/attendanceRoutes"));
app.use("/api/zk", require("./routes/zkRoutes"));
app.use("/api/reports", require("./routes/reportsRoutes"));
app.use("/api/report", require("./routes/reportRoutes"));
app.use("/api/reports-suite", require("./routes/reportsSuiteRoutes"));
app.use("/api/assignments", require("./routes/assignmentRoute"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/token", require("./routes/tokenRoutes"));
app.use("/api/payment", require("./routes/paymentRoutes"));




const invoiceRoutes = require("./routes/InvoiceRoutes");
app.use("/api/invoices", invoiceRoutes);
app.use("/api/invoice", invoiceRoutes);

app.use("/api/kitchen", require("./routes/kitchenRoutes"));
app.use("/api/chef", require("./routes/chefRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/notification", require("./routes/notificationRoutes"));  // alias
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/inventory-masters", require("./routes/inventoryMastersRoutes"));
app.use("/api/menu-recipes", require("./routes/menuRecipeRoutes"));
app.use("/api/audit-logs", require("./routes/auditLogRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/backups", require("./routes/backupRoutes"));
app.use("/api/housekeeping", require("./routes/housekeepingRoutes"));
app.use("/api/salary", require("./routes/salaryRoutes"));
app.use("/api/employees", require("./routes/employeeRoutes"));
app.use("/api/employee", require("./routes/employeeRoutes"));  // alias
app.use("/api/roles", require("./routes/roleRoutes"));
app.use("/api/payroll", require("./routes/payrollRoutes"));
app.use("/api/print", require("./routes/printRoutes"));

// Start print queue processor (moved to index.js — starts only after DB init)
// try/catch block intentionally removed to avoid silent failures; consumer in index.js handles it

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is reachable",
  });
});

// Everything below is last: nothing after it runs for a failed request.
app.get("/", (req, res) => {
  res.send("Backend Running");
});
app.use(require("./middleware/rootRoutes"));
app.use(notFoundMiddleware);
app.use(errorMiddleware);

async function bootstrapSchema(label, task) {
  try {
    await task();
  } catch (error) {
    console.error(`${label} failed:`, error.message || error);
  }
}

async function ensureDefaultStaffLogins() {
  const usersModel = require("./models/UsersModel");
  await usersModel.ensureSchema();
  await usersModel.seedDefaults();
}

async function initializeDatabase(options = {}) {
  try {
    const skipPaymentSchema =
      options.skipPaymentSchema === true ||
      String(process.env.SKIP_PAYMENT_SCHEMA_BOOTSTRAP || "").toLowerCase() === "true";

    await db.query("SELECT 1");
    if (process.env.NODE_ENV !== "test") {
      console.log("MySQL Connected");
    }

    await bootstrapSchema("Housekeeping schema init", ensureHousekeepingSchema);
    await bootstrapSchema("Hotel room inventory schema init", ensureHotelRoomInventorySchema);
    await bootstrapSchema("Booking rooms schema init", async () => {
      const bookingRoomsModel = require("./models/BookingRoomsModel");
      await bookingRoomsModel.ensureSchema();
    });
    await bootstrapSchema("Guest schema init", ensureGuestSchema);
    await bootstrapSchema("Guest documents schema init", ensureGuestDocumentSchema);
    await bootstrapSchema("Other booking schema init", ensureOtherBookingSchema);
    await bootstrapSchema("Reference notes schema init", ensureReferenceNotesSchema);
    await bootstrapSchema("Company schema init", ensureCompanySchema);
    await bootstrapSchema("Pax schema init", ensurePaxSchema);
    await bootstrapSchema("Room tariff schema init", ensureRoomTariffSchema);
    await bootstrapSchema("Advance payment schema init", ensureAdvancePaymentSchema);
    await bootstrapSchema("Payment history schema init", ensurePaymentHistorySchema);
    if (!skipPaymentSchema) {
      await bootstrapSchema("Payments schema init", ensurePaymentSchema);
    }
    await bootstrapSchema("Accounts schema init", ensureAccountsSchema);
    await bootstrapSchema("Attendance schema init", ensureAttendanceSchema);
    await bootstrapSchema("ZK attendance machines schema init", ensureZkMachinesSchema);
    await bootstrapSchema("Banquet schema init", ensureBanquetSchema);
    await bootstrapSchema("Room service schema init", ensureRoomServiceSchema);
    await bootstrapSchema("Token schema init", ensureTokenSchema);
    await bootstrapSchema("Restaurant schema init", ensureRestaurantSchema);
    await bootstrapSchema("Kitchen schema init", ensureKitchenSchema);
    await bootstrapSchema("Audit log schema init", ensureAuditLogSchema);
    await bootstrapSchema("Completed cleaning log schema init", ensureCompletedCleaningLogSchema);
    await bootstrapSchema("Accounts transactions schema init", ensureAccountsTransactionsSchema);
    await bootstrapSchema("Accounts expansion schema init", ensureAccountsExpansionSchema);
    await bootstrapSchema("Inventory masters schema init", ensureInventoryMastersSchema);
    await bootstrapSchema("Menu recipe schema init", ensureMenuRecipeSchema);
    await bootstrapSchema("Assignment schema init", ensureAssignmentSchema);
    await bootstrapSchema("Group booking schema init", ensureGroupBookingSchema);
    await bootstrapSchema("Notification schema init", ensureNotificationSchema);
    await bootstrapSchema("Print log schema init", async () => {
      const printLogModel = require("./models/PrintLogsModel");
      await printLogModel.ensureSchema();
    });
    await bootstrapSchema("Holiday calendar schema init", async () => {
      const holidayCalendarModel = require("./models/HolidayCalendarModel");
      await holidayCalendarModel.ensureSchema();
    });
    await bootstrapSchema("Default staff login bootstrap", ensureDefaultStaffLogins);
  } catch (error) {
    console.error(
      `Database connection failed (${getDbConnectionLabel()}):`,
      error.code || error.message || error,
    );
    console.error("Skipping schema bootstrap until MySQL is available.");
  }
}

function shutdown() {
  try {
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  } catch (error) {
    process.exit(0);
  }
}

module.exports = {
  app,
  server,
  io,
  initializeDatabase,
  shutdown,
};
