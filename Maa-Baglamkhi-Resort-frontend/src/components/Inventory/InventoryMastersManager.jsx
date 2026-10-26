import React, { useEffect, useMemo, useState } from "react";
import {
  createInventoryMasterRecord,
  deleteInventoryMasterRecord,
  fetchInventoryMasterRecords,
  updateInventoryMasterRecord,
} from "../../services/inventoryMastersService";
import {
  buildInitialMasterForm,
  INVENTORY_MASTER_SECTIONS,
} from "./inventoryMastersConfig";

function formatLabel(value) {
  return String(value || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function FieldInput({ field, value, onChange }) {
  const inputCls =
    "w-full rounded-[14px] border border-[#DCE6FB] bg-white px-3.5 py-2.5 text-[14px] sm:text-[15px] font-medium text-[#0F1E3D] shadow-[0_1px_2px_rgba(15,27,51,0.04)] outline-none transition-all duration-250 focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12";
  if (field.type === "select") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={inputCls}
      >
        <option value="">Select {field.label}</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.type || "text"}
      value={value}
      onChange={(e) => onChange(field.key, e.target.value)}
      className={inputCls}
    />
  );
}

export default function InventoryMastersManager() {
  const [activeKey, setActiveKey] = useState(INVENTORY_MASTER_SECTIONS[0].key);
  const [recordsBySection, setRecordsBySection] = useState({});
  const [draft, setDraft] = useState(buildInitialMasterForm(INVENTORY_MASTER_SECTIONS[0].fields));
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeSection = useMemo(
    () => INVENTORY_MASTER_SECTIONS.find((section) => section.key === activeKey),
    [activeKey],
  );

  const loadSection = async (sectionKey) => {
    const rows = await fetchInventoryMasterRecords(sectionKey);
    setRecordsBySection((current) => ({
      ...current,
      [sectionKey]: rows,
    }));
  };

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all(INVENTORY_MASTER_SECTIONS.map((section) => loadSection(section.key)));
      } catch (err) {
        setError(err.response?.data?.message || "Inventory masters could not be loaded.");
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, []);

  useEffect(() => {
    if (!activeSection) return;
    setDraft(buildInitialMasterForm(activeSection.fields));
    setEditingId(null);
    setMessage("");
    setError("");
  }, [activeSection]);

  const records = recordsBySection[activeKey] || [];

  const handleFieldChange = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setDraft(
      activeSection.fields.reduce((acc, field) => {
        acc[field.key] = row[field.key] ?? "";
        return acc;
      }, {}),
    );
  };

  const handleReset = () => {
    setEditingId(null);
    setDraft(buildInitialMasterForm(activeSection.fields));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editingId) {
        await updateInventoryMasterRecord(activeKey, editingId, draft);
        setMessage(`${activeSection.label} updated successfully.`);
      } else {
        await createInventoryMasterRecord(activeKey, draft);
        setMessage(`${activeSection.label} created successfully.`);
      }
      await loadSection(activeKey);
      handleReset();
    } catch (err) {
      setError(err.response?.data?.message || "Could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setError("");
    setMessage("");
    try {
      await deleteInventoryMasterRecord(activeKey, id);
      await loadSection(activeKey);
      if (editingId === id) {
        handleReset();
      }
      setMessage(`${activeSection.label} record deleted.`);
    } catch (err) {
      setError(err.response?.data?.message || "Could not be deleted.");
    }
  };

  if (loading) {
    return (
      <div className="rounded-[20px] border border-[#E7EEFC] bg-white p-6 text-[15px] text-[#5B6B8C] shadow-[0_18px_40px_-16px_rgba(11,30,77,0.18)]">
        Loading inventory masters...
      </div>
    );
  }

  const cardCls =
    "rounded-[20px] border border-[#E7EEFC] bg-white shadow-[0_18px_40px_-16px_rgba(11,30,77,0.18)]";
  const headingCls = "text-[19px] sm:text-[21px] font-bold text-[#0B1E4D] m-0";
  const subCls = "mt-1 text-[13.5px] sm:text-[14.5px] text-[#5B6B8C] m-0";

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className={`${cardCls} p-5 sm:p-6`}>
        <h2 className={headingCls}>Inventory Masters Manager</h2>
        <p className={subCls}>
          Ye standalone module inventory ke sab local-only master sections ko backend ke saath manage karne ke liye ready hai.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {INVENTORY_MASTER_SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => setActiveKey(section.key)}
            className={`rounded-full px-4 py-2.5 text-[13.5px] sm:text-[14.5px] font-semibold transition-all duration-250 active:scale-[0.98] ${
              activeKey === section.key
                ? "text-white shadow-[0_10px_24px_-8px_rgba(29,78,216,0.55)]"
                : "border border-[#DCE6FB] bg-white text-[#33456B] hover:bg-[#F0F5FF] hover:border-[#B9CDF7]"
            }`}
            style={activeKey === section.key ? { backgroundImage: "linear-gradient(135deg,#1D4ED8 0%,#2563EB 55%,#38BDF8 100%)" } : undefined}
          >
            {section.label}
          </button>
        ))}
      </div>

      {message ? (
        <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] font-medium text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-[340px,1fr]">
        <div className={`${cardCls} p-5 sm:p-6`}>
          <div className="mb-4 sm:mb-5">
            <h3 className={headingCls}>
              {editingId ? `Edit ${activeSection.label}` : `Add ${activeSection.label}`}
            </h3>
            <p className={subCls}>Backend CRUD ready module</p>
          </div>

          <div className="space-y-4">
            {activeSection.fields.map((field) => (
              <div key={field.key}>
                <label className="mb-1.5 block text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.04em] text-[#5B6B8C]">
                  {field.label} {field.required ? "*" : ""}
                </label>
                <FieldInput
                  field={field}
                  value={draft[field.key] ?? ""}
                  onChange={handleFieldChange}
                />
              </div>
            ))}
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-[14px] px-5 py-3 text-[14px] sm:text-[15px] font-semibold text-white transition-all duration-250 active:scale-[0.97] disabled:opacity-50"
              style={{ backgroundImage: "linear-gradient(135deg,#1D4ED8 0%,#2563EB 55%,#38BDF8 100%)" }}
            >
              {saving ? "Saving..." : editingId ? "Update" : "Save"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-[#DCE6FB] bg-white px-5 py-3 text-[14px] sm:text-[15px] font-semibold text-[#33456B] transition-all duration-250 hover:bg-[#F0F5FF]"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>

        <div className={`${cardCls} p-5 sm:p-6`}>
          <div className="mb-4 sm:mb-5">
            <h3 className={headingCls}>{activeSection.label} Records</h3>
            <p className={subCls}>{records.length} rows loaded from backend.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-[14px] sm:text-[15px]">
              <thead>
                <tr className="border-b border-[#E7EEFC] bg-[#F5F9FF] text-left text-[11.5px] sm:text-[12.5px] font-bold uppercase tracking-[0.06em] text-[#0B1E4D]">
                  {activeSection.columns.map((column) => (
                    <th key={column} className="px-4 py-3">{formatLabel(column)}</th>
                  ))}
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF3FD]">
                {records.length ? records.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-[#F6F9FF]">
                    {activeSection.columns.map((column) => (
                      <td key={column} className="px-4 py-3 text-[#33456B]">
                        {row[column] || "---"}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(row)}
                          className="rounded-[10px] border border-[#BFD6FB] bg-[#EAF2FE] px-3 py-1.5 text-[12px] sm:text-[13px] font-semibold text-[#1D4ED8] transition-all duration-250 hover:bg-[#DCEAFE]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.id)}
                          className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] sm:text-[13px] font-semibold text-red-600 transition-all duration-250 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={activeSection.columns.length + 1} className="px-4 py-12 text-center text-[14px] text-[#8B98B8]">
                      No records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
