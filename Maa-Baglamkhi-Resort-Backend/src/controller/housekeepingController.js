const db = require("../config/db");
const Housekeeping = require("../models/Housekeeping");
const {
  ensureSchema: ensureCompletedCleaningLogSchema,
} = require("../models/CompletedCleaningLogModel");

// Housekeeping.js exports a single namespace object, so `syncOperationalStatus`
// is a property on it rather than a standalone module export.
const syncOperationalStatus = Housekeeping.syncOperationalStatus;

// v4 promise pool: db.query returns [rows, fields], destructure to get the actual result
const query = async (sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return rows;
};

const formatBusyUntil = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "the current task is completed";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

const getDefaultCleaningMinutes = async () => {
  try {
    const rows = await query("SELECT cleaning_time_minutes FROM hk_parameters LIMIT 1");
    return Math.max(1, Number(rows?.[0]?.cleaning_time_minutes || 30));
  } catch {
    return 30;
  }
};

const getActiveTaskForAssignee = async (assignee, excludeRoomNo = null, excludeRoomId = null) => {
  if (!assignee || String(assignee).toLowerCase() === "no housekeeper") return null;
  const rows = await query(
    `SELECT *
     FROM hk_messages
     WHERE assigned_to = ?
       AND status <> 'Completed'
       AND (due_at IS NULL OR due_at > NOW())
       AND (? IS NULL OR CAST(room_no AS CHAR) <> CAST(? AS CHAR))
       AND (? IS NULL OR CAST(room_id AS CHAR) <> CAST(? AS CHAR))
     ORDER BY due_at DESC, sent_at DESC
     LIMIT 1`,
    [assignee, excludeRoomNo, excludeRoomNo, excludeRoomId, excludeRoomId]
  );
  return rows[0] || null;
};

const getActiveTaskForRoom = async (roomId, roomNo) => {
  const rows = await query(
    `SELECT *
     FROM hk_messages
     WHERE status <> 'Completed'
       AND (due_at IS NULL OR due_at > NOW())
       AND ((? IS NOT NULL AND CAST(room_id AS CHAR) = CAST(? AS CHAR))
         OR (? IS NOT NULL AND CAST(room_no AS CHAR) = CAST(? AS CHAR)))
     ORDER BY due_at DESC, sent_at DESC
     LIMIT 1`,
    [roomId, roomId, roomNo, roomNo]
  );
  return rows[0] || null;
};

const emitHousekeepingUpdate = (payload = {}) => {
  global.io?.emit("housekeeping-task-updated", payload);
};

const sendBusyResponse = (res, task) => {
  const until = formatBusyUntil(task?.due_at);
  return res.status(409).json({
    message: `This housekeeper is already assigned until ${until}. Please choose another housekeeper.`,
    busyUntil: task?.due_at || null,
  });
};

exports.bootstrap = async (req, res, next) => {
  try {
    await Housekeeping.ensureSchema();
    await ensureCompletedCleaningLogSchema();
    next();
  } catch (error) {
    res.status(500).json({
      message: "Failed to prepare housekeeping schema",
      error: error.message || error,
    });
  }
};

exports.getAllRooms = (req, res) => {
  Housekeeping.getAllRooms((err, results) => {
    if (err) {
      console.error("getAllRooms error:", err);
      return res.status(500).json({
        message: "Database error",
        error: err.message,
      });
    }

    res.json(results);
  });
};

