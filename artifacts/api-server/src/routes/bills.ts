import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { ai } from "@workspace/integrations-gemini-ai";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, PNG, JPG, JPEG allowed."));
    }
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConsumerMeta {
  consumer1_name: string | null;
  consumer1_number: string | null;
  consumer1_load: number | null;
  consumer1_connection: string | null;
  consumer2_name: string | null;
  consumer2_number: string | null;
  consumer2_load: number | null;
  consumer2_connection: string | null;
}

interface MonthlyRaw {
  bill_month: string | null;
  consumer1: { units: number | null; bill_amount: number | null };
  consumer2: { units: number | null; bill_amount: number | null };
}

interface MonthlyEntry {
  month: string;
  consumer1Units: number | null;
  consumer1Bill: number | null;
  consumer2Units: number | null;
  consumer2Bill: number | null;
}

// ─── AI Prompts ──────────────────────────────────────────────────────────────

const META_PROMPT = `Extract consumer metadata from this Indian MSEDCL electricity bill. Return ONLY valid JSON with no markdown:

{
  "consumer1_name": "Shri Madhusham Khobragade",
  "consumer1_number": "439320095567",
  "consumer1_load": 3.3,
  "consumer1_connection": "90/LT I Res 1-Phase",
  "consumer2_name": "Ranjana Khobragade",
  "consumer2_number": "439322232375",
  "consumer2_load": 1.0,
  "consumer2_connection": "90/LT I Res 1-Phase"
}

Rules:
- consumer1_load and consumer2_load must be plain numbers in kW (e.g. 3.3 not "3.3KW")
- If only one consumer is on the bill, set all consumer2_* fields to null
- Return ONLY the JSON object, no markdown, no extra text`;

const MONTHLY_PROMPT = `Extract monthly billing data from this Indian MSEDCL electricity bill. Return ONLY valid JSON with no markdown:

{
  "bill_month": "2026-01-01",
  "consumer1": {
    "units": 25,
    "bill_amount": 320.45
  },
  "consumer2": {
    "units": 137,
    "bill_amount": 3335.34
  }
}

Rules:
- bill_month must be ISO format "YYYY-MM-01" for the billing month shown on the bill
- units = electricity units (kWh) consumed this billing cycle (a number)
- bill_amount = total bill amount in rupees for this cycle (a number)
- If consumer2 does not appear on this bill set consumer2.units = null and consumer2.bill_amount = null
- Return ONLY the JSON object, no markdown, no extra text`;

// ─── AI Calls ────────────────────────────────────────────────────────────────

async function extractMeta(buffer: Buffer, mimeType: string): Promise<ConsumerMeta> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: buffer.toString("base64") } },
        { text: META_PROMPT },
      ],
    }],
    config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
  });
  const raw = (response.text ?? "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(raw) as ConsumerMeta;
  return {
    consumer1_name: parsed.consumer1_name ?? null,
    consumer1_number: String(parsed.consumer1_number ?? "").trim() || null,
    consumer1_load: typeof parsed.consumer1_load === "number" ? parsed.consumer1_load : null,
    consumer1_connection: parsed.consumer1_connection ?? null,
    consumer2_name: parsed.consumer2_name ?? null,
    consumer2_number: String(parsed.consumer2_number ?? "").trim() || null,
    consumer2_load: typeof parsed.consumer2_load === "number" ? parsed.consumer2_load : null,
    consumer2_connection: parsed.consumer2_connection ?? null,
  };
}

async function extractMonthly(buffer: Buffer, mimeType: string): Promise<MonthlyRaw | null> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: buffer.toString("base64") } },
        { text: MONTHLY_PROMPT },
      ],
    }],
    config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
  });
  const raw = (response.text ?? "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(raw) as MonthlyRaw;
  if (!parsed.bill_month) return null;
  return {
    bill_month: parsed.bill_month,
    consumer1: {
      units: typeof parsed.consumer1?.units === "number" ? parsed.consumer1.units : null,
      bill_amount: typeof parsed.consumer1?.bill_amount === "number" ? parsed.consumer1.bill_amount : null,
    },
    consumer2: {
      units: typeof parsed.consumer2?.units === "number" ? parsed.consumer2.units : null,
      bill_amount: typeof parsed.consumer2?.bill_amount === "number" ? parsed.consumer2.bill_amount : null,
    },
  };
}

