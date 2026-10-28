const STATUS_COLORS = {
  Present: "bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-emerald-200",
  Absent: "bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-red-200",
  Late: "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-amber-200",
  "Half Day": "bg-gradient-to-r from-yellow-400 to-amber-500 text-white shadow-amber-200",
  "On Leave": "bg-gradient-to-r from-blue-500 to-sky-600 text-white shadow-blue-200",
  Holiday: "bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white shadow-purple-200",
  "Week Off": "bg-gradient-to-r from-slate-400 to-slate-500 text-white shadow-slate-200",
};

const METHOD_COLORS = {
  Biometric: "bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-violet-200",
  "ZK fingerprint": "bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-teal-200",
  Manual: "bg-gradient-to-r from-slate-500 to-slate-700 text-white shadow-slate-200",
};

// The API stores statuses as "present" / "on_leave" but the UI paints and
// filters by label, so map once here and reuse everywhere in this file.
const STATUS_LABEL = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half Day",
  on_leave: "On Leave",
  holiday: "Holiday",
  week_off: "Week Off",
};

const normalizeLabel = (value) => {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  return STATUS_LABEL[raw.toLowerCase()] || raw;
};

const formatCurrency = (amount) => {
  const n = parseFloat(amount || 0);
  return `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const AttendanceRow = ({ employee, isAdmin = true, onCheckIn, onCheckOut }) => {
  const status = normalizeLabel(employee.statusLabel || employee.status);
  const method = employee.method || null;
  const notes = employee.notes || null;
  const statusClass = STATUS_COLORS[status] || "bg-slate-200 text-slate-700";
  const methodClass = METHOD_COLORS[method] || "bg-slate-200 text-slate-700";
  const colCount = isAdmin ? 8 : 7;

  return (
    <tr
      className="
      group

      block
      md:table-row

      border-b-0
      md:border-b
      border-blue-50/80

      bg-white

      transition-all
      duration-300

      md:hover:bg-blue-50/30
      md:hover:shadow-[0_4px_20px_rgba(37,99,235,0.06)]
    "
    >
      {/* ================= MOBILE CARD (≤767px) ================= */}
      <td colSpan={colCount} className="block md:hidden px-0 py-0 align-top">
        <div
          className="
          mx-1
          my-2

          rounded-[20px]

          border
          border-blue-100

          bg-white

          p-4

          shadow-[0_4px_16px_rgba(30,64,175,0.06)]
        "
        >
          {/* Top: avatar + name/role + status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="
                flex
                h-14
                w-14
                shrink-0
                items-center
                justify-center

                rounded-[14px]

                bg-gradient-to-br
                from-blue-600
                via-sky-500
                to-cyan-400

                text-base
                font-extrabold
                text-white

                shadow-[0_8px_24px_rgba(37,99,235,0.25)]
                ring-4
                ring-blue-50
              "
              >
                {employee.name?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[16px] font-bold leading-tight text-slate-900">
                  {employee.name}
                </h3>
                <p className="mt-0.5 truncate text-[13px] font-medium text-slate-500">
                  {employee.role || "--"}
                </p>
              </div>
            </div>

            <span
              className={`
                inline-flex
                shrink-0
                items-center

                rounded-full

                px-3
                py-1.5

                text-[12px]
                font-bold

                shadow-md

                ${statusClass}
              `}
            >
              {status || "--"}
            </span>
          </div>

          {/* Two-column label/value grid */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            {/* Check In */}
            <div className="min-w-0">
              <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Check In
              </div>
              <div
                className="
                mt-1
                inline-flex
                items-center

                rounded-full

                border
                border-blue-200
                bg-blue-50

                px-3
                py-1.5

                text-[14px]
                font-semibold
                text-blue-700
              "
              >
                {employee.checkIn || "--"}
              </div>
            </div>

            {/* Check Out */}
            <div className="min-w-0">
              <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Check Out
              </div>
              <div
                className="
                mt-1
                inline-flex
                items-center

                rounded-full

                border
                border-slate-200
                bg-slate-50

                px-3
                py-1.5

                text-[14px]
                font-semibold
                text-slate-700
              "
              >
                {employee.checkOut || "--"}
              </div>
            </div>

            {/* Method */}
            <div className="min-w-0">
              <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Method
              </div>
              <span
                className={`
                  mt-1
                  inline-flex
                  items-center

                  rounded-full

                  px-3
                  py-1.5

                  text-[12px]
                  font-bold

                  shadow-sm

                  ${methodClass}
                `}
              >
                {method || "--"}
              </span>
            </div>

            {/* Notes */}
            <div className="min-w-0">
              <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Notes
              </div>
              <div
                className="mt-1 truncate text-[13px] font-medium text-slate-600"
                title={notes}
              >
                {notes || "--"}
              </div>
            </div>

            {/* Daily Salary */}
            <div className="min-w-0">
              <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Daily Salary
              </div>
              <div
                className="
                mt-1
                inline-flex
                items-center

                rounded-full

                border
                border-emerald-200
                bg-emerald-50

                px-3
                py-1.5

                text-[14px]
                font-bold
                text-emerald-700
              "
              >
                {formatCurrency(employee.salary_amount)}
              </div>
              {isAdmin && employee.user_salary > 0 && (
                <div className="mt-1 text-[12px] font-semibold text-slate-500">
                  /mo: {formatCurrency(employee.user_salary)}
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons — equal width, bottom of card */}
          {isAdmin && (
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => onCheckIn && onCheckIn(employee)}
                className="
                flex-1

                rounded-[14px]

                bg-gradient-to-r
                from-blue-600
                via-blue-500
                to-sky-500

                px-4
                py-2.5

                text-[14px]
                font-bold
                text-white

                shadow-[0_10px_28px_rgba(37,99,235,0.28)]

                transition-all
                duration-300

                active:scale-95
              "
              >
                Check In
              </button>

              <button
                type="button"
                onClick={() => onCheckOut && onCheckOut(employee)}
                className="
                flex-1

                rounded-[14px]

                border
                border-red-200
                bg-white

                px-4
                py-2.5

                text-[14px]
                font-bold
                text-red-600

                shadow-md

                transition-all
                duration-300

                active:scale-95
              "
              >
                Check Out
              </button>
            </div>
          )}
        </div>
      </td>

      {/* ================= TABLET / DESKTOP TABLE ROW (≥768px) ================= */}

      {/* Employee */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        <div className="flex items-center gap-3 xl:gap-4">
          {/* Avatar */}
          <div
            className="
            flex
            h-11
            w-11
            xl:h-14
            xl:w-14
            shrink-0
            items-center
            justify-center

            rounded-[11px]
            xl:rounded-[14px]

            bg-gradient-to-br
            from-blue-600
            via-sky-500
            to-cyan-400

            text-base
            xl:text-lg
            font-extrabold
            text-white

            shadow-[0_8px_24px_rgba(37,99,235,0.25)]
            ring-4
            ring-blue-50

            transition-all
            duration-300

            group-hover:scale-105
            group-hover:shadow-[0_12px_32px_rgba(37,99,235,0.30)]
          "
          >
            {employee.name?.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            {/* Employee Name */}
            <h3 className="text-[16px] xl:text-[20px] font-bold text-slate-900 leading-tight truncate">
              {employee.name}
            </h3>
            {/* Employee Role */}
            <p className="mt-0.5 text-[13px] xl:text-[15px] font-medium text-slate-500 truncate">
              {employee.role || "--"}
            </p>
          </div>
        </div>
      </td>

      {/* Check In */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        <div
          className="
          inline-flex
          items-center

          rounded-full

          border
          border-blue-200
          bg-blue-50

          px-3
          py-1.5
          xl:px-4
          xl:py-2

          text-[14px]
          xl:text-[16px]
          font-semibold
          text-blue-700

          shadow-sm
        "
        >
          {employee.checkIn || "--"}
        </div>
      </td>

      {/* Check Out */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        <div
          className="
          inline-flex
          items-center

          rounded-full

          border
          border-slate-200
          bg-slate-50

          px-3
          py-1.5
          xl:px-4
          xl:py-2

          text-[14px]
          xl:text-[16px]
          font-semibold
          text-slate-700

          shadow-sm
        "
        >
          {employee.checkOut || "--"}
        </div>
      </td>

      {/* Status */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        <span
          className={`
            inline-flex
            items-center

            rounded-full

            px-3
            py-1.5
            xl:px-4
            xl:py-2

            text-[13px]
            xl:text-[15px]
            font-bold

            shadow-lg

            ${
              statusClass ||
              "bg-slate-200 text-slate-700"
            }
          `}
        >
          {status || "--"}
        </span>
      </td>

      {/* Method */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        <span
          className={`
            inline-flex
            items-center

            rounded-full

            px-3
            py-1.5
            xl:px-4
            xl:py-2

            text-[13px]
            xl:text-[15px]
            font-bold

            shadow-lg

            ${
              methodClass ||
              "bg-slate-200 text-slate-700"
            }
          `}
        >
          {method || "--"}
        </span>
      </td>

      {/* Notes */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        {notes ? (
          <span
            className="block max-w-[220px] truncate text-[12px] xl:text-[13px] font-medium text-slate-500"
            title={notes}
          >
            {notes}
          </span>
        ) : (
          <span className="text-[13px] text-slate-400">--</span>
        )}
      </td>

      {/* Daily Salary */}
      <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
        <div className="inline-flex flex-col items-start">
          <div
            className="
            inline-flex
            items-center

            rounded-full

            border
            border-emerald-200
            bg-emerald-50

            px-3
            py-1.5
            xl:px-4
            xl:py-2

            text-[13px]
            xl:text-[15px]
            font-bold
            text-emerald-700

            shadow-sm
          "
          >
            {formatCurrency(employee.salary_amount)}
          </div>
          {isAdmin && employee.user_salary > 0 && (
            <span className="mt-1.5 text-[12px] xl:text-[13px] font-semibold text-slate-500">
              /mo: {formatCurrency(employee.user_salary)}
            </span>
          )}
        </div>
      </td>

      {/* Action Buttons (admin only) */}
      {isAdmin && (
        <td className="hidden md:table-cell px-4 py-4 xl:px-6 xl:py-5">
          <div className="flex gap-2 xl:gap-3">
            {/* Check In */}
            <button
              type="button"
              onClick={() => onCheckIn && onCheckIn(employee)}
              className="
              rounded-[11px]
              xl:rounded-[14px]

              bg-gradient-to-r
              from-blue-600
              via-blue-500
              to-sky-500

              px-3
              py-2
              xl:px-5
              xl:py-2.5

              text-[13px]
              xl:text-[16px]
              font-bold
              text-white

              shadow-[0_10px_28px_rgba(37,99,235,0.28)]

              transition-all
              duration-300

              hover:-translate-y-1
              hover:scale-105
              hover:shadow-[0_16px_38px_rgba(37,99,235,0.38)]
            "
            >
              Check In
            </button>

            {/* Check Out */}
            <button
              type="button"
              onClick={() => onCheckOut && onCheckOut(employee)}
              className="
              rounded-[11px]
              xl:rounded-[14px]

              border
              border-red-200
              bg-white

              px-3
              py-2
              xl:px-5
              xl:py-2.5

              text-[13px]
              xl:text-[16px]
              font-bold
              text-red-600

              shadow-md

              transition-all
              duration-300

              hover:bg-red-500
              hover:text-white
              hover:-translate-y-1
              hover:scale-105
              hover:border-red-500
              hover:shadow-[0_14px_32px_rgba(239,68,68,0.25)]
            "
            >
              Check Out
            </button>
          </div>
        </td>
      )}
    </tr>
  );
};

export default AttendanceRow;