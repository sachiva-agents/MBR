# MBR — Hotel-Invoice PDF Baseline (HAG-7 freeze-proof)

**Date:** 2026-11-26 · **Repo:** `X:/agent/MBR` · **Baseline captured at main `d67b54d`** (PDF pipeline byte-equivalent to `d35dd73`; the one commit in between, S-1, only touches `WaiterDeliveryQueue.jsx`) · **Captured by:** ada · **Artifact:** `reports/pdf-baseline/2026-11-26-invoice.pdf`

The frozen pipeline is the **browser** path only:
`buildHotelInvoiceDocument()` → offscreen iframe → html2canvas (scale 2) → jsPDF A4
(`Maa-Baglamkhi-Resort-frontend/src/components/Hotel/BookingFlow.jsx`
`handleDownloadHotelInvoicePdf`, line ~4909; the "Download PDF" button on the
booking **Details** view). The backend pdfkit `invoicePdfService.js` path is a
*separate* generator (WhatsApp invoice leg) and is out of scope for this
freeze-proof.

## Hashes

| Value | Hex / note |
| --- | --- |
| **PDF raw sha256 (exact, this artifact)** | `0a76299173a9e45140c408c1a9554c6916d5a5ffd55dbc94c2e8ad144af74230` |
| PDF size | 271,149 bytes, 1 A4 page, embedded JPEG 1588×2246 px |
| **Image-stream content fingerprint (stable invariant)** | `364fa75dfe38eca8bccaf0d59b7293bf9ed264272362b4058cbe47784f3c1ea8` (sha256 of the `/DCTDecode` image object, `/Length` 267,785) |
| Steady-state stability proof | two back-to-back generations (gen2, gen3) rasterize **identically** — fingerprint `364fa75d…` for both |

### Why the raw sha256 is NOT the diff target

jsPDF 4.2.1 writes a random `/ID` and the run-time `/CreationDate` into the PDF
trailer. Raw bytes therefore **always differ between two runs even when the
invoice is visually identical** (proven in capture: raw hashes `d696ed25…` /
`0a762991…` for two visually-identical generations). The invariant that
proves "format stays 100% identical" is the **image-stream content
fingerprint** — the exact pixel raster of the rendered invoice (layout,
columns, words, totals, spacing). After any round-2 fix, compare that hash,
plus page count and the embedded image dimensions; ignore `/ID`,
`/CreationDate` and the raw-file sha256.

Also note: the **first** generation after page load is a font warm-up
artifact (235,468 B image vs 267,785 B steady state) — always use the
steady-state generation (2nd+) when regenerating.

## Reproduction steps (read-only on code; scratch DB only — NEVER prod)

Data used: scratch DB `mbr_pdf_baseline` on local MariaDB 10.4 (XAMPP,
127.0.0.1:3306), seeded with **one fixed-deterministic booking**:

- `bookings` id 1 · `BK-20261120-ABCD` · check-in 2026-11-20, check-out 2026-11-22
- 1 room line: `booking_rooms` → room 104 (Super Deluxe), ₹5,000/night × 2 nights, `gst_percent` 5 (pre-tax `total` 10,000.00 → GST-inclusive 10,500.00)
- advance: `payments` id 1 → 5,000.00 UPI completed (`payment_methods` id 1 seeded)
- folio extra: `hotel_folio_entries` id 1 → 2026-11-20 "Room Service Dinner" 750.00
- guest profile: Aarav Kumar, 9876543210, Bhopal (primary guest)

1. **Scratch DB:** `CREATE DATABASE mbr_pdf_baseline …;` then apply
   `Maa-Baglamkhi-Resort-Backend/schema-v4.sql` to it, run the seed SQL
   (fixed ids/dates above, no `NOW()`/randoms), and confirm 82+ tables exist.
   Admin users are seeded on backend boot.
2. **Backend (scratch):** `DB_NAME=mbr_pdf_baseline NODE_ENV=production PORT=5002 node index.js`
   in `Maa-Baglamkhi-Resort-Backend` (env var wins over `.env`). Wait for
   `health:200` on `GET /api/health` and 7 default users in `mbr_pdf_baseline.users`.
   Prod DB `resort_management1` is never connected.
3. **Frontend:** `npm run dev` in `Maa-Baglamkhi-Resort-frontend` (Vite :5173;
   the app calls `http://127.0.0.1:5002` directly via `VITE_API_BASE`).
4. **Drive the UI** (Playwright 1.63 chromium, `acceptDownloads`):
   pin the browser clock to `2026-11-26 10:00` (`page.clock.install`) —
   the invoice date renders `new Date()` because `getFullBooking` returns no
   `invoice_date`, so the clock must be pinned for reproducibility;
   login `admin@resort.com` / `password`; go to `/hotel/all-bookings`;
   "View" the `BK-20261120-ABCD` row (Details view); click the **Download
   PDF** button; save the `Tax_Invoice_BK-20261120-ABCD.pdf` download.
   Run the click **twice** and keep the second download (steady state).
5. **Fingerprint:** extract the PDF's `/Filter /DCTDecode` image object using
   its `/Length` field and sha256 that byte range → compare to
   `364fa75dfe38eca8bccaf0d59b7293bf9ed264272362b4058cbe47784f3c1ea8`.
   (The extraction one-liner used: find the `DCTDecode` object dict, read
   `/Length N`, slice `N` bytes after the `stream\n` keyword.)

### Expected invoice content (so a layout regression is visible)

Grand total **₹11,250.00** (= 10,500 room-incl-GST + 750 folio extra),
Amount in words "Rupees Eleven Thousand Two Hundred Fifty Only", Paid
**5,000** / Due **6,250**, 2 per-night rows "Room Charges - SUPER DELUXE – SUPER DELUXE"
@ 5,250.00 gross each, invoice date **26 Nov 2026** (pinned clock), guest
**Aarav Kumar**, room **104**, 2 nights.

## Verdict rule for round-2

After any fix commit: regenerate per the steps above. **PASS** = image-stream
fingerprint `364fa75d…` unchanged **and** page count 1 **and** image dims
1588×2246. Any change to `buildHotelInvoiceDocument`, the html2canvas/jsPDF
paths, or invoice template rendering will move the fingerprint → **FAIL**,
and the pipeline is frozen.
