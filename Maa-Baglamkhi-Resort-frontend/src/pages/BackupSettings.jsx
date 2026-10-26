import React, { useEffect, useState } from "react";
import API from "../api";

const SCHEDULE_TYPES = [
  { value: "none", label: "Disabled" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom (cron)" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const fmtBytes = (n) => {
  if (!Number.isFinite(Number(n))) return "--";
  const v = Number(n);
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
};

const BackupSettings = () => {
  const [settings, setSettings] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [s, l] = await Promise.all([API.get("/backups/settings"), API.get("/backups/list")]);
      setSettings(s.data);
      setFiles(l.data?.files || []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || "Failed to load backup settings");
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
      const res = await API.put("/backups/settings", settings);
      setSettings(res.data.settings);
      setMsg("Backup settings saved.");
    } catch (e2) {
      setErr(e2.response?.data?.error || e2.message || "Failed to save settings");
    } finally {
      setBusy("");
    }
  };

  const runNow = async () => {
    setBusy("run");
    setMsg("");
    setErr("");
    try {
      const res = await API.post("/backups/run", {});
      setMsg(`Backup written: ${res.data.file} (${fmtBytes(res.data.sizeBytes)})`);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || "Backup failed");
      load();
    } finally {
      setBusy("");
    }
  };

  const restore = async (file) => {
    setBusy(`restore:${file}`);
    setMsg("");
    setErr("");
    try {
      const res = await API.post("/backups/restore", { file }, { timeout: 300000 });
      setMsg(`Restored ${file}. Safety copy: ${res.data.safetyFile}`);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || "Restore failed");
    } finally {
      setBusy("");
    }
  };

  const inputCls =
    "w-full rounded-[12px] border border-[#DCE6FB] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#0F1E3D] outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10";
  const selectCls =
    "w-full cursor-pointer rounded-[12px] border border-[#DCE6FB] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#0F1E3D] outline-none transition-all duration-200 focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10";

  const field = (key) => (
    <input
      type={key === "destDir" || key === "customCron" || key === "dailyTime" ? "text" : key === "weeklyDay" ? "number" : "text"}
      value={settings ? String(settings[key] ?? "") : ""}
      min={key === "weeklyDay" ? 0 : undefined}
      max={key === "weeklyDay" ? 6 : undefined}
      onChange={(e) => setSettings({ ...settings, [key]: key === "weeklyDay" ? e.target.valueAsNumber : e.target.value })}
      className={inputCls}
    />
  );

  if (!settings) {
    return (
      <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7">
        <div className="text-[14px] font-medium text-slate-500">Loading backup settings…</div>
        {err && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700">{err}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 md:p-7 transition-all duration-300">
      {/* Page header */}
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
        <h2 className="m-0 text-[22px] font-bold leading-tight text-[#1f2a44] sm:text-[26px]">
          <span className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-blue-600 sm:text-[13px]">
            Settings
          </span>
          Backup &amp; Restore
        </h2>
        <p className="m-0 text-[14px] leading-relaxed text-slate-500">
          Database backups are full mysqldump files written to the destination folder below. A
          pre-restore safety copy is written before every restore.
        </p>
      </div>

      <form onSubmit={save} className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Schedule</span>
            <select
              value={settings.scheduleType}
              onChange={(e) => setSettings({ ...settings, scheduleType: e.target.value })}
              className={selectCls}
            >
              {SCHEDULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Time (HH:MM, daily &amp; weekly)</span>
            {field("dailyTime")}
          </label>
          {settings.scheduleType === "weekly" && (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Weekday</span>
              <select
                value={settings.weeklyDay}
                onChange={(e) => setSettings({ ...settings, weeklyDay: Number(e.target.value) })}
                className={selectCls}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {settings.scheduleType === "custom" && (
            <label className="col-span-full block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">
                Custom cron (minute hour, * or */N steps; e.g. "0 */6 * * *")
              </span>
              {field("customCron")}
            </label>
          )}
          <label className="col-span-full block">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">Destination folder (absolute server path)</span>
            {field("destDir")}
          </label>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#2563EB]"
            checked={Boolean(settings.enabled)}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />
          Scheduler enabled
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy !== ""}
            className="inline-flex items-center rounded-xl bg-[#2563eb] px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] transition-all duration-200 hover:bg-[#1d4ed8] disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            onClick={runNow}
            disabled={busy !== ""}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-[14px] font-bold text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "run" ? "Running…" : "Run backup now"}
          </button>
        </div>
      </form>

      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Last run</div>
        <div className="mt-1.5 text-[14px] font-medium text-slate-700">
          {settings.lastRunAt ? `${settings.lastRunAt} — ${settings.lastRunStatus || "unknown"} — ${settings.lastFile || "no file"}` : "No backup has run yet."}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500 sm:px-5">
          Backup files
        </div>
        {files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-[14px] text-slate-400">
            No backup files yet — run a backup to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[14px]">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.06em] text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">File</th>
                  <th className="px-4 py-2.5">Size</th>
                  <th className="px-4 py-2.5">Modified</th>
                  <th className="px-4 py-2.5 text-right">Restore</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-mono text-[13px]" title={f.name}>
                      <span className="block max-w-[320px] truncate">{f.name}</span>
                    </td>
                    <td className="px-4 py-2.5">{fmtBytes(f.sizeBytes)}</td>
                    <td className="px-4 py-2.5">{new Date(f.mtimeISO).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => restore(f.name)}
                        disabled={busy !== ""}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                      >
                        {busy.startsWith("restore:") ? "Restoring…" : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {msg && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[14px] font-medium text-emerald-700">{msg}</div>}
      {err && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[14px] font-medium text-red-700">{err}</div>}
    </div>
  );
};

export default BackupSettings;
