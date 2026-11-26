import { useEffect, useState } from "react";
import { FaCheckCircle, FaSave, FaSlidersH, FaSpinner } from "react-icons/fa";

import API from "../../api";

/**
 * Housekeeping parameters dialog (HAG-12, gap 2).
 *
 * Wires both gap routes as one read/save pair:
 *   GET  /api/housekeeping/parameters -> current values
 *   POST /api/housekeeping/parameters -> save
 *
 * Rendered inside a page as <HousekeepingParameters />; it manages its own
 * fetch so it can live in any admin/manager-gated screen.
 */
const HousekeepingParameters = () => {
  const input =
    "w-full rounded-[14px] border border-amber-200 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100";
  const label =
    "mb-1.5 block text-[12px] font-bold uppercase tracking-[0.08em] text-slate-500";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [params, setParams] = useState({
    cleaning_time_minutes: "",
    max_rooms_per_housekeeper: "",
    shift_start_time: "",
    shift_end_time: "",
    auto_release_enabled: false,
    inspection_required: false,
    default_assignee: "",
  });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await API.get("/housekeeping/parameters");
        if (!live) return;
        const row = res.data || {};
        setParams({
          cleaning_time_minutes: row.cleaning_time_minutes ?? "",
          max_rooms_per_housekeeper: row.max_rooms_per_housekeeper ?? "",
          shift_start_time: row.shift_start_time ?? "",
          shift_end_time: row.shift_end_time ?? "",
          auto_release_enabled: Boolean(row.auto_release_enabled ?? row.autoReleaseEnabled),
          inspection_required: Boolean(row.inspection_required ?? row.inspectionRequired),
          default_assignee: row.default_assignee ?? row.defaultAssignee ?? "",
        });
      } catch (err) {
        if (!live) return;
        console.error("Failed to load housekeeping parameters:", err);
        setError("Could not load housekeeping parameters.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const set = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setParams((p) => ({ ...p, [key]: value }));
    setSaved("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await API.post("/housekeeping/parameters", {
        cleaningTimeMinutes: params.cleaning_time_minutes === "" ? null : Number(params.cleaning_time_minutes),
        maxRoomsPerHousekeeper:
          params.max_rooms_per_housekeeper === "" ? null : Number(params.max_rooms_per_housekeeper),
        shiftStartTime: params.shift_start_time || null,
        shiftEndTime: params.shift_end_time || null,
        autoReleaseEnabled: params.auto_release_enabled,
        inspectionRequired: params.inspection_required,
        defaultAssignee: params.default_assignee || null,
      });
      setSaved("Parameters saved.");
    } catch (err) {
      console.error("Failed to save housekeeping parameters:", err);
      setError(err.response?.data?.message || "Failed to save parameters.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[22px] border border-amber-200/80 bg-gradient-to-br from-amber-50/80 to-white p-5 shadow-[0_8px_24px_-8px_rgba(245,158,11,0.16)] sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <FaSlidersH />
        </span>
        <div>
          <h3 className="text-[19px] font-extrabold text-slate-900">Housekeeping Parameters</h3>
          <p className="text-[13px] font-semibold text-slate-500">
            Cleaning windows, shift times and auto-release rules.
          </p>
        </div>
        {saved && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[12px] font-bold text-emerald-700">
            <FaCheckCircle /> {saved}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] font-bold text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <FaSpinner className="animate-spin text-amber-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={label}>Cleaning time (min)</label>
              <input
                type="number"
                min="0"
                className={input}
                value={params.cleaning_time_minutes}
                onChange={set("cleaning_time_minutes")}
              />
            </div>
            <div>
              <label className={label}>Max rooms / housekeeper</label>
              <input
                type="number"
                min="0"
                className={input}
                value={params.max_rooms_per_housekeeper}
                onChange={set("max_rooms_per_housekeeper")}
              />
            </div>
            <div>
              <label className={label}>Shift start</label>
              <input
                type="time"
                className={input}
                value={params.shift_start_time}
                onChange={set("shift_start_time")}
              />
            </div>
            <div>
              <label className={label}>Shift end</label>
              <input
                type="time"
                className={input}
                value={params.shift_end_time}
                onChange={set("shift_end_time")}
              />
            </div>
            <div>
              <label className={label}>Default assignee</label>
              <input
                className={input}
                value={params.default_assignee}
                onChange={set("default_assignee")}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-amber-200 bg-white px-3.5 py-2.5">
              <input
                type="checkbox"
                className="h-5 w-5 accent-amber-600"
                checked={params.auto_release_enabled}
                onChange={set("auto_release_enabled")}
              />
              <span className="text-[14px] font-bold text-slate-700">Auto-release rooms</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-amber-200 bg-white px-3.5 py-2.5 sm:col-span-2 lg:col-span-1">
              <input
                type="checkbox"
                className="h-5 w-5 accent-amber-600"
                checked={params.inspection_required}
                onChange={set("inspection_required")}
              />
              <span className="text-[14px] font-bold text-slate-700">Inspection required</span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-2.5 text-[15px] font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <FaSpinner className="animate-spin" /> : <FaSave />}
              Save Parameters
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default HousekeepingParameters;
