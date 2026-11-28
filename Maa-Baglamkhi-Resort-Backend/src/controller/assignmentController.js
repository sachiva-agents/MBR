const db = require("../config/db");
const HousekeepingAssignmentsModel = require("../models/HousekeepingAssignmentsModel");
const { getRequestActor } = require("../utils/requestActor");

const query = async (sql, params = []) => {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    throw err;
  }
};

exports.bootstrap = async (_req, _res, next) => {
  try {
    await HousekeepingAssignmentsModel.ensureSchema();
    next();
  } catch (error) {
    next(error);
  }
};

const { _createNotification } = require("./notificationController");

const TASK_LABELS = {
  cleaning: "Room Cleaning",
  deep_clean: "Deep Clean",
  inspection: "Inspection",
  setup: "Setup",
  maintenance: "Maintenance",
  other: "Assigned Task",
};

/**
 * Fan out the notification rows for one assignment: one to the assignee
 * (plus a copy to the housekeeping role) and one to the creator plus the
 * manager roles. Best effort — errors are logged, never thrown to the caller.
 */
const emitAssignmentNotifications = async ({
  id,
  assignedToId,
  assignedToName,
  assignerId,
  assignerName,
  roomNumber,
  task,
  priority,
  taskType,
  notes,
  dueTime,
}) => {
  const label = TASK_LABELS[taskType] || "Assigned Task";
  const roomText = roomNumber ? `Room ${roomNumber}` : "A room";
  const detail = notes ? ` · ${String(notes).slice(0, 120)}` : "";
  const payload = {
    assignmentId: id,
    roomNumber: roomNumber || null,
    task: String(task || ""),
    priority: priority || "normal",
  };

  if (assignedToName || assignedToId) {
    await _createNotification({
      user_id: assignedToId,
      user_role: assignedToId ? null : "housekeeping",
      type: "assignment_new",
      title: `${label} assigned · ${roomText}`,
      message: `${String(task || label)}${roomText}${detail}. Priority: ${priority}.`,
      data: payload,
    });
  }

  if (assignerName || assignerId) {
    await _createNotification({
      user_id: assignerId,
      user_role: assignerId ? null : "manager",
      type: "assignment_created",
      title: `Assignment logged · ${roomText}`,
      message: assignedToName
        ? `${label} to ${assignedToName} for ${roomText}.`
        : `${label} logged for ${roomText}.`,
      data: payload,
    });
  }
};

/** Notify whoever raised the assignment that it was completed. */
const emitCompletionNotification = async (assignment, actor, action) => {
  const roomText = assignment.room_number ? `Room ${assignment.room_number}` : "A room";
  const label = TASK_LABELS[assignment.task_type] || "Assigned Task";

  await _createNotification({
    user_id: assignment.assigned_by || null,
    user_role: assignment.assigned_by ? null : "manager",
    type: "assignment_completed",
    title: `${roomText} marked ${action} by ${actor.name || "staff"}`,
    message: `${label} on ${roomText} is now ${assignment.status}.`,
    data: {
      assignmentId: assignment.id,
      roomNumber: assignment.room_number || null,
      task: label,
      status: assignment.status,
    },
  });
};

/**
 * Also record the completion in hk_messages so the housekeeping notification
 * list and dashboard (owned by HAG-7) stay in sync with an assignment that
 * was closed from the Assignments screen.
 */
const mirrorCompletionToHkMessages = async (assignment) => {
  const roomKey = assignment.room_number || null;
  if (!roomKey) return;
  await db.query(
    `UPDATE hk_messages
        SET status = 'Completed', completed_at = NOW()
      WHERE (CAST(room_no AS CHAR) = CAST(? AS CHAR))
        AND status NOT IN ('Completed')
        AND id = (
          SELECT id FROM (
            SELECT id FROM hk_messages
            WHERE CAST(room_no AS CHAR) = CAST(? AS CHAR)
            ORDER BY due_at DESC, sent_at DESC
            LIMIT 1
          ) AS latest
        )`,
    [roomKey, roomKey]
  );
};

