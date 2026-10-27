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

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const res = await API.get("/settings");
      setSettings(res.data);
    } catch (e) {
      setErr(e.response?.data?.message || e.message || "Failed to load settings");
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
      setMsg("Settings saved.");
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.message || "Failed to save settings");
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

  if (!settings) {
    return (
      <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7">
        <div className="text-[14px] font-medium text-slate-500">Loading settings…</div>
        {err && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700">{err}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7 transition-all duration-300">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
        <h2 className="m-0 text-[22px] font-bold leading-tight text-[#1f2a44] sm:text-[26px]">
          <span className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-blue-600 sm:text-[13px]">
            Settings
          </span>
          General &amp; Pay Rules
        </h2>
        <p className="m-0 text-[14px] leading-relaxed text-slate-500">
          Pay percentages are a share of the full daily wage per attendance status. Holidays and week
          offs always pay in full; these rules drive the salary and payroll estimates.
        </p>
      </div>

      <form onSubmit={save} className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:p-5">
        <div>
          <div className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Business</div>
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
        </div>

        <div>
          <div className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Pay per status (% of daily wage)</div>
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
        </div>

        <div>
          <div className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Notifications</div>
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#2563EB]"
              checked={Boolean(settings.smsEnabled)}
              onChange={(e) => setSettings({ ...settings, smsEnabled: e.target.checked })}
            />
            SMS notifications enabled
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy !== ""}
            className="inline-flex items-center rounded-xl bg-[#2563eb] px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] transition-all duration-200 hover:bg-[#1d4ed8] disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
          {msg && <span className="text-[14px] font-semibold text-emerald-600">{msg}</span>}
          {err && <span className="text-[14px] font-semibold text-red-600">{err}</span>}
        </div>
      </form>
    </div>
  );
};

export default Settings;