exports.createRoom = (req, res) => {
  const data = {
    roomNo: req.body.roomNo || req.body.roomNumber,
    type: req.body.type,
    building: req.body.building,
    floor: req.body.floor,
    section: req.body.section,
    guestStatus: req.body.guestStatus,
    roomType: req.body.roomType,
    status: req.body.status,
    assignee: req.body.assignee,
    priority: req.body.priority,
    notes: req.body.notes,
    cleaningStart: req.body.cleaningStart,
    cleaningEnd: req.body.cleaningEnd,
    layout: req.body.layout,
    articles: req.body.articles,
    services: req.body.services,
  };

  if (!data.roomNo) {
    return res.status(400).json({ message: "roomNo is required" });
  }

  Housekeeping.createRoom(data, (err, result) => {
    if (err) {
      console.error("createRoom error:", err);
      return res.status(500).json({
        message: "Insert failed",
        error: err.message,
      });
    }

    res.json({
      message: result.updatedExisting
        ? "Room already existed, details updated successfully"
        : "Room created successfully",
      id: result.insertId,
      updatedExisting: Boolean(result.updatedExisting),
    });
  });
};

exports.updateRoom = (req, res) => {
  const id = req.params.id;

  const data = {
    type: req.body.type || "Accommodation",
    building: req.body.building || null,
    floor: req.body.floor || null,
    section: req.body.section || null,
    guestStatus: req.body.guestStatus || null,
    roomType: req.body.roomType || null,
    status: req.body.status || "Vacant Dirty",
    assignee: req.body.assignee || "No Housekeeper",
    priority: req.body.priority || "Normal",
    notes: req.body.notes || "",
    cleaningStart: req.body.cleaningStart || null,
    cleaningEnd: req.body.cleaningEnd || null,
    layout: req.body.layout || null,
    articles: req.body.articles || null,
    services: req.body.services || null,
  };

  Housekeeping.updateRoom(id, data, (err, result) => {
    if (err) {
      console.error("updateRoom error:", err);
      return res.status(500).json({
        message: "Update failed",
        error: err.message,
      });
    }

    res.json(result);
  });
};

// The only statuses that mapHousekeepingToHotelStatus understands; anything
// else would write a free-form label that never syncs to rooms/inventory.
const HOUSEKEEPING_STATUSES = {
  "vacant clean": "Vacant Clean",
  "vacant dirty": "Vacant Dirty",
  "cleaning in progress": "Cleaning In Progress",
  "occupied dirty": "Occupied Dirty",
  "out of service": "Out of Service",
};

exports.updateStatus = (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ message: "status is required" });
  }

  const normalized = HOUSEKEEPING_STATUSES[String(status).trim().toLowerCase()];
  if (!normalized) {
    return res.status(400).json({
      message: `Invalid housekeeping status. Allowed: ${Object.values(HOUSEKEEPING_STATUSES).join(", ")}`,
    });
  }

  Housekeeping.updateStatus(id, normalized, (err, result) => {
    if (err) {
      console.error("updateStatus error:", err);
      return res.status(500).json({
        message: "Status update failed",
        error: err.message,
      });
    }

    res.json(result);
  });
};

exports.updateAssignee = (req, res) => {
  const id = req.params.id;
  const { assignee } = req.body;

  if (!assignee) {
    return res.status(400).json({ message: "assignee is required" });
  }

  Housekeeping.updateAssignee(id, assignee, (err, result) => {
    if (err) {
      console.error("updateAssignee error:", err);
      return res.status(500).json({
        message: "Assignee update failed",
        error: err.message,
      });
    }

    res.json(result);
  });
};

exports.getLogs = (req, res) => {
  Housekeeping.getLogs((err, results) => {
    if (err) {
      console.error("getLogs error:", err);
      return res.status(500).json({
        message: "Logs fetch failed",
        error: err.message,
      });
    }

    res.json(results);
  });
};

exports.deleteRoom = (req, res) => {
  const id = req.params.id;

  Housekeeping.deleteRoom(id, (err, result) => {
    if (err) {
      console.error("deleteRoom error:", err);
      return res.status(500).json({
        message: "Delete failed",
        error: err.message,
      });
    }

    res.json(result);
  });
};

exports.getParameters = async (req, res) => {
  try {
    const rows = await query("SELECT * FROM hk_parameters LIMIT 1");
    res.json(rows[0] || {
      cleaning_time_minutes: 30,
      max_rooms_per_housekeeper: 10,
      shift_start_time: "08:00",
      shift_end_time: "20:00",
      auto_release_enabled: true,
      inspection_required: true,
    });
  } catch {
    res.json({});
  }
};

