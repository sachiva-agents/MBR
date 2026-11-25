# HAG-3 — Final E2E smoke test

**Date:** 2026-11-25
**Run by:** harry (harry-mwvxw5o8)
**Verdict:** **GREEN with one minor defect** — all required steps passed.

## Environment

| Component | State | PID / Port |
| --- | --- | --- |
| MariaDB (XAMPP) | started via `C:\xampp\mysql_start.bat` | port 3306 |
| Backend (Express) | `npm start` in `Maa-Baglamkhi-Resort-Backend`, log: `reports/hag3-backend.log` | **PID 30404**, port **5002** |
| Vite (React SPA) | `npm run dev` in `Maa-Baglamkhi-Resort-frontend`, log: `reports/hag3-vite.log` | **PID 30804** (npm shell **16584** spawns node **30804**), port **5173** |

Servers left running for ada as requested.

## Walk-through results

| # | Step | Method | Result |
|---|---|---|---|
| 1 | MariaDB up | TCP 3306 | ✅ reachable after `mysql_start.bat` |
| 2 | Backend healthy | `GET /api/health` | ✅ 200 |
| 3 | Vite SPA up | `GET http://127.0.0.1:5173/` | ✅ 200, title `hotelmanagement` |
| 4 | Login admin@resort.com / password | `POST /api/auth/login` | ✅ token, role=admin, id 94 |
| 5 | Role dashboard renders | `GET /api/dashboard/` (admin) | ✅ 200, JSON metrics present |
| 6 | Vite proxy → API | `POST /api/auth/login` via 5173 | ✅ token returned through proxy |
| 7 | Vite proxy → Socket.IO | `GET /socket.io/?EIO=4&transport=polling` | ✅ 200 |
| 8 | KOT creation | `POST /api/kitchen/order` (table T-5) | ✅ `KOT-0001`, id 1, status Pending/Active |
| 9 | Booking creation | `POST /api/booking/guest` (HAG3 Smoke Guest) | ✅ `BK-20261125-2B53`, bookingId 1 |
| 10 | Invoice generate | `GET /api/invoices/1` | ✅ `HOTINV-20261125-0001` |
| 11 | Invoice PDF download | `GET /api/invoices/1/pdf` | ✅ 200, `application/pdf`, 2,978 bytes, valid 1-page PDF |

## Defects

1. **Minor — thermal KOT auto-print fails** (cosmetic, does not block any flow)
   - `PrintQueue` retry-loop on `JOB-1795600778721-mbzzb7`:
     `pdf-to-printer` invokes `SumatraPDF-3.4.6-32.exe -print-to "kitchen"`; no Windows printer named `kitchen` exists on this host, so every retry fails. The KOT row itself is created and numbered correctly in the DB; only the physical print leg is broken.
   - Fix: add a `kitchen` printer on this host, or disable `AUTO_PRINT_ENABLED` for the KOT queue in `.env`.

2. **Minor — WhatsApp auto-confirmation fails** (expected on this host)
   - `Wasend` gateway returns 500 `Failed to send message` for both customer and admin legs of booking 1. No reachable `wasachiva_key`/gateway on this network; the app falls through its "Text fallback also failed" path and logs, but the booking is unaffected.
   - Not a code defect — infrastructure absent in this environment.

## Test data left behind (dev DB, per instructions)

- `kitchen_orders` id 1 → `KOT-0001`, table `T-5`
- `bookings` id 1 → `BK-20261125-2B53` (HAG3 Smoke Guest)
- `invoices` id 1 → `HOTINV-20261125-0001`
- Generated PDFs in `Maa-Baglamkhi-Resort-Backend/uploads/invoices/` and `src/uploads/invoices/`

**No commits made. `npm run reset` was NOT run.**
