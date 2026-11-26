import React, { useCallback, useEffect, useState } from "react";
import {
  FaPlus,
  FaSearch,
  FaSpinner,
  FaTimes,
  FaUserCircle,
  FaUsers,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";

import API, { getErrorMessage } from "../api";

/**
 * Employees — admin HR screen (HAG-12, gap 4).
 *
 * Covers the six /api/employees gap routes in one screen:
 *   GET  /api/employees/departments     -> department picker (create form)
 *   GET  /api/employees/designations    -> designation picker (create form)
 *   POST /api/employees/                -> create employee
 *   GET  /api/employees/:id            -> detail view
 *   PATCH /api/employees/:id           -> edit form
 *   GET  /api/employees/stats          -> headcount strip
 *
 * Route is admin-gated in App.jsx (role guard); list reads are also
 * permitted for manager/accountant by the backend, but the create/edit
 * writes are admin-only server-side.
 */

const field = (row, ...keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return "";
};

const label =
  "mb-1.5 block text-[12px] font-bold uppercase tracking-[0.08em] text-slate-500";
const input =
  "w-full rounded-[14px] border border-blue-200 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const Employees = () => {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [stats, setStats] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null); // employee id in edit mode
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState(emptyForm());
  const [flash, setFlash] = useState({ type: "", text: "" });

  const emptyForm = () => ({
    name: "",
    email: "",
    phone: "",
    role: "",
    department_id: "",
    designation_id: "",
    base_salary: "",
    password: "",
  });

  const flashMsg = (type, text) => {
    setFlash({ type, text });
    if (type) setTimeout(() => setFlash({ type: "", text: "" }), 4000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [empRes, depRes, desRes, statRes, roleRes] = await Promise.allSettled([
        API.get("/employees"),
        API.get("/employees/departments"),
        API.get("/employees/designations"),
        API.get("/employees/stats"),
        API.get("/roles"),
      ]);
      setEmployees(empRes.status === "fulfilled" && Array.isArray(empRes.value.data) ? empRes.value.data : []);
      setDepartments(depRes.status === "fulfilled" && Array.isArray(depRes.value.data) ? depRes.value.data : []);
      setDesignations(desRes.status === "fulfilled" && Array.isArray(desRes.value.data) ? desRes.value.data : []);
      setStats(statRes.status === "fulfilled" ? statRes.value.data : null);
      setRoles(roleRes.status === "fulfilled" && Array.isArray(roleRes.value.data) ? roleRes.value.data : []);
      if (empRes.status === "rejected") {
        console.error("Failed to load employees:", empRes.reason);
        setError(getErrorMessage(empRes.reason, "Failed to load employees"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ---------- create ---------- */

  const handleCreate = async () => {
    if (!form.name.trim() || !form.role) {
      flashMsg("error", "Name and role are required.");
      return;
    }
    try {
      await API.post("/employees/", {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        role: form.role,
        department_id: form.department_id ? Number(form.department_id) : undefined,
        designation_id: form.designation_id ? Number(form.designation_id) : undefined,
        base_salary: form.base_salary === "" ? undefined : Number(form.base_salary),
        password: form.password || undefined,
      });
      flashMsg("success", "Employee created.");
      setCreating(false);
      setForm(emptyForm());
      fetchAll();
    } catch (err) {
      flashMsg("error", getErrorMessage(err, "Failed to create employee"));
    }
  };

  /* ---------- detail ---------- */

  const openDetail = async (id) => {
    setEditing(null);
    try {
      const res = await API.get(`/employees/${id}`);
      const row = res.data;
      setDetail(row);
      setForm({
        name: String(field(row, "username", "name", "first_name") || ""),
        email: String(field(row, "email") || ""),
        phone: String(field(row, "phone", "mobile") || ""),
        role: String(field(row, "role", "role_name") || ""),
        department_id: String(field(row, "department_id", "department") || ""),
        designation_id: String(field(row, "designation_id", "designation") || ""),
        base_salary: String(field(row, "base_salary", "salary") ?? ""),
        password: "",
      });
    } catch (err) {
      flashMsg("error", getErrorMessage(err, "Failed to load employee detail"));
    }
  };

  /* ---------- edit (PATCH) ---------- */

  const startEdit = (row) => {
    setDetail(row);
    setEditing(row.employee_id ?? row.id);
    setForm((f) => ({
      ...f,
      name: String(f.name || field(row, "username", "name", "first_name") || ""),
      email: String(field(row, "email") || ""),
      phone: String(field(row, "phone", "mobile") || ""),
      role: String(field(row, "role", "role_name") || ""),
      department_id: String(field(row, "department_id", "department") || ""),
      designation_id: String(field(row, "designation_id", "designation") || ""),
      base_salary: String(field(row, "base_salary", "salary") ?? ""),
    }));
  };

  const handleUpdate = async () => {
    try {
      await API.patch(`/employees/${editing}`, {
        name: form.name.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        role: form.role || undefined,
        department_id: form.department_id ? Number(form.department_id) : undefined,
        designation_id: form.designation_id ? Number(form.designation_id) : undefined,
        base_salary: form.base_salary === "" ? undefined : Number(form.base_salary),
        password: form.password || undefined,
      });
      flashMsg("success", "Employee updated.");
      setEditing(null);
      setDetail(null);
      setForm(emptyForm());
      fetchAll();
    } catch (err) {
      flashMsg("error", getErrorMessage(err, "Failed to update employee"));
    }
  };

  /* ---------- filter ---------- */

  const q = search.trim().toLowerCase();
  const visibleEmployees = q
    ? employees.filter((row) =>
        [row.username, row.name, row.first_name, row.email, row.designation, row.role, row.employee_code, row.employee_id]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
    : employees;

  const statusPill = (row) => {
    const s = String(row.user_status || row.status || "active").toLowerCase();
    return s.includes("inact")
      ? "bg-rose-100 text-rose-700"
      : "bg-emerald-100 text-emerald-700";
  };

  const designationName = (id) => {
    const match = designations.find((d) => String(d.id) === String(id));
    return match ? match.name : "";
  };
  const departmentName = (id) => {
    const match = departments.find((d) => String(d.id) === String(id));
    return match ? match.name : "";
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 shadow-sm">
            <FaUsers className="text-[13px] text-blue-600" />
            <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-blue-700">
              Employees
            </span>
          </div>
          <h2 className="mt-3 text-[26px] lg:text-[34px] font-extrabold leading-tight text-slate-900">
            People &amp; Roster
          </h2>
          <p className="mt-1 max-w-2xl text-[15px] font-semibold text-slate-500">
            Create, view and edit employees. Pick department and designation from the master lists.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDetail(null);
            setEditing(null);
            setCreating(true);
            setForm(emptyForm());
          }}
          className="inline-flex items-center gap-2 self-start rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-6 py-3 text-[15px] font-bold text-white shadow-lg transition hover:-translate-y-0.5"
        >
          <FaPlus /> New Employee
        </button>
      </div>

      {flash.type && (
        <div
          className={`rounded-[18px] border px-4 py-3 text-[15px] font-bold ${
            flash.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {flash.text}
        </div>
      )}

      {/* Headcount strip (GET /employees/stats) */}
      {stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["Active employees", stats.total ?? stats.employees ?? "—"],
            ["Present today", stats.present ?? "—"],
            ["Absent today", stats.absent ?? "—"],
            ["On leave", stats.on_leave ?? "—"],
            ["Late", stats.late ?? "—"],
            ["Earned today", stats.earned_today ?? stats.earnedToday ?? "—"],
          ].map(([title, value]) => (
            <div key={title} className="rounded-[18px] border border-blue-100 bg-white px-4 py-3.5 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
              <p className="mt-1 text-[22px] font-extrabold text-blue-700">{value}</p>
            </div>
          ))}
        </section>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <FaSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, code, designation…"
          className={`${input} pl-11`}
        />
      </div>

      {/* Create form */}
      {creating && (
        <section className="rounded-[22px] border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[19px] font-extrabold text-slate-900">New Employee</h3>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-full border border-slate-200 p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <FaTimes />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={label}>Name *</label>
              <input className={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Email</label>
              <input className={input} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input className={input} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Role *</label>
              <select className={input} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="">Select role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.display_name || r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Department</label>
              <select className={input} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Designation</label>
              <select className={input} value={form.designation_id} onChange={(e) => setForm((f) => ({ ...f, designation_id: e.target.value }))}>
                <option value="">—</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Base salary</label>
              <input className={input} type="number" min="0" value={form.base_salary} onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Login password</label>
              <input className={input} type="password" value={form.password} placeholder="default if blank" onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              className="rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-6 py-2.5 text-[14px] font-bold text-white shadow-lg transition hover:-translate-y-0.5"
            >
              Create Employee
            </button>
          </div>
        </section>
      )}

      {/* Detail + edit panel */}
      {detail && (
        <section className="rounded-[22px] border border-blue-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[19px] font-extrabold text-slate-900">
              <FaUserCircle className="text-blue-500" />
              {editing ? "Edit Employee" : "Employee Detail"}
            </h3>
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                setEditing(null);
              }}
              className="rounded-full border border-slate-200 p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <FaTimes />
            </button>
          </div>
          {editing ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className={label}>Name</label>
                <input className={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Email</label>
                <input className={input} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Phone</label>
                <input className={input} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Role</label>
                <select className={input} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                  <option value="">—</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>{r.display_name || r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Department</label>
                <select className={input} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Designation</label>
                <select className={input} value={form.designation_id} onChange={(e) => setForm((f) => ({ ...f, designation_id: e.target.value }))}>
                  <option value="">—</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Base salary</label>
                <input className={input} type="number" min="0" value={form.base_salary} onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))} />
              </div>
              <div>
                <label className={label}>New password</label>
                <input className={input} type="password" value={form.password} placeholder="leave blank to keep" onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[15px] sm:grid-cols-3">
              {[
                ["Name", field(detail, "username", "name", "first_name")],
                ["Employee code", field(detail, "employee_code", "employee_id")],
                ["Email", field(detail, "email") || "—"],
                ["Phone", field(detail, "phone", "mobile") || "—"],
                ["Role", field(detail, "role", "role_name") || "—"],
                ["Department", departmentName(detail.department_id ?? detail.department) || "—"],
                ["Designation", designationName(detail.designation_id) || field(detail, "designation") || "—"],
                ["Base salary", field(detail, "base_salary", "salary") || "—"],
                ["Status", field(detail, "user_status", "status", "is_active") || "—"],
              ].map(([term, value]) => (
                <div key={term}>
                  <dt className="text-[12px] font-bold uppercase tracking-[0.08em] text-slate-400">{term}</dt>
                  <dd className="mt-0.5 font-bold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {editing && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleUpdate}
                className="rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-6 py-2.5 text-[14px] font-bold text-white shadow-lg transition hover:-translate-y-0.5"
              >
                Save Changes
              </button>
            </div>
          )}
        </section>
      )}

      {/* List */}
      {error && (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <FaSpinner className="animate-spin text-blue-500" />
        </div>
      ) : (
        <section className="overflow-hidden rounded-[22px] border border-blue-100 bg-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.18)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="bg-gradient-to-b from-[#f4f9ff] to-[#e8f2ff] text-[12px] font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3.5">Employee</th>
                  <th className="px-4 py-3.5">Code</th>
                  <th className="px-4 py-3.5">Role</th>
                  <th className="px-4 py-3.5">Designation</th>
                  <th className="px-4 py-3.5">Base salary</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleEmployees.map((row) => {
                  const id = row.employee_id ?? row.id;
                  return (
                    <tr key={id} className="border-t border-blue-50/80 hover:bg-blue-50/30">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">
                          {field(row, "username", "name", "first_name") || "—"}
                        </p>
                        <p className="text-[13px] text-slate-500">{row.email || ""}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-600">
                        {field(row, "employee_code") || id || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-700">
                          {field(row, "role", "role_name") || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-600">
                        {designationName(row.designation_id) || row.designation || "—"}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        ₹ {Number(field(row, "base_salary", "salary") || 0).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${statusPill(row)}`}>
                          {field(row, "user_status", "status") || "active"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openDetail(id)}
                            className="rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-[12px] font-bold text-blue-700 transition hover:bg-blue-100"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-bold text-slate-600 transition hover:bg-slate-50"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleEmployees.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">
                      No employees found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-blue-50 px-5 py-3.5 text-[13px] font-semibold text-slate-500">
            Manage this person's login in <button type="button" className="font-bold text-blue-700 hover:underline" onClick={() => navigate("/user")}>User Management</button>.
          </div>
        </section>
      )}
    </div>
  );
};

export default Employees;
