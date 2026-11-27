import React, { useEffect, useState } from "react";
import API from "../api";

const PAY_FIELDS = [
  { key: "presentPay", label: "Present" },
  { key: "latePay", label: "Late" },
  { key: "halfDayPay", label: "Half day" },
  { key: "absentPay", label: "Absent" },
  { key: "leavePay", label: "On leave" },
];

const TEXT_FIELDS = [
  { key: "businessName", label: "Business name" },
  { key: "businessContact", label: "Business contact" },
  { key: "adminWhatsappNumber", label: "Admin WhatsApp number" },
  { key: "adminWhatsappUsername", label: "Admin WhatsApp username" },
];

const Section = ({ title, hint, children }) => (
  <div>
    <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">{title}</div>
    {hint && <div className="mb-3 text-[12px] leading-relaxed text-slate-400">{hint}</div>}
    <div className={hint ? "" : "mb-3"}>{children}</div>
  </div>
);

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // Test-connection result (WhatsApp gateway). null = not run / no result yet.
  const [conn, setConn] = useState(null);

  const load = async () => {
    try {
      const res = await API.get("/settings");
      setSettings(res.data);
    } catch (e) {
      setErr(e.response?.data?.message || e.response?.data?.error || e.message || "Failed to load settings");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy("save");
    setMsg("");
    setErr("");
    try {
      const res = await API.put("/settings", settings);
      setSettings(res.data.settings || res.data);
      setMsg("Settings saved — changes to connectors apply live, no restart needed.");
      // A saved WhatsApp gateway/key change invalidates the last test result.
      setConn(null);
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.response?.data?.error || e2.message || "Failed to save settings");
    } finally {
      setBusy("");
    }
  };

  const testConnection = async () => {
    setBusy("test");
    setConn(null);
    setErr("");
    try {
      // Always test the values just saved, so probe what the admin set now.
      const res = await API.post("/settings/test-connection", {});
      setConn(res.data);
    } catch (e) {
      setConn({ ok: false, status: "error", detail: e.response?.data?.error || e.message || "Connection test failed" });
    } finally {
      setBusy("");
    }
  };

  const inputCls =
    "w-full rounded-[12px] border border-[#DCE6FB] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#0F1E3D] outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10";

  const setPay = (key, raw) => {
    // Empty string while typing; anything else a number clamped 0–100
    // (the backend clamps again — this only keeps the input well-behaved).
    const value = raw === "" ? "" : Math.max(0, Math.min(100, Number(raw) || 0));
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const connBanner = () => {
    if (!conn) return null;
    const tone =
      conn.status === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : conn.status === "http_error"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-red-200 bg-red-50 text-red-700";
    return (
      <div className={`mt-3 rounded-xl border px-4 py-2.5 text-[13px] font-medium ${tone}`}>
        <span className="font-bold">Test connection: </span>
        {conn.detail || conn.status}
        {conn.httpStatus ? <span className="opacity-70"> (HTTP {conn.httpStatus})</span> : null}
      </div>
    );
  };

  if (!settings) {
    return (
      <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7">
        <div className="text-[14px] font-medium text-slate-500">Loading settings…</div>
        {err && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700">{err}</div>}
      </div>
    );
  }

  const keyHint = settings.whatsappApiKey
    ? `Currently ${settings.whatsappApiKey} — leave blank to keep it, type a new key to replace.`
    : "Not set yet (falls back to the backend .env). Leave blank to use the .env value.";

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7 transition-all duration-300">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
        <h2 className="m-0 text-[22px] font-bold leading-tight text-[#1f2a44] sm:text-[26px]">
          <span className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-blue-600 sm:text-[13px]">
            Settings
          </span>
          General, Pay Rules &amp; Connectors
        </h2>
        <p className="m-0 text-[14px] leading-relaxed text-slate-500">
          Pay percentages are a share of the full daily wage per attendance status. The connector
          sections (printer, WhatsApp, ZK attendance, public base URL) apply live after saving —
          no restart and no .env edits. The value in each field is the resolved value actually in
          use (saved value, else .env, else built-in default).
        </p>
      </div>

      <form onSubmit={save} className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:p-5">
        <Section title="Business">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">{f.label}</span>
                <input
                  type="text"
                  value={String(settings[f.key] ?? "")}
                  onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
        </Section>

        <Section title="Pay per status (% of daily wage)" hint="Holidays and week offs always pay in full; these rules drive the salary and payroll estimates.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {PAY_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">{f.label}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={settings[f.key] ?? 0}
                  onChange={(e) => setPay(f.key, e.target.value)}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
        </Section>

        <Section title="Notifications">
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#2563EB]"
              checked={Boolean(settings.smsEnabled)}
              onChange={(e) => setSettings({ ...settings, smsEnabled: e.target.checked })}
            />
            SMS notifications enabled
          </label>
        </Section>

        {/* ── Connectors (HAG-23: the zero-config in-app surface) ─────────── */}
        <Section
          title="Kitchen printer (KOT auto-print)"
          hint="The exact printer name the OS print driver sees (e.g. “HP Smart Tank 580-590 series PCL-3 (V4)” or “kitchen”). Leave blank to use the .env value."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">KOT printer name</span>
              <input
                type="text"
                value={String(settings.kotPrinterName ?? "")}
                onChange={(e) => setSettings({ ...settings, kotPrinterName: e.target.value })}
                className={inputCls}
                placeholder="kitchen"
              />
            </label>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#2563EB]"
                  checked={settings.autoPrintEnabled !== false}
                  onChange={(e) => setSettings({ ...settings, autoPrintEnabled: e.target.checked })}
                />
                Auto-print KOTs when orders are created
              </label>
            </div>
          </div>
        </Section>

        <Section
          title="WhatsApp / Wasachiva gateway"
          hint="Delivery of invoices, booking confirmations and cancellations. Save, then use “Test connection” to check the gateway + key (it exercises the failure breaker and never sends a message)."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Gateway URL</span>
              <input
                type="url"
                value={String(settings.whatsappGatewayUrl ?? "")}
                onChange={(e) => setSettings({ ...settings, whatsappGatewayUrl: e.target.value })}
                className={inputCls}
                placeholder="https://wasend.sachiva.cloud"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">API key</span>
              <input
                type="password"
                autoComplete="off"
                value={String(settings.whatsappApiKey ?? "")}
                onChange={(e) => setSettings({ ...settings, whatsappApiKey: e.target.value })}
                className={inputCls}
                placeholder="wsk_…"
              />
              <span className="mt-1 block text-[12px] text-slate-400">{keyHint}</span>
            </label>
          </div>
        </Section>

        <Section
          title="Attendance (ZK auto-sync)"
          hint="How often the backend polls active ZK devices for punches. The machines themselves (IP, port, credentials) are managed on the ZK attendance screen."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Interval (minutes)</span>
              <input
                type="number"
                min="1"
                max="1440"
                value={settings.zkAutoSyncIntervalMinutes ?? 15}
                onChange={(e) =>
                  setSettings({ ...settings, zkAutoSyncIntervalMinutes: e.target.value === "" ? "" : e.target.valueAsNumber })
                }
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Look-back window (hours)</span>
              <input
                type="number"
                min="1"
                max="168"
                value={settings.zkAutoSyncWindowHours ?? 4}
                onChange={(e) =>
                  setSettings({ ...settings, zkAutoSyncWindowHours: e.target.value === "" ? "" : e.target.valueAsNumber })
                }
                className={inputCls}
              />
            </label>
            <div className="flex items-end pb-1">
              <a
                href="/zk-attendance"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-[14px] font-bold text-slate-700 transition-all duration-200 hover:bg-slate-50"
              >
                Manage machines →
              </a>
            </div>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#2563EB]"
              checked={!settings.zkAutoSyncDisabled}
              onChange={(e) => setSettings({ ...settings, zkAutoSyncDisabled: !e.target.checked })}
            />
            Auto-sync enabled
          </label>
        </Section>

        <Section
          title="Public base URL"
          hint="Where invoice PDFs / attachments are linked from (the publicly reachable origin on this host, e.g. an ngrok URL or your reverse-proxy https:// origin). Blank = default (localhost)."
        >
          <input
            type="url"
            value={String(settings.publicBaseUrl ?? "")}
            onChange={(e) => setSettings({ ...settings, publicBaseUrl: e.target.value })}
            className={inputCls}
            placeholder="https://your-resort.example"
          />
        </Section>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <button
            type="submit"
            disabled={busy !== ""}
            className="inline-flex items-center rounded-xl bg-[#2563eb] px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] transition-all duration-200 hover:bg-[#1d4ed8] disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            onClick={testConnection}
            disabled={busy !== ""}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-[14px] font-bold text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "test" ? "Testing…" : "Test WhatsApp connection"}
          </button>
          {msg && <span className="text-[14px] font-semibold text-emerald-600">{msg}</span>}
          {err && <span className="text-[14px] font-semibold text-red-600">{err}</span>}
        </div>
        {connBanner()}
      </form>
    </div>
  );
};

export default Settings;