exports.saveParameters = async (req, res) => {
  const {
    cleaningTimeMinutes, maxRoomsPerHousekeeper, shiftStartTime, shiftEndTime,
    autoReleaseEnabled, inspectionRequired, defaultAssignee,
  } = req.body || {};
  try {
    const existing = await query("SELECT id FROM hk_parameters LIMIT 1");
    if (existing.length > 0) {
      await query(
        `UPDATE hk_parameters SET
          cleaning_time_minutes = COALESCE(?, cleaning_time_minutes),
          max_rooms_per_housekeeper = COALESCE(?, max_rooms_per_housekeeper),
          shift_start_time = COALESCE(?, shift_start_time),
          shift_end_time = COALESCE(?, shift_end_time),
          auto_release_enabled = COALESCE(?, auto_release_enabled),
          inspection_required = COALESCE(?, inspection_required),
          default_assignee = COALESCE(?, default_assignee)
          WHERE id = ?`,
        [cleaningTimeMinutes ?? null, maxRoomsPerHousekeeper ?? null, shiftStartTime ?? null, shiftEndTime ?? null,
          autoReleaseEnabled ? 1 : (autoReleaseEnabled === false ? 0 : null), inspectionRequired ? 1 : (inspectionRequired === false ? 0 : null),
          defaultAssignee || null, existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO hk_parameters
          (cleaning_time_minutes, max_rooms_per_housekeeper, shift_start_time, shift_end_time, auto_release_enabled, inspection_required, default_assignee)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cleaningTimeMinutes || 30, maxRoomsPerHousekeeper || 5, shiftStartTime || "09:00", shiftEndTime || "17:00",
          autoReleaseEnabled ? 1 : 0, inspectionRequired ? 1 : 0, defaultAssignee || "No Housekeeper"]
      );
    }
    res.json({ message: "Parameters saved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to save parameters", error: err.message || err });
  }
};

exports.getNotifications = async (req, res) => {
  const { assignee, status } = req.query;
  try {
    let sql = `
      SELECT
        id,
        room_id AS roomId,
        room_no AS roomNo,
        assigned_to AS assignedTo,
        receptionist,
        message,
        task_label AS taskLabel,
        due_at AS dueAt,
        status,
        completed_at AS completedAt,
        sent_at AS sentAt
      FROM hk_messages
      WHERE 1=1
    `;
    const params = [];

    if (assignee) {
      sql += " AND assigned_to = ?";
      params.push(assignee);
    }

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY sent_at DESC, id DESC";
    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch notifications", error: err });
  }
};

