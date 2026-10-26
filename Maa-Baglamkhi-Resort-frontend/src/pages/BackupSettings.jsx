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

  const field = (key) => (
    <input
      type={key === "destDir" || key === "customCron" || key === "dailyTime" ? "text" : key === "weeklyDay" ? "number" : "text"}
      value={settings ? String(settings[key] ?? "") : ""}
      min={key === "weeklyDay" ? 0 : undefined}
      max={key === "weeklyDay" ? 6 : undefined}
      onChange={(e) => setSettings({ ...settings, [key]: key === "weeklyDay" ? e.target.valueAsNumber : e.target.value })}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
    />
  );

  if (!settings) {
    return (
      <div className="p-6 text-sm text-slate-500">
        Loading…
        {err && <div className="mt-2 text-rose-600">{err}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-bold text-slate-800">Backup &amp; Restore</h1>
      <p className="mt-1 text-sm text-slate-500">
        Database backups are full mysqldump files written to the destination folder below. A
        pre-restore safety copy is written before every restore.
      </p>

      <form onSubmit={save} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Schedule</span>
            <select
              value={settings.scheduleType}
              onChange={(e) => setSettings({ ...settings, scheduleType: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
            >
              {SCHEDULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Time (HH:MM, daily &amp; weekly)</span>
            {field("dailyTime")}
          </label>
          {settings.scheduleType === "weekly" && (
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Weekday</span>
              <select
                value={settings.weeklyDay}
                onChange={(e) => setSettings({ ...settings, weeklyDay: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
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
            <label className="col-span-2 text-sm">
              <span className="mb-1 block font-semibold text-slate-700">
                Custom cron (minute hour, * or */N steps; e.g. "0 */6 * * *")
              </span>
              {field("customCron")}
            </label>
          )}
          <label className="col-span-2 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Destination folder (absolute server path)</span>
            {field("destDir")}
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(settings.enabled)}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />
          Scheduler enabled
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy !== ""}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            onClick={runNow}
            disabled={busy !== ""}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "run" ? "Running…" : "Run backup now"}
          </button>
        </div>
      </form>

      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-700">Last run</div>
        <div className="mt-1 text-sm text-slate-500">
          {settings.lastRunAt ? `${settings.lastRunAt} — ${settings.lastRunStatus || "unknown"} — ${settings.lastFile || "no file"}` : "No backup has run yet."}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-slate-700">Backup files</div>
        {files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-400">
            No backup files yet — run a backup to create one.
          </div>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Modified</th>
                <th className="px-3 py-2 text-right">Restore</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{f.name}</td>
                  <td className="px-3 py-2">{fmtBytes(f.sizeBytes)}</td>
                  <td className="px-3 py-2">{new Date(f.mtimeISO).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => restore(f.name)}
                      disabled={busy !== ""}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      {busy.startsWith("restore:") ? "Restoring…" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {msg && <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}
      {err && <div className="mt-4 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
    </div>
  );
};

export default BackupSettings;
