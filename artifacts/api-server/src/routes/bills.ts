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

const META_PROMPT = `Extract consumer metadata from this Indian electricity bill. Return ONLY valid JSON:

{
  "consumer1_name": "Shri Madhusham Khobragade",
  "consumer1_number": "439320095567",
  "consumer1_load": 3.3,
  "consumer1_connection": "90/LT I Res 1-Phase",
  "consumer2_name": "Ranjana Khobragade",
  "consumer2_number": "439322232375",
  "consumer2_load": 1,
  "consumer2_connection": "90/LT I Res 1-Phase"
}

Rules:
- consumer1_load must be a number in kW (e.g. 3.3 not "3.3KW")
- If only one consumer, set consumer2_* fields to null
- Return ONLY the JSON object, no markdown`;

const MONTHLY_PROMPT = `Extract monthly billing data from this Indian electricity bill. Return ONLY valid JSON:

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
- bill_month must be "YYYY-MM-01" format for the billing month
- units must be a number (kWh consumed this billing cycle)
- bill_amount must be a number (total rupees for this billing cycle)
- If consumer2 is not present on this bill, set consumer2.units = null and consumer2.bill_amount = null
- Return ONLY the JSON object, no markdown`;

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
    consumer1_number: parsed.consumer1_number ?? null,
    consumer1_load: typeof parsed.consumer1_load === "number" ? parsed.consumer1_load : null,
    consumer1_connection: parsed.consumer1_connection ?? null,
    consumer2_name: parsed.consumer2_name ?? null,
    consumer2_number: parsed.consumer2_number ?? null,
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
// Layout (1-indexed rows, letters = columns):
//   A  B        C      D           E            F   G        H      I           J
//   -- -------- ------ ----------- ------------ --- -------- ------ ----------- -----------
//   2  Con Name        [Name1]                          [Name2]
//   3  Con No          [Num1]                           [Num2]
//   4  Fixed Ch        130                              130
//   5  Sanct.          [Load1]                          [Load2]
//   6  Conn.           [Type1]                          [Type2]
//   7  Solar W  600
//   8  Sr.No   Month   Units       Bill Amt     Unit C  Month   Units  Bill Amt  Unit Cost
//   9-20       [monthly data rows 1-12]
//   21 Average  [blank] =AVG(C9:C20) =AVG(D9:D20)       [blank] =AVG(H9:H20) =AVG(I9:I20)
//   22 kW               =(C21*12*1.1)/1400              =(H21*12*1.1)/1400
//   23 Panels            =C22/$C$7*1000                  =H22/$C$7*1000
//   24 Capacity          =ROUND(C23,0)*$C$7/1000         =ROUND(H23,0)*$C$7/1000
//   25 No.Panels         =C24/$C$7*1000                  =H24/$C$7*1000
//   27 Total cap         =SUM(C24,H24)
//   28 Total panels      =SUM(C25,H25)