// ─── Excel Generation ────────────────────────────────────────────────────────
//
// EXACT COLUMN LAYOUT (1-indexed rows):
//
//   Col:  A              B       C        D            E          F   G              H       I            J
//         ─────────────  ──────  ───────  ───────────  ─────────  ─── ─────────────  ──────  ───────────  ─────────
//   R2:   Consumer Name          [C1Name]                             [C2Name]
//   R3:   Consumer No            [C1Num]                              [C2Num]
//   R4:   Fixed Charges          130                                  130
//   R5:   Sanct.Load(kW)         [C1Load]                             [C2Load]
//   R6:   Connection Type        [C1Conn]                             [C2Conn]
//   R7:   Solar Panel used  600
//   R8:   Sr.No          Month   Units    Bill Amount  Unit Cost  F   Sr.No*  Month*  Units    Bill Amount  Unit Cost
//   R9-20:[1-12]         [Mon]   [C1kWh]  [C1₹]       [formula]      (blank) (=B)    [C2kWh]  [C2₹]        [formula]
//   R21:  Average        blank   AVG(C)   AVG(D)       AVG(E)        Average  blank   AVG(H)   AVG(I)       AVG(J)
//   R22:  kW             blank   =(C21…)                             kW       =(H21…)
//   R23:  Solar Panels   blank   =C22/…                              Solar P  =H22/…
//   R24:  Solar Cap(kW)  blank   =ROUND…                             Solar C  =ROUND…
//   R25:  No. of Panels  blank   =C24/…                              No.Pnl   =H24/…
//   R27:  Total Solar Cap        =SUM(C24,H24)
//   R28:  No.Solar Panels        =SUM(C25,H25)
//
// * Consumer 2 does NOT need a separate Month column — column B month applies to both.
//   G is the label column for Consumer 2.  H = C2 Units,  I = C2 Bill,  J = C2 Unit Cost.

