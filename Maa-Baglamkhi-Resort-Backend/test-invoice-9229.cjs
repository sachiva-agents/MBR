/* Temporary verification: generate booking 9229's A4 tax invoice through the
   real code path, extract the PDF text, and check the numbers. Run:
     node test-invoice-9229.cjs
   Deletes the test PDF on exit. */
const fs = require("fs");
const zlib = require("zlib");

(async () => {
  const { getFullBooking } = require("./src/controller/bookingController");
  const { generateInvoicePdf } = require("./src/services/invoicePdfService");

  // 1. Pull the booking the same way the UI does.
  const req = { params: { id: 9229 }, query: {}, user: { id: 1 } };
  let out;
  const res = { status(c) { this.code = c; return this; }, json(x) { out = x; } };
  await getFullBooking(req, res);
  const full = out;

  // 2. Build the items the controller feeds the PDF (booking_rooms totals
  //    are PRE-tax; getFullBooking's rooms carry the room's own gst %).
  const booking = {
    bookingId: 9229,
    invoiceNo: "HOTINV-TEST-" + 9229,
    customerName: full.summary?.guest_name || "Test",
    phone: full.summary?.mobile || "",
    checkIn: full.summary?.check_in,
    checkOut: full.summary?.check_out,
    roomNumber: full.rooms?.[0]?.room_number || "101",
    roomType: full.rooms?.[0]?.roomType || "Single",
    pax: (Number(full.summary?.adults) || 0) + " Adults",
    address: full.summary?.address || "",
    totalAmount: full.summary?.totalAmount || 0,
    paidAmount: full.summary?.paidAmount || 0,
    remainingAmount: full.summary?.remainingAmount ?? null,
    paymentMode: full.summary?.paymentMode || "Cash",
  };
  booking.items = (full.rooms || []).map((r) => ({
    name: "Room " + r.room_number,
    total: Number(r.total) || 0,
    price: Number(r.tariff) || 0,
    quantity: 1,
    gstPercent: Number(r.gst) || 0,
  }));
  console.log("items:", JSON.stringify(booking.items));

  // 3. Generate the PDF.
  const pdf = await generateInvoicePdf(booking);
  console.log("PDF:", pdf.fileName);

  // 4. Extract text from (flated) content streams, using each stream's
  //    /Length so we slice the exact compressed bytes (extra trailing
  //    bytes break inflateSync).
  const buf = fs.readFileSync(pdf.filePath);
  const data = buf.toString("latin1");
  let i = 0;
  let inflateFailures = 0;
  const found = [];
  while (true) {
    const s = data.indexOf("stream", i);
    if (s === -1) break;
    const header = data.slice(Math.max(0, s - 300), s);
    const lenM = /\/Length\s+(\d+)/.exec(header);
    const start = data.indexOf("\n", s) + 1;
    const exact = lenM ? data.slice(start, start + Number(lenM[1])) : null;
    let text;
    if (exact) {
      try {
        text = zlib.inflateSync(Buffer.from(exact, "latin1")).toString("latin1");
      } catch (err) {
        inflateFailures++;
        text = exact; // uncompressed content
      }
    } else {
      const e = data.indexOf("endstream", start);
      text = data.slice(start, e);
    }
    const re = /\(((?:[^()\\]|\\.)*)\)/g;
    let m;
    while ((m = re.exec(text)) !== null) found.push(m[1]);
    i = s + 6;
  }
  const txt = found.join(" ");
  fs.unlinkSync(pdf.filePath);
  console.log("PDF cleaned up.");
  console.log("FULL TEXT:\n" + txt.replace(/\s+/g, " "));

  const checks = {
    "row total 525.00": txt.includes("525.00"),
    "SGST 12.50": txt.includes("12.50"),
    "Final Total 525": /Final Total\s+525/.test(txt),
    "no 476.19 (old back-out)": !txt.includes("476.19"),
    "no 11.91 (old back-out)": !txt.includes("11.91"),
    "no 476.19 tariff": !txt.includes("476.19"),
  };
  console.log("--- verification ---");
  let allOk = true;
  for (const [label, ok] of Object.entries(checks)) {
    console.log((ok ? "PASS " : "FAIL ") + label);
    allOk = allOk && ok;
  }
  console.log("--- key numbers in extracted text ---");
  const lines = txt
    .split(/\s{2,}/)
    .filter((l) => /(Tariff|SGST|CGST|Taxable|Room Total|Final|Total|500|525)/.test(l));
  lines.slice(0, 30).forEach((l) => console.log("  " + l.slice(0, 120)));
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error("TEST FAILED:", e.message);
  console.error(e.stack.slice(0, 800));
  process.exit(1);
});