function generateExcel(
  meta: ConsumerMeta,
  monthlyData: MonthlyEntry[],
): Buffer {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};

  const s = (cell: string, v: string | number, f?: string) => {
    if (f) {
      ws[cell] = { t: typeof v === "number" ? "n" : "s", v, f };
    } else {
      ws[cell] = { t: typeof v === "number" ? "n" : "s", v };
    }
  };

  // ── Consumer meta (rows 2-6) ───────────────────────────────────────────────
  s("A2", "Consumer Name");   s("C2", meta.consumer1_name ?? "");   s("G2", meta.consumer2_name ?? "");
  s("A3", "Consumer No");     s("C3", meta.consumer1_number ?? ""); s("G3", meta.consumer2_number ?? "");
  s("A4", "Fixed Charges");   s("C4", 130);                         s("G4", 130);
  s("A5", "Sanct. Load (kW)");s("C5", meta.consumer1_load ?? "");  s("G5", meta.consumer2_load ?? "");
  s("A6", "Connection Type"); s("C6", meta.consumer1_connection ?? ""); s("G6", meta.consumer2_connection ?? "");

  // ── Solar panel wattage (row 7) ────────────────────────────────────────────
  s("A7", "Solar Panel used"); s("B7", 600);

  // ── Column headers (row 8) ────────────────────────────────────────────────
  s("A8", "Sr.No");
  s("B8", "Month"); s("C8", "Units"); s("D8", "Bill Amount"); s("E8", "Unit Cost");
  s("G8", "Month"); s("H8", "Units"); s("I8", "Bill Amount"); s("J8", "Unit Cost");

  // ── Monthly data rows (9-20, 12 rows) ─────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const row = 9 + i;
    s(`A${row}`, i + 1); // Sr.No
    if (i < monthlyData.length) {
      const entry = monthlyData[i];
      // Format month as display string e.g. "Feb 2025"
      let monthLabel = entry.month;
      try {
        const d = new Date(entry.month);
        if (!isNaN(d.getTime())) {
          monthLabel = d.toLocaleString("en-IN", { month: "short", year: "numeric" });
        }
      } catch { /* keep raw */ }

      s(`B${row}`, monthLabel);
      if (entry.consumer1Units !== null) s(`C${row}`, entry.consumer1Units);
      if (entry.consumer1Bill !== null)  s(`D${row}`, entry.consumer1Bill);

      s(`G${row}`, monthLabel);
      if (entry.consumer2Units !== null) s(`H${row}`, entry.consumer2Units);
      if (entry.consumer2Bill !== null)  s(`I${row}`, entry.consumer2Bill);
    }
  }

  // ── Row 21: Averages ───────────────────────────────────────────────────────
  s("A21", "Average");
  ws["C21"] = { t: "n", f: "AVERAGE(C9:C20)" };
  ws["D21"] = { t: "n", f: "AVERAGE(D9:D20)" };
  ws["H21"] = { t: "n", f: "AVERAGE(H9:H20)" };
  ws["I21"] = { t: "n", f: "AVERAGE(I9:I20)" };

  // ── Row 22: kW (annual generation estimate) ────────────────────────────────
  s("A22", "kW");
  ws["C22"] = { t: "n", f: "(C21*12*1.1)/1400" };
  ws["H22"] = { t: "n", f: "(H21*12*1.1)/1400" };

  // ── Row 23: Solar Panels ───────────────────────────────────────────────────
  s("A23", "Solar Panels");
  ws["C23"] = { t: "n", f: "C22/$C$7*1000" };
  ws["H23"] = { t: "n", f: "H22/$C$7*1000" };

  // ── Row 24: Solar Capacity ─────────────────────────────────────────────────
  s("A24", "Solar Capacity (kW)");
  ws["C24"] = { t: "n", f: "ROUND(C23,0)*$C$7/1000" };
  ws["H24"] = { t: "n", f: "ROUND(H23,0)*$C$7/1000" };

  // ── Row 25: Number of Panels ───────────────────────────────────────────────
  s("A25", "Number of Panels");
  ws["C25"] = { t: "n", f: "C24/$C$7*1000" };
  ws["H25"] = { t: "n", f: "H24/$C$7*1000" };

  // ── Row 27-28: Totals ──────────────────────────────────────────────────────
  s("A27", "Total Solar Capacity");
  ws["C27"] = { t: "n", f: "SUM(C24,H24)" };

  s("A28", "Number of Solar Panels");
  ws["C28"] = { t: "n", f: "SUM(C25,H25)" };

  // ── Column widths ──────────────────────────────────────────────────────────
  ws["!cols"] = [
    { wch: 22 }, // A
    { wch: 12 }, // B
    { wch: 10 }, // C
    { wch: 14 }, // D
    { wch: 11 }, // E
    { wch: 3  }, // F (separator)
    { wch: 12 }, // G
    { wch: 10 }, // H
    { wch: 14 }, // I
    { wch: 11 }, // J
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

      // Step 3: Deduplicate by month and sort oldest → newest
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
          const d = new Date(latestMonth);
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
