const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const attendanceController = require("../controller/attendanceController");

// Self-service routes first so /me is not captured by the list handler.
router.get("/me", authMiddleware, attendanceController.getMyAttendance);
router.get("/me/salary", authMiddleware, attendanceController.calculateMySalary);

// Reads are open to any signed-in user; writes are admin-only.
router.get("/employees", authMiddleware, attendanceController.getEmployees);
router.get("/report", authMiddleware, attendanceController.getAttendanceReport);
router.get("/payroll", authMiddleware, attendanceController.getPayrollAttendance);
router.get("/", authMiddleware, attendanceController.getAllAttendance);

// Mark attendance for self or, with employeeId/userId in the body, anyone.
router.post("/", authMiddleware, roleMiddleware(["admin"]), attendanceController.markAttendance);
router.post("/mark", authMiddleware, roleMiddleware(["admin"]), attendanceController.markAttendance);
// Self-service: any signed-in owner saves their own check-in/out (never others').
router.post("/mark-own", authMiddleware, attendanceController.markMyAttendance);

// Festival / holiday handling: mark every active employee as holiday for a
// date (so payroll pays it in full) and read the holiday calendar.
router.post("/mark-holiday", authMiddleware, roleMiddleware(["admin"]), attendanceController.markHolidayForAll);
router.get("/holidays", authMiddleware, attendanceController.getHolidayCalendar);
router.delete("/holidays/:date", authMiddleware, roleMiddleware(["admin"]), attendanceController.deleteHolidayCalendarEntry);

// Edit / delete a record.
router.put("/:id", authMiddleware, attendanceController.updateAttendanceRecord);
router.patch("/:id", authMiddleware, attendanceController.updateAttendanceRecord);
router.delete("/:id", authMiddleware, roleMiddleware(["admin"]), attendanceController.deleteAttendanceRecord);

module.exports = router;
