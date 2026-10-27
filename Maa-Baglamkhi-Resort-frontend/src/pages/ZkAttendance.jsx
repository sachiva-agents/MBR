import React, { useEffect, useState } from "react";
import {
  FaClock,
  FaFingerprint,
  FaPlus,
  FaPlug,
  FaSync,
  FaTrash,
  FaTimes,
} from "react-icons/fa";
import API from "../api";
import "./ZkAttendance.css";

/* Admin panel for ESSL / ZKTeco fingerprint attendance machines.
   Registers devices by IP, verifies their clock, and pulls fingerprint
   punches over TCP (the ZKTeco packet protocol). Punches land in
   attendance_records as "ZK fingerprint" rows with day/night shift
   resolution from each machine's shift split. */

const DEFAULT_FORM = {
  name: "",
  ip: "",
  port: 4380,
  machineIp: "",
  machinePort: "",
  machinePassword: "00000000",
  status: "active",
  dayShiftStart: "09:00:00",
  dayShiftEnd: "18:00:00",
  nightShiftStart: "18:00:00",
  nightShiftEnd: "09:00:00",
};

const ZkAttendance = () => {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [syncing, setSyncing] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [mappings, setMappings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [badgeForm, setBadgeForm] = useState({ deviceUserId: "", employeeId: "" });
  const [deviceUsers, setDeviceUsers] = useState(null);
  const [fetchingUsers, setFetchingUsers] = useState(null);
  const [rowMap, setRowMap] = useState({});
  const [pinning, setPinning] = useState(null);

  const loadMachines = async () => {
    try {
      const res = await API.get("/zk/machines");
      setMachines(Array.isArray(res.data?.machines) ? res.data.machines : []);
    } catch (err) {
      setError(err.response?.data?.message || "Machines could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const loadBadgeMap = async () => {
    try {
      const res = await API.get("/zk/badge-map");
      setMappings(Array.isArray(res.data?.mappings) ? res.data.mappings : []);
    } catch {
      setMappings([]);
    }
  };

  const loadEmployees = async () => {
    try {
      const res = await API.get("/employees");
      setEmployees(Array.isArray(res.data) ? res.data : res.data?.employees || []);
    } catch {
      setEmployees([]);
    }
  };

  const mapBadge = async (e) => {
    e.preventDefault();
    const { deviceUserId, employeeId } = badgeForm;
    if (!deviceUserId.trim() || !employeeId) {
      setError("Badge mapping needs both a device id and an employee.");
      return;
    }
    setError("");
    try {
      await API.post("/zk/badge-map", { deviceUserId: deviceUserId.trim(), employeeId: Number(employeeId) });
      setNotice(`Mapped device id ${deviceUserId.trim()} to employee ${employeeId}.`);
      setBadgeForm({ deviceUserId: "", employeeId: "" });
      loadBadgeMap();
    } catch (err) {
      setError(`Badge mapping failed: ${err.response?.data?.message || err.message}`);
    }
  };

  const unmapBadge = async (deviceUserId) => {
    if (!window.confirm(`Unmap device id ${deviceUserId}? Its punches will be skipped unless they match a code or employee id.`)) return;
    setError("");
    try {
      await API.delete(`/zk/badge-map/${encodeURIComponent(deviceUserId)}`);
      setNotice(`Unmapped device id ${deviceUserId}.`);
      loadBadgeMap();
    } catch (err) {
      setError(`Unmap failed: ${err.response?.data?.message || err.message}`);
    }
  };

  useEffect(() => {
    loadMachines();
    loadBadgeMap();
    loadEmployees();
  }, []);

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setEditing(null);
    setShowForm(false);
  };

  const startEdit = (machine) => {
    setForm({
      name: machine.name,
      ip: machine.ip,
      port: machine.port,
      machineIp: machine.machineIp,
      machinePort: machine.machinePort,
      machinePassword: machine.machinePassword || "00000000",
      status: machine.status,
      dayShiftStart: String(machine.dayShiftStart || "09:00:00").slice(0, 5),
      dayShiftEnd: String(machine.dayShiftEnd || "18:00:00").slice(0, 5),
      nightShiftStart: String(machine.nightShiftStart || "18:00:00").slice(0, 5),
      nightShiftEnd: String(machine.nightShiftEnd || "09:00:00").slice(0, 5),
    });
    setEditing(machine.id);
    setShowForm(true);
  };

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveMachine = async () => {
    if (!form.name.trim() || !form.ip.trim()) {
      setError("Name and IP are required.");
      return;
    }
    const payload = {
      ...form,
      port: Number(form.port) || 4380,
      machineIp: form.machineIp || form.ip,
      machinePort: Number(form.machinePort) || Number(form.port) || 4380,
      machinePassword: form.machinePassword || "00000000",
      dayShiftStart: form.dayShiftStart,
      dayShiftEnd: form.dayShiftEnd,
      nightShiftStart: form.nightShiftStart,
      nightShiftEnd: form.nightShiftEnd,
    };
    setError("");
    try {
      if (editing) {
        await API.put(`/zk/machines/${editing}`, payload);
        setNotice("Machine updated.");
      } else {
        await API.post("/zk/machines", payload);
        setNotice("Machine registered.");
      }
      resetForm();
      loadMachines();
    } catch (err) {
      setError(err.response?.data?.message || "Machine could not be saved.");
    }
  };

  const removeMachine = async (id) => {
    if (!window.confirm("Remove this machine? Its pull history stays.")) return;
    setError("");
    try {
      await API.delete(`/zk/machines/${id}`);
      setNotice("Machine removed.");
      loadMachines();
    } catch (err) {
      setError(err.response?.data?.message || "Machine could not be removed.");
    }
  };

  const verifyTime = async (machine) => {
    setVerifying(machine.id);
    setVerifyResult(null);
    setError("");
    try {
      const res = await API.post(`/zk/machines/${machine.id}/verify-time`, {});
      const d = res.data;
      setVerifyResult(
        d.deviceTime
          ? `Device clock ${d.deviceTime} — drift ${Math.abs(d.driftSeconds)}s vs server`
          : "Device answered with no readable clock."
      );
    } catch (err) {
      setError(`Time check failed for ${machine.name}: ${err.response?.data?.message || err.message}`);
    } finally {
      setVerifying(null);
    }
  };

  const testConnection = async (machine) => {
    setVerifying(machine.id);
    setVerifyResult(null);
    setError("");
    try {
      const res = await API.post(`/zk/machines/${machine.id}/test-connection`, {});
      setVerifyResult(
        `${machine.name} connected at ${res.data.address} — device clock ${res.data.deviceTime} (${res.data.latencyMs}ms)`
      );
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      setError(`Connection failed for ${machine.name}: ${detail}`);
    } finally {
      setVerifying(null);
    }
  };

  const syncMachine = async (machine) => {
    setSyncing(machine.id);
    setLastSync(null);
    setError("");
    try {
      const res = await API.post(`/zk/machines/${machine.id}/sync`, {});
      setLastSync(res.data);
      setNotice(
        `Synced ${machine.name}: ${res.data.logsPulled} punches, ` +
          `${res.data.recordsCreated} new records, ${res.data.recordsUpdated} updated` +
          (res.data.recordsSkipped
            ? `. ${res.data.recordsSkipped} unmatched device users skipped (${(res.data.skippedDeviceIds || []).join(", ")}).`
            : ".")
      );
      loadMachines();
    } catch (err) {
      setError(`Sync failed for ${machine.name}: ${err.response?.data?.message || err.message}`);
    } finally {
      setSyncing(null);
    }
  };

  const loadDeviceUsers = async (machine) => {
    setFetchingUsers(machine.id);
    setError("");
    setDeviceUsers(null);
    try {
      const res = await API.post(`/zk/machines/${machine.id}/device-users`, {});
      setDeviceUsers({ machineId: machine.id, machineName: machine.name, users: res.data.users || [], unmatched: res.data.unmatched || [] });
    } catch (err) {
      setError(`Could not read device users: ${err.response?.data?.message || err.message}`);
    } finally {
      setFetchingUsers(null);
    }
  };

  const pinUser = async (deviceId, employeeId) => {
    if (!employeeId) return;
    setPinning(deviceId);
    setError("");
    try {
      await API.post("/zk/badge-map", { deviceUserId: deviceId, employeeId: Number(employeeId) });
      setNotice(`Mapped device id ${deviceId}.`);
      loadBadgeMap();
      const m = machines.find((x) => x.id === deviceUsers?.machineId);
      if (m) loadDeviceUsers(m);
    } catch (err) {
      setError(`Badge mapping failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setPinning(null);
    }
  };

  const timeCell = (value) => String(value || "").slice(0, 5);

  return (
    <div className="zk-attendance rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7 transition-all duration-300">
      <div className="zk-attendance__header flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="zk-attendance__title mt-1 text-[22px] font-bold leading-tight text-[#1f2a44] sm:text-[26px]">
          <span className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-emerald-600 sm:text-[13px]">
            <FaFingerprint />
            Fingerprint Attendance (ESSL / ZKTeco)
          </span>
          Machines
        </h2>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className={
            "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-300 " +
            (showForm
              ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              : "dashboard-button-primary text-white")
          }
        >
          {showForm ? <><FaTimes /> Cancel</> : <><FaPlus /> Register machine</>}
        </button>
      </div>

      {error && (
        <div style={{ padding: 10, borderRadius: 8, background: "#fdecea", color: "#c62828", marginBottom: 14 }}>{error}</div>
      )}
      {notice && !error && (
        <div style={{ padding: 10, borderRadius: 8, background: "#e8f5e9", color: "#1b5e20", marginBottom: 14 }}>{notice}</div>
      )}
      {verifyResult && (
        <div style={{ padding: 10, borderRadius: 8, background: "#e3f2fd", color: "#0d47a1", marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <FaClock /> {verifyResult}
        </div>
      )}
      {lastSync && (
        <div className="mb-3.5 rounded-lg border border-blue-100 bg-blue-50/70 p-2.5 text-[#0d47a1]">
          <strong>Last sync ({lastSync.machine}):</strong> {lastSync.logsPulled} punches in
          {lastSync.window.from} → {lastSync.window.to}, {lastSync.recordsCreated} created,
          {" "}{lastSync.recordsUpdated} updated, at {lastSync.syncedAt}.
        </div>
      )}

      {showForm && (
        <div className="dashboard-card-subtle mb-5 rounded-xl border border-slate-200 p-5">
          <h3 className="mb-4 text-lg font-bold text-[#1f2a44]">{editing ? "Edit machine" : "Register machine"}</h3>
          <div className="zk-attendance__form-grid">
            <label>Name<input value={form.name} onChange={setField("name")} placeholder="Front desk" style={inputStyle} /></label>
            <label>IP<input value={form.ip} onChange={setField("ip")} placeholder="192.168.1.50" style={inputStyle} /></label>
            <label>Port<input type="number" value={form.port} onChange={setField("port")} style={inputStyle} /></label>
            <label>Status
              <select value={form.status} onChange={setField("status")} style={inputStyle}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </label>
            <label>Machine IP (optional override)
              <input value={form.machineIp} onChange={setField("machineIp")} placeholder="defaults to IP" style={inputStyle} />
            </label>
            <label>Machine port (optional override)
              <input type="number" value={form.machinePort} onChange={setField("machinePort")} placeholder="defaults to port" style={inputStyle} />
            </label>
            <label>Communication key
              <input type="password" value={form.machinePassword} onChange={setField("machinePassword")} placeholder="00000000" style={inputStyle} />
            </label>
            <label>Day shift start<input type="time" value={form.dayShiftStart} onChange={setField("dayShiftStart")} style={inputStyle} /></label>
            <label>Day shift end<input type="time" value={form.dayShiftEnd} onChange={setField("dayShiftEnd")} style={inputStyle} /></label>
            <label>Night shift start<input type="time" value={form.nightShiftStart} onChange={setField("nightShiftStart")} style={inputStyle} /></label>
            <label>Night shift end<input type="time" value={form.nightShiftEnd} onChange={setField("nightShiftEnd")} style={inputStyle} /></label>
          </div>
          <p style={{ fontSize: 12, color: "#666", margin: "10px 0 0" }}>
            The night shift split owns 18:00–23:59 and 00:00–08:59, so a 06:00 punch reports against the previous day.
          </p>
          <button onClick={saveMachine} className="dashboard-button-primary mt-3.5 px-4 py-2 text-sm text-white">
            {editing ? "Save changes" : "Register machine"}
          </button>
        </div>
      )}

      {/* Badge map: enroll a device fingerprint id to a specific employee when
          their punch-in id is not their employee_code. */}
      <div className="zk-attendance__table-wrap dashboard-card overflow-hidden rounded-xl mt-5">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <FaFingerprint style={{ color: "#0d47a1" }} />
          <strong style={{ fontSize: 14, color: "#1f2a44" }}>
            Badge map — device fingerprint id → employee
          </strong>
          <span style={{ fontSize: 12, color: "#777" }}>
            A punch only lands on an employee if its device id is a code, a numeric id, or mapped here.
          </span>
        </div>

        <form onSubmit={mapBadge} className="flex flex-wrap items-end gap-3 p-3">
          <label style={{ fontSize: 12, color: "#444" }}>
            Device id
            <input value={badgeForm.deviceUserId}
              onChange={(e) => setBadgeForm((f) => ({ ...f, deviceUserId: e.target.value }))}
              placeholder="e.g. 4482" style={{ ...inputStyle, width: 140 }} />
          </label>
          <label style={{ fontSize: 12, color: "#444" }}>
            Employee
            <select value={badgeForm.employeeId}
              onChange={(e) => setBadgeForm((f) => ({ ...f, employeeId: e.target.value }))}
              style={{ ...inputStyle, width: 260 }}>
              <option value="">— choose employee —</option>
              {employees.map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {`${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.employee_code}
                  {" "}({emp.employee_code})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="dashboard-button-primary px-4 py-2 text-sm text-white">
            Map badge
          </button>
        </form>

        <table className="zk-attendance__table" style={{ borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
              <th style={thStyle}>Device id</th>
              <th style={thStyle}>Employee</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 ? (
              <tr><td colSpan={3} style={tdStyle}>No badge mappings yet.</td></tr>
            ) : (
              mappings.map((m) => (
                <tr key={m.device_user_id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={tdStyle}><code>{m.device_user_id}</code></td>
                  <td style={tdStyle}>{m.first_name} {m.last_name} <span style={{ color: "#777" }}>({m.employee_code})</span></td>
                  <td style={tdStyle}>
                    <ActionBtn onClick={() => unmapBadge(m.device_user_id)} danger><FaTrash />Unmap</ActionBtn>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {deviceUsers && (
        <div className="zk-attendance__table-wrap dashboard-card overflow-hidden rounded-xl mt-5">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
            <FaFingerprint style={{ color: "#0d47a1" }} />
            <strong style={{ fontSize: 14, color: "#1f2a44" }}>
              Registered users — enrolled on {deviceUsers.machineName}
            </strong>
            <span style={{ fontSize: 12, color: "#777" }}>
              Fingerprints are captured on the machine's keypad. Pin any id that does not match an employee to its badge map below.
            </span>
          </div>
          <table className="zk-attendance__table" style={{ borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                <th style={thStyle}>Device id</th>
                <th style={thStyle}>Device name</th>
                <th style={thStyle}>Matched employee</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {deviceUsers.users.length === 0 ? (
                <tr><td colSpan={4} style={tdStyle}>No users enrolled on this device yet.</td></tr>
              ) : (
                deviceUsers.users.map((u) => (
                  <tr key={u.deviceId} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdStyle}><code>{u.deviceId}</code></td>
                    <td style={tdStyle}>{u.deviceName || <span style={{ color: "#999" }}>—</span>}</td>
                    <td style={tdStyle}>
                      {u.matched && u.employee ? (
                        <>
                          <span style={{ color: "#2e7d32", fontWeight: 600 }}>Matched</span>{" "}
                          {u.employee.first_name} {u.employee.last_name}{" "}
                          <span style={{ color: "#777" }}>({u.employee.employee_code})</span>
                        </>
                      ) : (
                        <span style={{ color: "#c62828", fontWeight: 600 }}>Unmatched</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {u.matched ? (
                        <ActionBtn onClick={() => unmapBadge(u.deviceId)} danger><FaTrash />Unmap</ActionBtn>
                      ) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <select
                            value={rowMap[u.deviceId] || ""}
                            onChange={(e) => setRowMap((r) => ({ ...r, [u.deviceId]: e.target.value }))}
                            style={{ ...inputStyle, width: 220 }}
                          >
                            <option value="">— choose employee —</option>
                            {employees.map((emp) => (
                              <option key={emp.employee_id} value={emp.employee_id}>
                                {`${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.employee_code}
                                {" "}({emp.employee_code})
                              </option>
                            ))}
                          </select>
                          <ActionBtn onClick={() => pinUser(u.deviceId, rowMap[u.deviceId])}
                            disabled={pinning === u.deviceId || !rowMap[u.deviceId]} accent>
                            {pinning === u.deviceId ? "Pinning…" : "Pin to employee"}
                          </ActionBtn>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="zk-attendance__table-wrap dashboard-card overflow-hidden rounded-xl">
        <table className="zk-attendance__table" style={{ borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
              <th style={thStyle}>Machine</th>
              <th style={thStyle}>Address</th>
              <th style={thStyle}>Shifts (day / night)</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Last sync</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={tdStyle}>Loading machines…</td></tr>
            ) : machines.length === 0 ? (
              <tr><td colSpan={6} style={tdStyle}>No machines registered yet.</td></tr>
            ) : (
              machines.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={tdStyle}>
                    <strong>{m.name}</strong>
                    <div style={{ fontSize: 12, color: "#777" }}>{String(m.ip || "").includes(":") ? m.ip : `${m.ip}`}</div>
                  </td>
                  <td style={tdStyle}>{m.ip || m.machineIp}:{m.machinePort || m.port}</td>
                  <td style={tdStyle}>
                    {timeCell(m.dayShiftStart)}–{timeCell(m.dayShiftEnd)}{" "}
                    <span style={{ color: "#999" }}>/</span>{" "}
                    {timeCell(m.nightShiftStart)}–{timeCell(m.nightShiftEnd)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                      background: m.status === "active" ? "#e8f5e9" : "#fdecea",
                      color: m.status === "active" ? "#1b5e20" : "#c62828",
                    }}>{m.status}</span>
                  </td>
                  <td style={tdStyle}>{m.lastSyncAt ? new Date(m.lastSyncAt).toLocaleString() : "never"}{m.lastSyncStatus ? ` (${m.lastSyncStatus})` : ""}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActionBtn onClick={() => syncMachine(m)} disabled={syncing === m.id} accent>
                        <FaSync /> {syncing === m.id ? "Syncing…" : "Sync"}
                      </ActionBtn>
                      <ActionBtn onClick={() => testConnection(m)} disabled={verifying === m.id}>
                        <FaPlug /> {verifying === m.id ? "Connecting…" : "Test connection"}
                      </ActionBtn>
                      <ActionBtn onClick={() => verifyTime(m)} disabled={verifying === m.id}>
                        <FaClock /> {verifying === m.id ? "Checking…" : "Check time"}
                      </ActionBtn>
                      <ActionBtn onClick={() => loadDeviceUsers(m)} disabled={fetchingUsers === m.id}>
                        <FaFingerprint /> {fetchingUsers === m.id ? "Reading…" : "Registered users"}
                      </ActionBtn>
                      <ActionBtn onClick={() => startEdit(m)}><FaTimes style={{ display: "none" }} />Edit</ActionBtn>
                      <ActionBtn onClick={() => removeMachine(m.id)} danger><FaTrash />Remove</ActionBtn>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const thStyle = { padding: "10px 12px", fontWeight: 600, color: "#444" };
const tdStyle = { padding: "10px 12px", verticalAlign: "top" };
const inputStyle = {
  width: "100%", marginTop: 4, padding: "7px 9px",
  border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box",
};

const ActionBtn = ({ children, onClick, disabled, accent, danger }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
      border: "1px solid " + (accent ? "#2e7d32" : danger ? "#c62828" : "#999"),
      background: accent ? "#e8f5e9" : danger ? "#fdecea" : "#f5f5f5",
      color: accent ? "#2e7d32" : danger ? "#c62828" : "#333",
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {children}
  </button>
);

export default ZkAttendance;