const getVisibilityContext = (req) => {
  const actor = getRequestActor(req);
  const ASSIGNEE_ROLES = new Set(["housekeeping", "accountant", "staff"]);
  return {
    actor,
    restrictToOwnAssignments: ASSIGNEE_ROLES.has(String(actor.role || "").toLowerCase()) && actor.normalizedName,
  };
};

const isAssigneeRole = (role) => ["housekeeping", "accountant", "staff"].includes(String(role || "").toLowerCase());
const isManagerRole = (role) => ["admin", "manager", "receptionist"].includes(String(role || "").toLowerCase());

// Loose name comparison: housekeeping staff are matched by display name, which
// may differ in case, order, or spacing between the assignment and the session.
const normalizeName = (value) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const namesMatch = (a, b) => {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // "Ravi Sharma" vs "Ravi Kumar Sharma" — one name contains the other
  return left.includes(right) || right.includes(left);
};

/* ── GET ALL (with role-based filtering) ───────────────────────── */
exports.getAll = async (req, res) => {
  const { actor, restrictToOwnAssignments } = getVisibilityContext(req);

  try {
    let sql, params;

    if (restrictToOwnAssignments) {
      sql = `
        SELECT * FROM housekeeping_assignments
        WHERE assigned_to_name = ?
        ORDER BY FIELD(priority,'urgent','high','normal','low'), created_at DESC
      `;
      params = [actor.name];
    } else {
      sql = `
        SELECT * FROM housekeeping_assignments
        ORDER BY FIELD(priority,'urgent','high','normal','low'), created_at DESC
      `;
      params = [];
    }

    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    // Fallback if FIELD() not available
    try {
      const results = await query("SELECT * FROM housekeeping_assignments ORDER BY created_at DESC");
      res.json(results);
    } catch (err2) {
      res.status(500).json({ message: "Database error", error: "Internal server error" });
    }
  }
};

/* ── GET STATS ─────────────────────────────────────────────────── */
// v4 columns: status enum is pending/in_progress/completed/verified/cancelled.
// Overdue = started_at is past AND not yet completed/verified/cancelled.
exports.getStats = async (req, res) => {
  const { actor, restrictToOwnAssignments } = getVisibilityContext(req);
  try {
    const base = "COUNT(*) AS total, SUM(status='completed') AS completed, SUM(status='in_progress') AS in_progress, SUM(status='pending') AS pending";
    let sql, params;

    if (restrictToOwnAssignments) {
      sql = `
        SELECT ${base},
          SUM(
            started_at IS NOT NULL
            AND started_at < NOW()
            AND status NOT IN ('completed','verified','cancelled')
          ) AS overdue
        FROM housekeeping_assignments
        WHERE assigned_to_name = ?
      `;
      params = [actor.name];
    } else {
      sql = `SELECT ${base}, SUM(started_at IS NOT NULL AND started_at < NOW() AND status NOT IN ('completed','verified','cancelled')) AS overdue FROM housekeeping_assignments`;
      params = [];
    }

    const rows = await query(sql, params);
    const stats = rows[0] || {};
    res.json({
      total:       Number(stats.total       || 0),
      completed:   Number(stats.completed   || 0),
      inProgress:  Number(stats.in_progress || 0),
      pending:     Number(stats.pending     || 0),
      overdue:     Number(stats.overdue    || 0),
    });
  } catch (err) {
    res.status(500).json({ message: "Stats fetch failed", error: "Internal server error" });
  }
};

