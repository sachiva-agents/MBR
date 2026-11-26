import React, { useEffect, useMemo, useState } from "react";
import {
  FaCalculator,
  FaCoins,
  FaHandHoldingUsd,
  FaPlus,
  FaShieldAlt,
  FaSpinner,
  FaUsersCog,
} from "react-icons/fa";
import API from "../api";
import { localDate, localMonth } from "../utils/localDate";

const STATUS_BADGE = {
  paid: "bg-emerald-100 text-emerald-700",
  approved: "bg-blue-100 text-blue-700",
  draft: "bg-amber-100 text-amber-700",
  cancelled: "bg-rose-100 text-rose-700",
};

const inr = (n) =>
  `₹ ${parseFloat(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const getEstimateError = (err) =>
  err?.response?.data?.message || "Could not estimate salary";

const Payroll = () => {
  const [tab, setTab] = useState("payments");
  const [payments, setPayments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [payees, setPayees] = useState([]);
  // Salary estimate panel (HAG-12): GET /api/payroll/estimate/:employeeId
  const [estimateEmployee, setEstimateEmployee] = useState("");
  const [estimateMonth, setEstimateMonth] = useState(localMonth());
  const [estimate, setEstimate] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [month, setMonth] = useState(localMonth());
  const [form, setForm] = useState({
    employee_id: "",
    basic_salary: "",
    allowances: "",
    deductions: "",
    payment_method: "bank",
  });

  const flash = (type, text) => {
    setMsg({ type, text });
    if (type) setTimeout(() => setMsg({ type: "", text: "" }), 4000);
  };

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const [p, e, r] = await Promise.all([
          API.get("/payroll/payments"),
          API.get("/employees"),
          API.get("/roles"),
        ]);
        if (!live) return;
        setPayments(Array.isArray(p.data) ? p.data : []);
        setEmployees(Array.isArray(e.data) ? e.data : []);
        setRoles(Array.isArray(r.data) ? r.data : []);
        setPayees(
          employees
            .filter((s) => s.employee_id != null && String(s.user_status) !== "inactive")
            .map((s) => ({
              value: s.employee_id,
              label: `${s.username || s.first_name || "Unnamed"} (${s.employee_code || s.employee_id})`,
              salary: Number(s.base_salary || 0),
            }))
        );
      } catch (err) {
        console.error("Error loading payroll", err);
        flash("error", "Failed to load payroll data");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);


  const refreshRoles = async () => {
    try {
      const r = await API.get("/roles");
      setRoles(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      flash("error", "Failed to refresh roles");
    }
  };

  // Role create/edit UI state lives here so the roles table's Edit button
  // and the RoleManager card stay in sync.
  const [roleEditing, setRoleEditing] = useState(null); // role row or "create"

  const pickEmployee = (id) => {
    const row = payees.find((p) => String(p.value) === String(id));
    setForm((f) => ({
      ...f,
      employee_id: id,
      basic_salary: row ? String(row.salary) : f.basic_salary,
    }));
  };

  const createPayment = async () => {
    if (!form.employee_id) return flash("error", "Choose an employee");
    setSaving(true);
    try {
      await API.post("/payroll/payments", {
        employee_id: form.employee_id,
        month,
        basic_salary: parseFloat(form.basic_salary || 0),
        allowances: parseFloat(form.allowances || 0),
        deductions: parseFloat(form.deductions || 0),
        payment_method: form.payment_method,
      });
      flash("success", "Salary payment created");
      const r = await API.get("/payroll/payments");
      setPayments(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      flash("error", err.response?.data?.message || "Failed to create payment");
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (id) => {
    try {
      await API.post(`/payroll/payments/${id}/mark-paid`, {});
      const r = await API.get("/payroll/payments");
      setPayments(r.data || []);
      flash("success", "Salary marked as paid");
    } catch (err) {
      flash("error", err.response?.data?.message || "Failed to mark paid");
    }
  };

  // Pull the backend's own estimate (GET /payroll/estimate/:employeeId) for
  // the selected month; it reflects attendance-based pay rules.
  const runEstimate = async () => {
    if (!estimateEmployee) return;
    setEstimateLoading(true);
    setEstimate(null);
    try {
      const res = await API.get(`/payroll/estimate/${estimateEmployee}`, {
        params: { month: estimateMonth },
      });
      setEstimate(res.data);
    } catch (err) {
      flash("error", getEstimateError(err));
    } finally {
      setEstimateLoading(false);
    }
  };

  const totals = useMemo(
    () =>
      payments.reduce(
        (a, p) => ({
          net: a.net + Number(p.net_salary || 0),
          paid: a.paid + Number(p.paid_amount || 0),
          draft: a.draft + (p.status === "draft" ? 1 : 0),
          paidCount: a.paidCount + (p.status === "paid" ? 1 : 0),
        }),
        { net: 0, paid: 0, draft: 0, paidCount: 0 }
      ),
    [payments]
  );

  const card =
    "rounded-[22px] border border-blue-100 bg-white p-5 shadow-[0_8px_24px_-8px_rgba(37,99,235,0.18)]";
  const input =
    "w-full rounded-[14px] border border-blue-200 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const label = "mb-1.5 block text-[12px] font-bold uppercase tracking-[0.08em] text-slate-500";

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 shadow-sm">
            <FaCoins className="text-[13px] text-blue-600" />
            <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-blue-700">
              Payroll
            </span>
          </div>
          <h2 className="mt-3 text-[26px] lg:text-[34px] font-extrabold leading-tight text-slate-900">
            Salary Payments &amp; Roles
          </h2>
        </div>
        <div className="flex gap-2">
          {[
            ["payments", "Salary Payments"],
            ["estimate", "Estimate"],
            ["roles", "Roles & Permissions"],
          ].map(([key, title]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-5 py-2.5 text-[15px] font-bold transition ${
                tab === key
                  ? "bg-gradient-to-r from-blue-700 to-sky-500 text-white shadow-lg"
                  : "border border-blue-100 bg-white text-slate-600 hover:border-blue-300"
              }`}
            >
              {title}
            </button>
          ))}
        </div>
      </div>

      {msg.type && (
        <div
          className={`rounded-[18px] border px-4 py-3 text-[15px] font-bold ${
            msg.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {tab === "payments" && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className={label}>Total Records</p>
              <p className="text-[28px] font-extrabold text-slate-900">{payments.length}</p>
            </div>
            <div className={card}>
              <p className={label}>Gross Pay</p>
              <p className="text-[24px] font-extrabold text-blue-700">{inr(totals.net)}</p>
            </div>
            <div className={card}>
              <p className={label}>Paid Out</p>
              <p className="text-[24px] font-extrabold text-emerald-600">{inr(totals.paid)}</p>
            </div>
            <div className={card}>
              <p className={label}>Draft / Paid</p>
              <p className="text-[24px] font-extrabold text-slate-900">
                {totals.draft} / {totals.paidCount}
              </p>
            </div>
          </section>

          <section className={card}>
            <div className="mb-4 flex items-center gap-2">
              <FaHandHoldingUsd className="text-blue-600" />
              <h3 className="text-[19px] font-extrabold text-slate-900">New Salary Payment</h3>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className={label}>Employee</label>
                <select className={input} value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}>
                  <option value="">Select employee…</option>
                  {payees.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Month</label>
                <input
                  type="month"
                  className={input}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </div>
              <div>
                <label className={label}>Method</label>
                <select
                  className={input}
                  value={form.payment_method}
                  onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                >
                  {["bank", "cash", "upi", "cheque"].map((m) => (
                    <option key={m} value={m}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Basic Salary</label>
                <input
                  type="number"
                  min="0"
                  className={input}
                  value={form.basic_salary}
                  onChange={(e) => setForm((f) => ({ ...f, basic_salary: e.target.value }))}
                />
              </div>
              <div>
                <label className={label}>Allowances</label>
                <input
                  type="number"
                  min="0"
                  className={input}
                  value={form.allowances}
                  onChange={(e) => setForm((f) => ({ ...f, allowances: e.target.value }))}
                />
              </div>
              <div>
                <label className={label}>Deductions</label>
                <input
                  type="number"
                  min="0"
                  className={input}
                  value={form.deductions}
                  onChange={(e) => setForm((f) => ({ ...f, deductions: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[15px] font-semibold text-slate-500">
                Net:{" "}
                <span className="font-extrabold text-slate-900">
                  {inr(
                    parseFloat(form.basic_salary || 0) +
                      parseFloat(form.allowances || 0) -
                      parseFloat(form.deductions || 0)
                  )}
                </span>
              </p>
              <button
                onClick={createPayment}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-6 py-2.5 text-[15px] font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <FaSpinner className="animate-spin" /> : <FaPlus />}
                Create Payment
              </button>
            </div>
          </section>

          <section className="rounded-[22px] border border-blue-100 bg-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.18)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[16px]">
                <thead className="bg-gradient-to-b from-[#f4f9ff] to-[#e8f2ff] text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3.5">Employee</th>
                    <th className="px-4 py-3.5">Month</th>
                    <th className="px-4 py-3.5">Net</th>
                    <th className="px-4 py-3.5">Paid</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-blue-50/80 hover:bg-blue-50/30">
                      <td className="px-4 py-3.5">
                        <p className="font-bold text-slate-900">{p.name || "—"}</p>
                        <p className="text-[13px] text-slate-500">{p.employee_code || p.email || ""}</p>
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-600">
                        {String(p.month || "").slice(0, 7)}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-blue-700">{inr(p.net_salary)}</td>
                      <td className="px-4 py-3.5 font-semibold text-slate-600">{inr(p.paid_amount)}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`rounded-full px-3 py-1 text-[12px] font-bold capitalize ${
                            STATUS_BADGE[p.status] || "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {p.status !== "paid" && p.status !== "cancelled" && (
                          <button
                            onClick={() => markPaid(p.id)}
                            className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-1.5 text-[13px] font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">
                        No salary payments yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === "estimate" && (
        <section className={card}>
          <div className="mb-4 flex items-center gap-2">
            <FaCalculator className="text-blue-600" />
            <h3 className="text-[19px] font-extrabold text-slate-900">Salary Estimate</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Employee</label>
              <select
                className={input}
                value={estimateEmployee}
                onChange={(e) => setEstimateEmployee(e.target.value)}
              >
                <option value="">Select employee…</option>
                {payees.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Month</label>
              <input
                type="month"
                className={input}
                value={estimateMonth}
                onChange={(e) => setEstimateMonth(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={runEstimate}
                disabled={estimateLoading || !estimateEmployee}
                className="w-full rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-6 py-2.5 text-[15px] font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {estimateLoading ? <FaSpinner className="mr-2 animate-spin" /> : null}
                Estimate
              </button>
            </div>
          </div>

          {estimate && (
            <div className="mt-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-[16px] bg-slate-50 p-4">
                  <p className={label}>Base Salary</p>
                  <p className="text-[22px] font-extrabold text-slate-900">
                    {inr(estimate.baseSalary)}
                  </p>
                </div>
                <div className="rounded-[16px] bg-slate-50 p-4">
                  <p className={label}>Days Present</p>
                  <p className="text-[22px] font-extrabold text-blue-700">
                    {estimate.daysPresent ?? 0} / {estimate.totalDays ?? "—"}
                  </p>
                </div>
                <div className="rounded-[16px] bg-slate-50 p-4">
                  <p className={label}>Daily Rate</p>
                  <p className="text-[22px] font-extrabold text-slate-900">
                    {inr(estimate.dailyRate)}
                  </p>
                </div>
                <div className="rounded-[16px] bg-emerald-50 p-4">
                  <p className={label}>Net Payable</p>
                  <p className="text-[22px] font-extrabold text-emerald-700">
                    {inr(estimate.netPayable)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[14px] font-semibold text-slate-500">
                {estimate.employee?.name || "Employee"} · {String(estimate.month || "").slice(0, 7)} ·
                earned {inr(estimate.totalEarned)} from {estimate.daysPresent ?? 0} days present
              </p>
            </div>
          )}
        </section>
      )}

      {tab === "roles" && (
        <>
          {/* Role create + edit (HAG-12): POST /api/roles, PATCH /api/roles/:id */}
          <RoleManager
            mode={roleEditing}
            onModeChange={setRoleEditing}
            onChanged={refreshRoles}
            input={input}
            label={label}
            flash={flash}
          />
          <section className="rounded-[22px] border border-blue-100 bg-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.18)] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-blue-50 px-5 py-4">
              <FaShieldAlt className="text-blue-600" />
              <h3 className="text-[19px] font-extrabold text-slate-900">Roles &amp; Permissions</h3>
            </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[16px]">
              <thead className="bg-gradient-to-b from-[#f4f9ff] to-[#e8f2ff] text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-4 py-3.5">Role</th>
                  <th className="px-4 py-3.5">Key</th>
                  <th className="px-4 py-3.5">System</th>
                  <th className="px-4 py-3.5">Permissions</th>
                  <th className="px-4 py-3.5">Description</th>
                  <th className="px-4 py-3.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} className="border-t border-blue-50/80 hover:bg-blue-50/30">
                    <td className="px-4 py-3.5 font-bold text-slate-900">
                      {r.display_name || r.name}
                    </td>
                    <td className="px-4 py-3.5">
                      <code className="rounded bg-slate-100 px-2 py-1 text-[13px] font-semibold text-slate-600">
                        {r.name}
                      </code>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-full px-3 py-1 text-[12px] font-bold ${
                          r.is_system
                            ? "bg-violet-100 text-violet-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {r.is_system ? "System" : "Custom"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-600">
                      {r.permission_count || 0}
                    </td>
                    <td className="px-4 py-3.5 text-slate-500">{r.description || "—"}</td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => setRoleEditing(r)}
                        className="rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-[13px] font-bold text-blue-700 transition hover:bg-blue-100"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      No roles
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 border-t border-blue-50 px-5 py-3.5 text-[13px] font-semibold text-slate-500">
            <FaUsersCog className="text-blue-500" />
            Assign users to roles from User Management. Roles are managed with <code>POST /api/roles</code>.
          </div>
          </section>
        </>
      )}

      {loading && <div className="flex justify-center py-10"><FaSpinner className="animate-spin text-blue-500" /></div>}
    </div>
  );
};

/* ---------- RoleManager: create + edit roles (HAG-12, gap 3) ----------
   mode: null (collapsed card) | "create" | role row (edit). Controlled by
   the parent so the roles table's Edit buttons can open the panel too.   */
const RoleManager = ({ mode, onModeChange, onChanged, input, label, flash }) => {
  const [busy, setBusy] = useState(false);
  const editingRole = mode && mode !== "create" ? mode : null;

  const [form, setForm] = useState({ name: "", display_name: "", description: "" });

  // Hydrate the form whenever the mode switches.
  useEffect(() => {
    if (!mode) return;
    if (mode === "create") {
      setForm({ name: "", display_name: "", description: "" });
    } else {
      setForm({
        name: String(mode.name || ""),
        display_name: String(mode.display_name || ""),
        description: String(mode.description || ""),
      });
    }
  }, [mode]);

  const close = () => onModeChange(null);

  const submit = async () => {
    setBusy(true);
    try {
      if (editingRole) {
        await API.patch(`/roles/${editingRole.id}`, {
          name: form.name.trim() || undefined,
          display_name: form.display_name.trim() || undefined,
          description: form.description.trim() || undefined,
        });
        flash("success", "Role updated");
      } else {
        if (!form.name.trim()) {
          flash("error", "Role name is required");
          setBusy(false);
          return;
        }
        await API.post("/roles", {
          name: form.name.trim(),
          display_name: form.display_name.trim() || undefined,
          description: form.description.trim() || undefined,
        });
        flash("success", "Role created");
      }
      close();
      await onChanged();
    } catch (err) {
      flash("error", err.response?.data?.message || "Role change failed");
    } finally {
      setBusy(false);
    }
  };

  if (!mode) {
    return (
      <section className="flex items-center justify-between rounded-[22px] border border-blue-100 bg-white p-5 shadow-[0_8px_24px_-8px_rgba(37,99,235,0.18)]">
        <div>
          <h3 className="text-[17px] font-extrabold text-slate-900">Create a role</h3>
          <p className="text-[14px] font-semibold text-slate-500">
            New roles become selectable in User Management and the Employees screen.
          </p>
        </div>
        <button
          onClick={() => onModeChange("create")}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-5 py-2.5 text-[14px] font-bold text-white shadow-lg transition hover:-translate-y-0.5"
        >
          <FaPlus /> New Role
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-[22px] border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[17px] font-extrabold text-slate-900">
          {editingRole ? `Edit role: ${editingRole.name}` : "New role"}
        </h3>
        <button onClick={close} className="rounded-full border border-slate-200 px-4 py-1.5 text-[13px] font-bold text-slate-500 transition hover:bg-slate-50">
          Close
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Role key *</label>
          <input
            className={input}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. supervisor"
            disabled={Boolean(editingRole?.is_system)}
          />
        </div>
        <div>
          <label className={label}>Display name</label>
          <input className={input} value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
        </div>
        <div>
          <label className={label}>Description</label>
          <input className={input} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-700 to-sky-500 px-6 py-2.5 text-[14px] font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <FaSpinner className="animate-spin" /> : null}
          {editingRole ? "Save Role" : "Create Role"}
        </button>
      </div>
    </section>
  );
};

export default Payroll;
