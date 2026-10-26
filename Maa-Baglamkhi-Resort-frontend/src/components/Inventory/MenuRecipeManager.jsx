import React, { useEffect, useMemo, useState } from "react";
import {
  fetchConsumptionLog,
  fetchRecipeCatalogue,
  fetchRecipeForMenuItem,
  fetchRecipeInventoryItems,
  fetchRecipeMenuItems,
  previewRecipeConsumption,
  saveRecipe,
} from "../../services/menuRecipeService";

const createEmptyRow = () => ({
  inventoryItemId: "",
  quantity: "",
  unit: "",
  wastagePercent: "0",
  isOptional: false,
  notes: "",
});

const formatNumber = (value, digits = 3) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toFixed(digits).replace(/\.?0+$/, "");
};

export default function MenuRecipeManager() {
  const [menuItems, setMenuItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [consumptionLog, setConsumptionLog] = useState([]);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState("");
  const [recipeRows, setRecipeRows] = useState([createEmptyRow()]);
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [previewRows, setPreviewRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadBaseData = async (preferredMenuItemId = null) => {
    setLoading(true);
    setError("");

    try {
      const [menuResponse, inventoryResponse, catalogueResponse, logResponse] = await Promise.all([
        fetchRecipeMenuItems(),
        fetchRecipeInventoryItems(),
        fetchRecipeCatalogue(),
        fetchConsumptionLog(10),
      ]);

      setMenuItems(menuResponse);
      setInventoryItems(inventoryResponse);
      setCatalogue(catalogueResponse);
      setConsumptionLog(logResponse);

      const fallbackMenuId = String(
        preferredMenuItemId ||
          menuResponse[0]?.id ||
          catalogueResponse[0]?.menuItemId ||
          "",
      );
      setSelectedMenuItemId((current) => current || fallbackMenuId);
    } catch (err) {
      setError(err.response?.data?.message || "Menu recipe module could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const loadRecipe = async (menuItemId) => {
    if (!menuItemId) {
      setRecipeRows([createEmptyRow()]);
      setPreviewRows([]);
      return;
    }

    try {
      setError("");
      const rows = await fetchRecipeForMenuItem(menuItemId);
      setRecipeRows(
        rows.length
          ? rows.map((row) => ({
              id: row.id,
              inventoryItemId: String(row.inventoryItemId || ""),
              quantity: String(row.quantity ?? ""),
              unit: row.unit || row.inventoryUnit || "",
              wastagePercent: String(row.wastagePercent ?? 0),
              isOptional: Boolean(row.isOptional),
              notes: row.notes || "",
              inventoryItemName: row.inventoryItemName || "",
              currentStock: row.currentStock,
            }))
          : [createEmptyRow()],
      );
      setPreviewRows([]);
    } catch (err) {
      setError(err.response?.data?.message || "Recipe rows could not be loaded.");
      setRecipeRows([createEmptyRow()]);
    }
  };

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    if (!selectedMenuItemId) return;
    loadRecipe(selectedMenuItemId);
  }, [selectedMenuItemId]);

  const selectedMenuItem = useMemo(
    () => menuItems.find((item) => String(item.id) === String(selectedMenuItemId)) || null,
    [menuItems, selectedMenuItemId],
  );

  const recipeCountsByMenuItem = useMemo(
    () =>
      catalogue.reduce((acc, row) => {
        const key = String(row.menuItemId || "");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [catalogue],
  );

  const inventoryById = useMemo(
    () =>
      inventoryItems.reduce((acc, item) => {
        acc[String(item.id)] = item;
        return acc;
      }, {}),
    [inventoryItems],
  );

  const handleRowChange = (index, key, value) => {
    setRecipeRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (key === "inventoryItemId") {
          const selectedInventory = inventoryById[String(value)];
          return {
            ...row,
            inventoryItemId: value,
            unit: row.unit || selectedInventory?.unit || "",
            inventoryItemName: selectedInventory?.name || row.inventoryItemName,
          };
        }
        return { ...row, [key]: value };
      }),
    );
  };

  const addRecipeRow = () => {
    setRecipeRows((current) => [...current, createEmptyRow()]);
  };

  const removeRecipeRow = (index) => {
    setRecipeRows((current) => {
      if (current.length === 1) return [createEmptyRow()];
      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const handleSave = async () => {
    if (!selectedMenuItemId) {
      setError("Menu item select karo.");
      return;
    }

    const payload = recipeRows
      .map((row, index) => ({
        inventoryItemId: Number(row.inventoryItemId || 0),
        quantity: Number(row.quantity || 0),
        unit: String(row.unit || "").trim(),
        wastagePercent: Number(row.wastagePercent || 0),
        isOptional: Boolean(row.isOptional),
        notes: String(row.notes || "").trim(),
        sortOrder: index,
      }))
      .filter((row) => row.inventoryItemId > 0 && row.quantity > 0);

    if (!payload.length) {
      setError("Kam se kam ek valid ingredient row add karo.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await saveRecipe(selectedMenuItemId, payload);
      await Promise.all([loadRecipe(selectedMenuItemId), loadBaseData(selectedMenuItemId)]);
      setNotice("Recipe save ho gayi.");
    } catch (err) {
      setError(err.response?.data?.message || "Recipe could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedMenuItemId) {
      setError("Preview ke liye menu item select karo.");
      return;
    }

    setPreviewLoading(true);
    setError("");

    try {
      const rows = await previewRecipeConsumption({
        menuItemId: Number(selectedMenuItemId),
        orderQuantity: Number(orderQuantity || 0),
      });
      setPreviewRows(rows);
    } catch (err) {
      setError(err.response?.data?.message || "Consumption preview nahi bana.");
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const cardCls =
    "rounded-[20px] border border-[#E7EEFC] bg-white shadow-[0_18px_40px_-16px_rgba(11,30,77,0.18)]";
  const headingCls = "text-[19px] sm:text-[21px] font-bold text-[#0B1E4D] m-0";
  const subCls = "mt-1 text-[13.5px] sm:text-[14.5px] text-[#5B6B8C] m-0";
  const fieldLabelCls =
    "mb-1.5 block text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.04em] text-[#5B6B8C]";
  const inputCls =
    "w-full rounded-[14px] border border-[#DCE6FB] bg-white px-3.5 py-2.5 text-[14px] sm:text-[15px] font-medium text-[#0F1E3D] shadow-[0_1px_2px_rgba(15,27,51,0.04)] outline-none transition-all duration-250 focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/12";
  const primaryBtnCls =
    "inline-flex items-center justify-center gap-2 rounded-[14px] px-5 py-3 text-[14px] sm:text-[15px] font-semibold text-white transition-all duration-250 active:scale-[0.97] disabled:opacity-60";
  const primaryBtnStyle = { backgroundImage: "linear-gradient(135deg,#1D4ED8 0%,#2563EB 55%,#38BDF8 100%)" };
  const ghostBtnCls =
    "inline-flex items-center justify-center gap-2 rounded-[14px] border border-[#DCE6FB] bg-white px-5 py-3 text-[14px] sm:text-[15px] font-semibold text-[#33456B] transition-all duration-250 hover:bg-[#F0F5FF] hover:border-[#B9CDF7] disabled:opacity-60";

  if (loading) {
    return (
      <div className={`${cardCls} p-6 text-[14px] sm:text-[15px] text-[#5B6B8C]`}>
        Loading menu recipe module...
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className={`${cardCls} p-5 sm:p-6`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className={headingCls}>Menu Recipe Manager</h2>
            <p className={subCls}>
              Inventory ingredients ko menu items ke saath map karke per-order consumption preview kar sakte hain.
            </p>
          </div>

          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[minmax(260px,1fr)_120px]">
            <label className="block">
              <span className={fieldLabelCls}>
                Menu Item
              </span>
              <select
                value={selectedMenuItemId}
                onChange={(event) => setSelectedMenuItemId(event.target.value)}
                className={inputCls}
              >
                <option value="">Select menu item</option>
                {menuItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} {item.category ? `(${item.category})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={fieldLabelCls}>
                Order Qty
              </span>
              <input
                type="number"
                min="1"
                value={orderQuantity}
                onChange={(event) => setOrderQuantity(event.target.value)}
                className={inputCls}
              />
            </label>
          </div>
        </div>

        {selectedMenuItem ? (
          <div className="mt-4 flex flex-wrap gap-2.5 text-[13px] sm:text-[14px] text-[#33456B]">
            <span className="rounded-full border border-[#CFE0FC] bg-[#EAF2FE] px-3.5 py-1.5 font-semibold text-[#1D4ED8]">
              Category: {selectedMenuItem.category || "Uncategorized"}
            </span>
            <span className="rounded-full border border-[#CFE0FC] bg-[#EAF2FE] px-3.5 py-1.5 font-semibold text-[#1D4ED8]">
              Price: Rs. {formatNumber(selectedMenuItem.price, 2)}
            </span>
            <span className="rounded-full border border-[#CFE0FC] bg-[#EAF2FE] px-3.5 py-1.5 font-semibold text-[#1D4ED8]">
              Status: {selectedMenuItem.status || "Available"}
            </span>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] font-medium text-emerald-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1.4fr)_380px]">
        <div className="space-y-5 sm:space-y-6">
          <div className={`${cardCls} p-5 sm:p-6`}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className={headingCls}>Recipe Rows</h3>
                <p className={subCls}>
                  Quantity per serving define karo. Save karne par puri recipe replace hogi.
                </p>
              </div>

              <button
                type="button"
                onClick={addRecipeRow}
                className={ghostBtnCls}
              >
                Add Row
              </button>
            </div>

            <div className="space-y-4">
              {recipeRows.map((row, index) => {
                const linkedInventory = inventoryById[String(row.inventoryItemId)];

                return (
                  <div
                    key={`${row.id || "new"}-${index}`}
                    className="rounded-[16px] border border-[#EEF3FD] bg-[#F8FAFE] p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(180px,1.5fr)_110px_110px_120px]">
                      <label>
                        <span className={fieldLabelCls}>
                          Ingredient
                        </span>
                        <select
                          value={row.inventoryItemId}
                          onChange={(event) =>
                            handleRowChange(index, "inventoryItemId", event.target.value)
                          }
                          className={inputCls}
                        >
                          <option value="">Select ingredient</option>
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({formatNumber(item.stock)} {item.unit || "unit"})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span className={fieldLabelCls}>
                          Quantity
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={row.quantity}
                          onChange={(event) => handleRowChange(index, "quantity", event.target.value)}
                          className={inputCls}
                        />
                      </label>

                      <label>
                        <span className={fieldLabelCls}>
                          Unit
                        </span>
                        <input
                          type="text"
                          value={row.unit}
                          onChange={(event) => handleRowChange(index, "unit", event.target.value)}
                          className={inputCls}
                        />
                      </label>

                      <label>
                        <span className={fieldLabelCls}>
                          Wastage %
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={row.wastagePercent}
                          onChange={(event) =>
                            handleRowChange(index, "wastagePercent", event.target.value)
                          }
                          className={inputCls}
                        />
                      </label>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                      <label>
                        <span className={fieldLabelCls}>
                          Notes
                        </span>
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(event) => handleRowChange(index, "notes", event.target.value)}
                          className={inputCls}
                          placeholder="Optional prep note"
                        />
                      </label>

                      <label className="flex items-end gap-2 rounded-[14px] border border-[#DCE6FB] bg-white px-4 py-3">
                        <input
                          type="checkbox"
                          checked={row.isOptional}
                          onChange={(event) =>
                            handleRowChange(index, "isOptional", event.target.checked)
                          }
                          className="accent-[#1D4ED8]"
                        />
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-[#33456B]">Optional item</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => removeRecipeRow(index)}
                        className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] sm:text-[13.5px] font-semibold text-red-600 transition-all duration-250 hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>

                    {linkedInventory ? (
                      <div className="mt-3 text-[12px] sm:text-[13px] text-[#5B6B8C]">
                        Current stock: {formatNumber(linkedInventory.stock)} {linkedInventory.unit || row.unit || "unit"}
                        {linkedInventory.branch ? ` | Branch: ${linkedInventory.branch}` : ""}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={primaryBtnCls}
                style={primaryBtnStyle}
              >
                {saving ? "Saving..." : "Save Recipe"}
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewLoading}
                className={ghostBtnCls}
              >
                {previewLoading ? "Previewing..." : "Preview Consumption"}
              </button>
            </div>
          </div>

          <div className={`${cardCls} p-5 sm:p-6`}>
            <div className="mb-4">
              <h3 className={headingCls}>Consumption Preview</h3>
              <p className={subCls}>
                Selected order quantity ke hisaab se kitna stock consume hoga.
              </p>
            </div>

            {!previewRows.length ? (
              <div className="rounded-[14px] border border-dashed border-[#B9CDF7] bg-[#F5F9FF] px-4 py-8 text-center text-[13.5px] sm:text-[14.5px] text-[#8B98B8]">
                Preview run karne par stock impact yahan dikhega.
              </div>
            ) : (
              <div className="space-y-3">
                {previewRows.map((row) => (
                  <div
                    key={`${row.recipeRowId}-${row.inventoryItemId}`}
                    className="rounded-[16px] border border-[#EEF3FD] bg-[#F8FAFE] p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-[14px] sm:text-[15px] font-bold text-[#0B1E4D]">{row.inventoryItemName}</div>
                        <div className="mt-1 text-[12px] sm:text-[13px] text-[#5B6B8C]">
                          Required {formatNumber(row.requiredQuantity)} {row.unit || "unit"} | Current{" "}
                          {formatNumber(row.currentStock)} {row.unit || "unit"}
                        </div>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-[12px] sm:text-[13px] font-bold ${
                          row.enoughStock
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {row.enoughStock ? "Enough stock" : "Low stock"}
                      </div>
                    </div>
                    <div className="mt-2 text-[12px] sm:text-[13px] text-[#5B6B8C]">
                      Remaining after use: {formatNumber(row.remainingStock)} {row.unit || "unit"}
                      {row.notes ? ` | ${row.notes}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <div className={`${cardCls} p-5 sm:p-6`}>
            <div className="mb-4">
              <h3 className={headingCls}>Recipe Catalogue</h3>
              <p className={subCls}>
                Existing saved recipes ka quick overview.
              </p>
            </div>

            <div className="space-y-3">
              {menuItems.length ? (
                menuItems.map((item) => {
                  const rowCount = recipeCountsByMenuItem[String(item.id)] || 0;
                  const isSelected = String(item.id) === String(selectedMenuItemId);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedMenuItemId(String(item.id))}
                      className={`flex w-full items-center justify-between rounded-[16px] border px-4 py-3 text-left transition-all duration-200 ${
                        isSelected
                          ? "border-transparent text-white shadow-[0_10px_24px_-8px_rgba(29,78,216,0.55)]"
                          : "border-[#E7EEFC] bg-[#F8FAFE] text-[#33456B] hover:border-[#B9CDF7] hover:bg-[#F0F5FF]"
                      }`}
                      style={isSelected ? { backgroundImage: "linear-gradient(135deg,#1D4ED8 0%,#2563EB 55%,#38BDF8 100%)" } : undefined}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[14px] sm:text-[15px] font-bold">{item.name}</div>
                        <div className={`mt-1 text-[12px] sm:text-[13px] ${isSelected ? "text-white/80" : "text-[#5B6B8C]"}`}>
                          {item.category || "Uncategorized"}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 rounded-full px-3 py-1 text-[12px] sm:text-[13px] font-bold ${
                          isSelected ? "bg-white/20 text-white" : "bg-white text-[#1D4ED8] ring-1 ring-[#CFE0FC]"
                        }`}
                      >
                        {rowCount} rows
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-[#B9CDF7] bg-[#F5F9FF] px-4 py-8 text-center text-[13.5px] sm:text-[14.5px] text-[#8B98B8]">
                  No menu items found.
                </div>
              )}
            </div>
          </div>

          <div className={`${cardCls} p-5 sm:p-6`}>
            <div className="mb-4">
              <h3 className={headingCls}>Recent Consumption</h3>
              <p className={subCls}>
                Last 10 inventory consumption logs.
              </p>
            </div>

            <div className="space-y-3">
              {consumptionLog.length ? (
                consumptionLog.map((row) => (
                  <div key={row.id} className="rounded-[16px] border border-[#EEF3FD] bg-[#F8FAFE] p-4">
                    <div className="text-[14px] sm:text-[15px] font-bold text-[#0B1E4D]">{row.menuItemName}</div>
                    <div className="mt-1 text-[12px] sm:text-[13px] text-[#5B6B8C]">
                      {row.inventoryItemName} consumed {formatNumber(row.consumedQuantity)} {row.unit || "unit"}
                    </div>
                    <div className="mt-1 text-[12px] sm:text-[13px] text-[#5B6B8C]">
                      Ref: {row.referenceType || "manual"}
                      {row.referenceId ? ` / ${row.referenceId}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[14px] border border-dashed border-[#B9CDF7] bg-[#F5F9FF] px-4 py-8 text-center text-[13.5px] sm:text-[14.5px] text-[#8B98B8]">
                  Consumption log empty hai.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