/* ── CREATE ────────────────────────────────────────────────────── */
exports.create = async (req, res) => {
  const {
    staffName, staff_name,
    roomNumber, room_number,
    task,
    priority,
    notes,
    dueTime,
    due_time,
    assignedBy,
    assigned_by,
  } = req.body;

  if (!task) return res.status(400).json({ message: "task is required" });

  const rn = String(roomNumber || room_number || "").trim();
  const actor = getRequestActor(req);

  // Room lookup is advisory: the inventory is not always complete, so an
  // unknown room number still gets an assignment rather than a hard 400.
  let roomId = null;
  if (rn) {
    const roomLookup = await query(
      "SELECT id FROM rooms WHERE CAST(room_number AS CHAR) = CAST(? AS CHAR) LIMIT 1",
      [rn]
    );
    roomId = roomLookup?.[0]?.id ?? null;
  }

  const priorityMap = {
    urgent: "urgent",
    high: "high",
    normal: "normal",
    low: "low",
    medium: "normal",
    critical: "urgent",
  };
  const taskTypeMap = {
    cleaning: "cleaning",
    "deep clean": "deep_clean",
    deepclean: "deep_clean",
    deep_clean: "deep_clean",
    inspection: "inspection",
    setup: "setup",
    maintenance: "maintenance",
    other: "other",
  };

  const normalizedPriority = priorityMap[String(priority || "Normal").toLowerCase()] || "normal";
  const normalizedTaskType = taskTypeMap[String(task).toLowerCase().trim()] || "other";
  const assignedToName = String(staffName || staff_name || "").trim();

  // Resolve the assignee to a user id so notification lookups by user work,
  // not just lookups by name.
  let assignedToId = null;
  if (assignedToName) {
    const staffLookup = await query("SELECT id FROM users WHERE name = ? LIMIT 1", [assignedToName]);
    assignedToId = staffLookup?.[0]?.id ?? null;
  }

  const assignerName = String(assignedBy || assigned_by || actor.name || "").trim() || null;
  const assignerId = assignedToName === assignerName && assignedToId ? assignedToId : actor.id;
  const dueTimeValue = dueTime || due_time ? new Date(dueTime || due_time) : null;

  try {
    // query() returns rows-only, so insertId has to come from db.query.
    const [result] = await db.query(
      `INSERT INTO housekeeping_assignments
         (room_id, room_number, assigned_to, assigned_to_name, task_type, priority,
          notes, assigned_by, assigned_by_name, due_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        roomId,
        rn || null,
        assignedToId,
        assignedToName || null,
        normalizedTaskType,
        normalizedPriority,
        notes || null,
        assignerId,
        assignerName,
        dueTimeValue && !Number.isNaN(dueTimeValue.getTime()) ? dueTimeValue : null,
      ]
    );
    const id = result.insertId;

    // Fire-and-forget: notifications are best effort, and a failure here must
    // not turn an otherwise successful create into a 500.
    emitAssignmentNotifications({
      id,
      assignedToId,
      assignedToName,
      assignerId,
      assignerName,
      roomNumber: rn,
      task,
      priority: normalizedPriority,
      taskType: normalizedTaskType,
      notes,
      dueTime: dueTime || due_time,
    }).catch((err) => {
      console.error("[assignment] notification emit failed:", err.message);
    });

    res.json({ message: "Assignment created", id, status: "pending" });
  } catch (err) {
    res.status(500).json({ message: "Insert failed", error: "Internal server error" });
  }
};

/* ── UPDATE ────────────────────────────────────────────────────── */
exports.update = async (req, res) => {
  const { id } = req.params;
  const actor = getRequestActor(req);
  const {
    status, priority, task,
    staffName, staff_name,
    roomNumber, room_number,
    notes,
  } = req.body;

  // Only real columns of housekeeping_assignments. The old controller also
  // wrote `task`, `staff_name` and `due_time`, none of which exist in v4.
  const STATUS_MAP = {
    pending: "pending",
    "in progress": "in_progress",
    inprogress: "in_progress",
    in_progress: "in_progress",
    started: "in_progress",
    completed: "completed",
    done: "completed",
    verified: "verified",
    cancelled: "cancelled",
    canceled: "cancelled",
  };
  const PRIORITY_MAP = {
    urgent: "urgent", high: "high", normal: "normal",
    low: "low", medium: "normal", critical: "urgent",
  };
  const TASK_TYPE_MAP = {
    cleaning: "cleaning", "deep clean": "deep_clean", deepclean: "deep_clean",
    deep_clean: "deep_clean", inspection: "inspection", setup: "setup",
    maintenance: "maintenance", other: "other",
  };

  const fields = [], values = [];

  if (status !== undefined) {
    fields.push("status = ?");
    values.push(STATUS_MAP[String(status).toLowerCase()] || "pending");
    // Keep the operational timestamps honest without making the caller send them.
    if ((STATUS_MAP[String(status).toLowerCase()]) === "in_progress") {
      fields.push("started_at = NOW()");
    }
    if ((STATUS_MAP[String(status).toLowerCase()]) === "completed") {
      fields.push("completed_at = NOW()");
    }
  }
  if (priority !== undefined) {
    fields.push("priority = ?");
    values.push(PRIORITY_MAP[String(priority).toLowerCase()] || "normal");
  }
  if (task !== undefined) {
    fields.push("task_type = ?");
    values.push(TASK_TYPE_MAP[String(task).toLowerCase().trim()] || "other");
  }
  if (staffName !== undefined || staff_name !== undefined) {
    fields.push("assigned_to_name = ?");
    values.push(staffName ?? staff_name);
    const staffId = await query("SELECT id FROM users WHERE name = ? LIMIT 1", [staffName ?? staff_name]);
    fields.push("assigned_to = ?");
    values.push(staffId?.[0]?.id ?? null);
  }
  if (roomNumber !== undefined || room_number !== undefined) {
    fields.push("room_number = ?");
    values.push(roomNumber ?? room_number);
    const roomLookup = await query(
      "SELECT id FROM rooms WHERE CAST(room_number AS CHAR) = CAST(? AS CHAR) LIMIT 1",
      [roomNumber ?? room_number]
    );
    fields.push("room_id = ?");
    values.push(roomLookup?.[0]?.id ?? null);
  }
  if (notes !== undefined) { fields.push("notes = ?"); values.push(notes); }
  if (req.body.dueTime !== undefined || req.body.due_time !== undefined) {
    fields.push("due_time = ?");
    const raw = req.body.dueTime ?? req.body.due_time;
    const parsed = raw ? new Date(raw) : null;
    values.push(parsed && !Number.isNaN(parsed.getTime()) ? parsed : null);
  }

  if (!fields.length) return res.status(400).json({ message: "No fields to update" });

  try {
    const rows = await query("SELECT * FROM housekeeping_assignments WHERE id = ? LIMIT 1", [id]);
    const existingAssignment = rows[0];

    if (!existingAssignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    if (isAssigneeRole(actor.role) && !isManagerRole(actor.role)) {
      const isOwnAssignment = namesMatch(existingAssignment.assigned_to_name, actor.name);
      const requestedFields = Object.keys(req.body || {});
      const statusOnlyUpdate =
        requestedFields.length === 1 &&
        Object.prototype.hasOwnProperty.call(req.body || {}, "status");

      if (!isOwnAssignment) {
        return res.status(403).json({ message: "You can only update your own assignments" });
      }

      if (!statusOnlyUpdate) {
        return res.status(403).json({ message: "You can only update assignment status" });
      }
    }

    const newStatus = status !== undefined ? STATUS_MAP[String(status).toLowerCase()] : null;
    const wasCompleted = existingAssignment.status === "completed" || existingAssignment.status === "verified";

    values.push(id);
    await query(`UPDATE housekeeping_assignments SET ${fields.join(", ")} WHERE id = ?`, values);

    if (status !== undefined && newStatus !== existingAssignment.status && !wasCompleted) {
      const action = newStatus === "completed" ? "Completed" : newStatus === "cancelled" ? "Cancelled" : "Started";
      const updated = await query("SELECT * FROM housekeeping_assignments WHERE id = ? LIMIT 1", [id]);
      const assignment = updated[0] || existingAssignment;

      if (newStatus === "completed") {
        mirrorCompletionToHkMessages(assignment).catch((err) => {
          console.error("[assignment] hk_messages mirror failed:", err.message);
        });
      }

      if (newStatus === "completed" || newStatus === "cancelled") {
        emitCompletionNotification(assignment, actor, action).catch((err) => {
          console.error("[assignment] completion notification failed:", err.message);
        });
      }
    }

    res.json({ message: "Assignment updated" });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: "Internal server error" });
  }
};

/* ── DELETE ────────────────────────────────────────────────────── */
exports.remove = async (req, res) => {
  try {
    await query("DELETE FROM housekeeping_assignments WHERE id = ?", [req.params.id]);
    res.json({ message: "Assignment deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: "Internal server error" });
  }
};

exports.updateStatus = async (req, res) => exports.update(req, res);