function generateExcel(meta: ConsumerMeta, monthlyData: MonthlyEntry[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};

  // Helper to write a plain cell
  const s = (cell: string, v: string | number) => {
    ws[cell] = { t: typeof v === "number" ? "n" : "s", v };
  };
  // Helper to write a formula cell
  const f = (cell: string, formula: string) => {
    ws[cell] = { t: "n", f: formula };
  };

  // ── Consumer 1 metadata (rows 2-6, labels in A, values in C) ──────────────
  s("A2", "Consumer Name");    s("C2", meta.consumer1_name ?? "");
  s("A3", "Consumer No");      s("C3", meta.consumer1_number ?? "");
  s("A4", "Fixed Charges");    s("C4", 130);
  s("A5", "Sanct. Load (kW)"); s("C5", meta.consumer1_load != null ? `${meta.consumer1_load}KW` : "");
  s("A6", "Connection Type");  s("C6", meta.consumer1_connection ?? "");

  // ── Consumer 2 metadata (rows 2-6, values in G — label column for C2) ─────
  s("G2", meta.consumer2_name ?? "");
  s("G3", meta.consumer2_number ?? "");
  s("G4", 130);
  s("G5", meta.consumer2_load != null ? `${meta.consumer2_load}KW` : "");
  s("G6", meta.consumer2_connection ?? "");

  // ── Solar panel wattage (row 7) — cell B7 = 600, also set $C$7 = 600 ─────
  // The formulas reference $C$7 for wattage.
  s("A7", "Solar Panel used");
  s("B7", 600);
  s("C7", 600); // $C$7 used in formulas

  // ── Column headers (row 8) ────────────────────────────────────────────────
  s("A8", "Sr.No");
  s("B8", "Month");
  s("C8", "Units");
  s("D8", "Bill Amount");
  s("E8", "Unit Cost");
  // F is blank separator
  s("G8", "Sr.No");
  // H8 blank (month = same as B column)
  s("H8", "Units");
  s("I8", "Bill Amount");
  s("J8", "Unit Cost");

  // ── Monthly data rows (9-20, 12 rows max) ─────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const row = 9 + i;
    s(`A${row}`, i + 1); // Sr.No for both consumers

    if (i < monthlyData.length) {
      const entry = monthlyData[i];

      // Format month label e.g. "Jan 2025"
      let monthLabel = entry.month;
      try {
        const d = new Date(entry.month + "T00:00:00");
        if (!isNaN(d.getTime())) {
          monthLabel = d.toLocaleString("en-IN", { month: "short", year: "numeric" });
        }
      } catch { /* keep raw */ }

      // Consumer 1 (B = Month, C = Units, D = Bill Amount)
      s(`B${row}`, monthLabel);
      if (entry.consumer1Units !== null) s(`C${row}`, entry.consumer1Units);
      if (entry.consumer1Bill !== null)  s(`D${row}`, entry.consumer1Bill);

      // Consumer 2 (H = Units, I = Bill Amount) — month shared from col B
      if (entry.consumer2Units !== null) s(`H${row}`, entry.consumer2Units);
      if (entry.consumer2Bill !== null)  s(`I${row}`, entry.consumer2Bill);
    }
  }

  // ── Row 21: Averages ───────────────────────────────────────────────────────
  s("A21", "Average");
  f("C21", "AVERAGE(C9:C20)");   // avg units Consumer 1
  f("D21", "AVERAGE(D9:D20)");   // avg bill Consumer 1
  f("E21", "AVERAGE(E9:E20)");   // avg unit cost Consumer 1

  s("G21", "Average");
  f("H21", "AVERAGE(H9:H20)");   // avg units Consumer 2
  f("I21", "AVERAGE(I9:I20)");   // avg bill Consumer 2
  f("J21", "AVERAGE(J9:J20)");   // avg unit cost Consumer 2

  // ── Row 22: System kW ─────────────────────────────────────────────────────
  s("A22", "kW");
  f("C22", "(C21*12*1.1)/1400");

  s("G22", "kW");
  f("H22", "(H21*12*1.1)/1400");

  // ── Row 23: Solar Panels ──────────────────────────────────────────────────
  s("A23", "Solar Panels");
  f("C23", "C22/$C$7*1000");

  s("G23", "Solar Panels");
  f("H23", "H22/$C$7*1000");

  // ── Row 24: Solar Capacity ────────────────────────────────────────────────
  s("A24", "Solar Capacity (kW)");
  f("C24", "ROUND(C23,0)*$C$7/1000");

  s("G24", "Solar Capacity (kW)");
  f("H24", "ROUND(H23,0)*$C$7/1000");

  // ── Row 25: Number of Panels ──────────────────────────────────────────────
  s("A25", "Number of Panels");
  f("C25", "C24/$C$7*1000");

  s("G25", "Number of Panels");
  f("H25", "H24/$C$7*1000");

  // ── Rows 27-28: Totals ────────────────────────────────────────────────────
  s("A27", "Total Solar Capacity");
  f("C27", "SUM(C24,H24)");

  s("A28", "Number of Solar Panels");
  f("C28", "SUM(C25,H25)");

  // ── Column widths ─────────────────────────────────────────────────────────
  ws["!cols"] = [
    { wch: 22 }, // A — labels
    { wch: 11 }, // B — month / wattage
    { wch: 10 }, // C — C1 units
    { wch: 14 }, // D — C1 bill
    { wch: 11 }, // E — C1 unit cost
    { wch: 3  }, // F — separator
    { wch: 22 }, // G — C2 labels / name
    { wch: 10 }, // H — C2 units
    { wch: 14 }, // I — C2 bill
    { wch: 11 }, // J — C2 unit cost
  ];

  ws["!ref"] = "A1:J30";

  XLSX.utils.book_append_sheet(wb, ws, "Solar Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post(
  "/bills/process",
  upload.array("files", 12),
  async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json({ error: "Please upload at least one bill file" });
        return;
      }

      // Step 1: Extract consumer metadata from the first file
      let meta: ConsumerMeta;
      try {
        meta = await extractMeta(files[0].buffer, files[0].mimetype);
      } catch (err) {
        req.log.error({ err }, "Meta extraction failed");
        res.status(500).json({ error: "AI could not read the bill. Please try a clearer image." });
        return;
      }

      // Step 2: Extract monthly data from every file sequentially
      const rawMonthly: MonthlyEntry[] = [];
      let failCount = 0;

      for (const file of files) {
        try {
          const monthly = await extractMonthly(file.buffer, file.mimetype);
          if (monthly?.bill_month) {
            rawMonthly.push({
              month: monthly.bill_month,
              consumer1Units: monthly.consumer1.units,
              consumer1Bill: monthly.consumer1.bill_amount,
              consumer2Units: monthly.consumer2.units,
              consumer2Bill: monthly.consumer2.bill_amount,
            });
          }
        } catch {
          failCount++;
        }
      }

      if (rawMonthly.length === 0) {
        res.status(422).json({ error: "Could not extract any monthly data. Try clearer bill images." });
        return;
      }

      // Step 3: Deduplicate by month key and sort oldest → newest
      const byMonth = new Map<string, MonthlyEntry>();
      for (const entry of rawMonthly) {
        if (!byMonth.has(entry.month)) {
          byMonth.set(entry.month, entry);
        }
      }
      const monthlyData = Array.from(byMonth.values()).sort(
        (a, b) => new Date(a.month).getTime() - new Date(b.month).getTime(),
      );

      // Step 4: Generate Excel
      let excelBuffer: Buffer;
      try {
        excelBuffer = generateExcel(meta, monthlyData);
      } catch (err) {
        req.log.error({ err }, "Excel generation failed");
        res.status(500).json({ error: "Failed to generate Excel report." });
        return;
      }

      // Derive filename from latest month
      const latestMonth = monthlyData[monthlyData.length - 1]?.month ?? "";
      let monthLabel = "Report";
      if (latestMonth) {
        try {
          const d = new Date(latestMonth + "T00:00:00");
          if (!isNaN(d.getTime())) {
            monthLabel = d.toLocaleString("en-IN", { month: "long", year: "numeric" });
          }
        } catch { /* keep default */ }
      }
      const filename = `Solar_Report_${monthLabel.replace(/\s+/g, "_")}.xlsx`;

      res.json({
        consumer1Name: meta.consumer1_name,
        consumer1Number: meta.consumer1_number,
        consumer1Load: meta.consumer1_load,
        consumer1Connection: meta.consumer1_connection,
        consumer2Name: meta.consumer2_name,
        consumer2Number: meta.consumer2_number,
        consumer2Load: meta.consumer2_load,
        consumer2Connection: meta.consumer2_connection,
        monthlyData,
        totalFilesProcessed: files.length - failCount,
        excelBase64: excelBuffer.toString("base64"),
        excelFilename: filename,
      });
    } catch (err) {
      req.log.error({ err }, "Unexpected error processing bills");
      res.status(500).json({ error: "An unexpected error occurred. Please try again." });
    }
  },
);

export default router;