exports.sendMessage = async (req, res) => {
  const {
    roomId,
    roomNo,
    assignedTo,
    assignee,
    message,
    taskLabel,
    dueAt,
  } = req.body;
  const cleanMessage = String(message || "").trim();
  const targetAssignee = assignedTo || assignee || null;
  const receptionist = req.body.receptionist || req.user?.name || req.user?.email || "Reception";
  const parsedDueAt = dueAt ? new Date(dueAt) : null;
  const dueAtValue = parsedDueAt && !Number.isNaN(parsedDueAt.getTime()) ? parsedDueAt : null;

  if (!roomNo && !roomId) {
    return res.status(400).json({ message: "roomNo or roomId is required" });
  }

  if (!cleanMessage) {
    return res.status(400).json({ message: "message is required" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO hk_messages
        (room_id, room_no, assigned_to, receptionist, message, task_label, due_at, status, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'New', NOW())`,
      [roomId || null, roomNo || null, targetAssignee, receptionist, cleanMessage, taskLabel || "Room Cleaning", dueAtValue]
    );
    res.json({ message: "Message sent", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Failed to send message", error: err });
  }
};

exports.completeNotification = async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query("SELECT * FROM hk_messages WHERE id = ? LIMIT 1", [id]);
    if (!rows.length) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await query(
      "UPDATE hk_messages SET status = 'Completed', completed_at = NOW() WHERE id = ?",
      [id]
    );

    const row = rows[0];
    // `null` is falsy, so `row.room_id || row.room_no` hands the room number
    // ("T101") to the numeric id column and MySQL aborts the statement with
    // ER_TRUNCATED_WRONG_VALUE. Match only on whichever column is actually set.
    const targetRoomNo = row.room_no || row.room_id;
    if (row.room_id != null) {
      await query(
        "UPDATE housekeeping SET status = 'Vacant Clean', completed_at = NOW() WHERE id = ?",
        [row.room_id]
      );
    }
    if (row.room_no) {
      await query(
        "UPDATE housekeeping SET status = 'Vacant Clean', completed_at = NOW() WHERE roomNo = ?",
        [row.room_no]
      );
    }

    // Mirror the housekeeping.status -> hotel_room_inventory.status / rooms.status
    // so the room immediately shows as "Available" in StaysOverview, the dashboard,
    // and the booking flow (no reception click needed).
    await syncOperationalStatus(String(targetRoomNo), "Vacant Clean");

    // Real-time push so any Stay Overview / Stayover / dashboard tab refreshes
    // instantly without waiting for the 30s polling cycle.
    emitHousekeepingUpdate({
      type: "notification-completed",
      notificationId: Number(id),
      roomId: row.room_id ? Number(row.room_id) : null,
      roomNo: targetRoomNo ? String(targetRoomNo) : null,
      housekeepingStatus: "Vacant Clean",
      hotelStatus: "Available",
      completedAt: new Date().toISOString(),
      completedBy: req.user?.name || req.user?.email || null,
    });

    res.json({
      message: "Notification completed",
      roomNo: targetRoomNo ? String(targetRoomNo) : null,
      housekeepingStatus: "Vacant Clean",
      hotelStatus: "Available",
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to complete notification", error: err });
  }
};

exports.getAmenities = async (req, res) => {
  const { roomId, date } = req.query;
  let sql = "SELECT * FROM hk_amenities_consumption WHERE 1=1";
  const params = [];
  if (roomId) { sql += " AND room_id = ?"; params.push(roomId); }
  if (date) { sql += " AND DATE(created_at) = ?"; params.push(date); }
  sql += " ORDER BY created_at DESC";
  try {
    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

exports.logAmenity = async (req, res) => {
  const { roomId, roomNo, category, itemName, quantity, unitCost, notes, loggedBy } = req.body || {};
  const totalCost = (parseFloat(unitCost) || 0) * (parseInt(quantity) || 1);
  const cat = String(category || "General").trim();
  const name = String(itemName || "Item").trim();
  const qty = parseInt(quantity) || 1;
  const cost = parseFloat(unitCost) || 0;
  const by = String(loggedBy || "Staff").trim();
  try {
    const [result] = await db.query(
      `INSERT INTO hk_amenities_consumption
        (room_id, room_no, category, item_name, quantity, unit_cost, total_cost, notes, logged_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [roomId || null, roomNo || null, cat, name, qty, cost, totalCost, notes || null, by]
    );
    res.json({ message: "Amenity logged", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Insert failed", error: err.message || err });
  }
};

exports.deleteAmenity = async (req, res) => {
  try {
    await query("DELETE FROM hk_amenities_consumption WHERE id = ?", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: err });
  }
};

exports.getInspections = async (req, res) => {
  const { roomId } = req.query;
  let sql = "SELECT * FROM hk_inspections WHERE 1=1";
  const params = [];
  if (roomId) { sql += " AND room_id = ?"; params.push(roomId); }
  sql += " ORDER BY created_at DESC LIMIT 100";
  try {
    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

exports.createInspection = async (req, res) => {
  const { roomId, roomNo, inspectorName, priority, checklist, score, notes } = req.body || {};
  const name = String(inspectorName || "").trim();
  if (!name) {
    return res.status(400).json({ message: "inspector_name is required" });
  }
  try {
    const [result] = await db.query(
      `INSERT INTO hk_inspections
        (room_id, room_no, inspector_name, priority, checklist_json, score, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [roomId || null, roomNo || null, name, priority || "Normal", JSON.stringify(checklist || {}), score ?? 0, notes || null]
    );
    if (score >= 90) {
      await query("UPDATE housekeeping SET status = 'Vacant Clean Inspected' WHERE id = ?", [roomId]);
    }
    res.json({ message: "Inspection submitted", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Insert failed", error: err.message || err });
  }
};

exports.getInspectionById = async (req, res) => {
  try {
    const rows = await query("SELECT * FROM hk_inspections WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    const row = rows[0];
    try { row.checklist_json = JSON.parse(row.checklist_json); } catch {}
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

exports.getLostFound = async (req, res) => {
  try {
    const results = await query("SELECT * FROM hk_lost_found ORDER BY created_at DESC");
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

exports.createLostFound = async (req, res) => {
  const { foundDate, roomNo, roomId, foundBy, category, description, guestName, storageLocation, status, notes } = req.body || {};
  const by = String(foundBy || "").trim();
  if (!by) {
    return res.status(400).json({ message: "found_by is required" });
  }
  try {
    const [result] = await db.query(
      `INSERT INTO hk_lost_found
        (found_date, found_room, room_id, found_by, category, description, guest_name, storage_location, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [foundDate || new Date().toISOString().slice(0, 10), roomNo || null, roomId || null, by,
        category || "Uncategorized", description || "", guestName || null, storageLocation || null, status || "Found", notes || null]
    );
    res.json({ message: "Item reported", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Insert failed", error: err.message || err });
  }
};

exports.updateLostFound = async (req, res) => {
  const { id } = req.params;
  const { status, claimedBy, claimedDate } = req.body;
  try {
    await query(
      "UPDATE hk_lost_found SET status = ?, claimed_by = ?, claimed_date = ? WHERE id = ?",
      [status, claimedBy || null, claimedDate || null, id]
    );
    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: err });
  }
};

exports.deleteLostFound = async (req, res) => {
  try {
    await query("DELETE FROM hk_lost_found WHERE id = ?", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: err });
  }
};

exports.getRoster = async (req, res) => {
  const { weekStart } = req.query;
  try {
    let sql = "SELECT * FROM hk_shift_roster WHERE 1=1";
    const params = [];
    if (weekStart) {
      sql += " AND shift_date >= ? AND shift_date <= DATE_ADD(?, INTERVAL 6 DAY)";
      params.push(weekStart, weekStart);
    }
    sql += " ORDER BY staff_name, shift_date";
    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

exports.saveRoster = async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ message: "No entries provided" });
  }
  try {
    for (const entry of entries) {
      const existing = await query(
        "SELECT id FROM hk_shift_roster WHERE staff_name = ? AND shift_date = ?",
        [entry.staffName, entry.shiftDate]
      );
      if (existing.length > 0) {
        await query("UPDATE hk_shift_roster SET shift = ? WHERE id = ?", [entry.shift, existing[0].id]);
      } else {
        await query(
          "INSERT INTO hk_shift_roster (staff_name, shift_date, shift) VALUES (?, ?, ?)",
          [entry.staffName, entry.shiftDate, entry.shift]
        );
      }
    }
    res.json({ message: "Roster saved", count: entries.length });
  } catch (err) {
    res.status(500).json({ message: "Failed to save roster", error: err });
  }
};

exports.getCostingLogs = async (req, res) => {
  try {
    const results = await query("SELECT * FROM hk_room_costing ORDER BY created_at DESC");
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

exports.logCost = async (req, res) => {
  const {
    roomId, roomNo,
    staffCostPerHour, avgCleaningHours, lineCostPerClean, toiletrieCostPerClean, miscCostPerClean,
    totalCost, loggedBy,
  } = req.body || {};
  const staffCost = (parseFloat(staffCostPerHour) || 0) * (parseFloat(avgCleaningHours) || 0);
  const linenCost = parseFloat(lineCostPerClean) || 0;
  const toiletryCost = parseFloat(toiletrieCostPerClean) || 0;
  const miscCost = parseFloat(miscCostPerClean) || 0;
  const computedTotal = staffCost + linenCost + toiletryCost + miscCost;
  const finalTotal = totalCost != null ? parseFloat(totalCost) : computedTotal;
  try {
    const [result] = await db.query(
      `INSERT INTO hk_room_costing
        (room_id, room_no, staff_cost, linen_cost, toiletrie_cost, misc_cost, total_cost, logged_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [roomId || null, roomNo || null, staffCost, linenCost, toiletryCost, miscCost, finalTotal, loggedBy || "Staff"]
    );
    res.json({ message: "Cost logged", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Insert failed", error: err.message || err });
  }
};

exports.getCheckoutReport = async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().slice(0, 10);
  try {
    // v4 bookings use `check_in` / `check_out` (no `checkout_date`), carry no
    // direct guest/room columns, and store status as lowercase 'checked_out'.
    // Rooms and guests live in booking_rooms / booking_guests / guest_profiles.
    const results = await query(
      `SELECT
        b.id AS booking_id,
        b.booking_code,
        b.check_in,
        b.check_out AS checkout_date,
        b.check_out AS checkout_time,
        b.status AS booking_status,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', bg.first_name, bg.last_name)), ''),
          NULLIF(TRIM(CONCAT_WS(' ', gp.first_name, gp.last_name)), '')
        ) AS guest_name,
        r.room_number AS room_no,
        r.id AS room_id,
        h.id AS hk_room_id,
        h.status AS hk_status,
        h.assignee
      FROM bookings b
      LEFT JOIN booking_rooms br ON br.booking_id = b.id
      LEFT JOIN rooms r ON r.id = br.room_id
      LEFT JOIN booking_guests bg ON bg.booking_id = b.id AND bg.is_primary = 1
      LEFT JOIN guest_profiles gp ON gp.id = bg.guest_profile_id
      LEFT JOIN housekeeping h ON h.roomNo = r.room_number
      WHERE DATE(b.check_out) = ?
        AND b.status = 'checked_out'
      ORDER BY b.check_out DESC, b.id DESC`,
      [targetDate]
    );
    res.json(results);
  } catch (err) {
    console.error("getCheckoutReport error:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
};

exports.getCompletedCleaningLogs = async (req, res) => {
  const { date } = req.query;
  try {
    await ensureCompletedCleaningLogSchema();
    let sql = "SELECT * FROM hk_completed_cleaning_logs";
    const params = [];
    if (date) {
      sql += " WHERE DATE(completed_at) = ?";
      params.push(date);
    }
    sql += " ORDER BY completed_at DESC, id DESC";
    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch completed cleaning logs", error: err });
  }
};

exports.createCompletedCleaningLog = async (req, res) => {
  const {
    roomId,
    roomNo,
    assignee,
    guestStatus,
    finalStatus,
    completedAt,
  } = req.body;

  if (!roomNo) {
    return res.status(400).json({ message: "roomNo is required" });
  }

  try {
    await ensureCompletedCleaningLogSchema();
    const [result] = await db.query(
      `INSERT INTO hk_completed_cleaning_logs
        (room_id, room_no, assignee, guest_status, final_status, completed_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        roomId || null,
        roomNo,
        assignee || null,
        guestStatus || null,
        finalStatus || "Vacant Clean",
        completedAt || new Date(),
      ]
    );
    res.json({ message: "Completed cleaning log saved", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Failed to save completed cleaning log", error: err });
  }
};
