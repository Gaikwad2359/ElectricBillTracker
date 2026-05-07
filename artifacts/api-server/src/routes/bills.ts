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

interface ConsumerRaw {
  name: string | null;
  consumer_number: string | null;
  sanctioned_load_kw: number | null;
  connection_type: string | null;
  current_month_units: number | null;
  current_month_bill: number | null;
  current_month_date: string | null;
}

interface BillExtractionRaw {
  consumer1: ConsumerRaw;
  consumer2: ConsumerRaw;
}

const EXTRACTION_PROMPT = `Extract from this Indian electricity bill. Return ONLY valid JSON:

{
  "consumer1": {
    "name": "consumer name",
    "consumer_number": "number",
    "sanctioned_load_kw": 3.3,
    "connection_type": "residential",
    "current_month_units": 25,
    "current_month_bill": 320.45,
    "current_month_date": "2026-01-01"
  },
  "consumer2": {
    "name": "second consumer name or null",
    "consumer_number": "number or null",
    "sanctioned_load_kw": null,
    "connection_type": null,
    "current_month_units": null,
    "current_month_bill": null,
    "current_month_date": null
  }
}

Rules:
- Extract Consumer 1 data always (primary consumer on the bill)
- Only fill Consumer 2 if there is a clearly separate second consumer on the same bill; otherwise set all Consumer 2 fields to null
- sanctioned_load_kw must be a number in kW (e.g. 3.3 not "3.3 KW")
- current_month_units must be a number (kWh consumed this billing cycle)
- current_month_bill must be a number (total bill amount in rupees)
- current_month_date must be "YYYY-MM-01" format for the billing month
- connection_type must be one of: "residential", "commercial", "industrial"
- Return ONLY the JSON object, no markdown, no explanation`;

async function extractBillData(fileBuffer: Buffer, mimeType: string): Promise<BillExtractionRaw> {
  const base64Data = fileBuffer.toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });

  const rawText = response.text ?? "{}";
  const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned) as BillExtractionRaw;

  const safeConsumer = (c: ConsumerRaw | null | undefined): ConsumerRaw => ({
    name: c?.name ?? null,
    consumer_number: c?.consumer_number ?? null,
    sanctioned_load_kw: typeof c?.sanctioned_load_kw === "number" ? c.sanctioned_load_kw : null,
    connection_type: c?.connection_type ?? null,
    current_month_units: typeof c?.current_month_units === "number" ? c.current_month_units : null,
    current_month_bill: typeof c?.current_month_bill === "number" ? c.current_month_bill : null,
    current_month_date: c?.current_month_date ?? null,
  });

  return {
    consumer1: safeConsumer(parsed.consumer1),
    consumer2: safeConsumer(parsed.consumer2),
  };
}

/**
 * Generate Excel matching Energybase's template exactly.
 *
 * Layout (1-indexed rows, A=col 1):
 *  Row 2:  Consumer Name    |   | [Name1]         |  |  |  | [Name2]
 *  Row 3:  Consumer No      |   | [Number1]       |  |  |  | [Number2]
 *  Row 4:  Fixed Charges    |   | 130             |  |  |  | 130
 *  Row 5:  Sanct. Load (kW) |   | [Load1]         |  |  |  | [Load2]
 *  Row 6:  Connection Type  |   | [Type1]         |  |  |  | [Type2]
 *  Row 7:  Solar Panel used | 600
 *  Row 8:  Sr.No | Month | Units | Bill Amount | Unit Cost | Month | Units | Bill Amount | Unit Cost
 *  Rows 9-21: Monthly data — fill current month in row 9
 *             Col A: Sr.No, Col B: Month1, Col C: Units1, Col D: BillAmt1, Col E: (formula/blank)
 *             Col F: Month2, Col G: Units2, Col H: BillAmt2, Col I: (formula/blank)
 *  Row 22: Average row — formulas set here
 *  Row 23: =(D22*12*1.1)/1400
 *  Row 24: =D23/$C$7*1000
 *  Row 25: =ROUND(D24,0)*$C$7/1000
 *  Row 26: =D25/$C$7*1000
 *  Row 28: =SUM(C25:C25)
 *  Row 29: =SUM(C26:C26)
 */
function generateExcel(extraction: BillExtractionRaw): Buffer {
  const wb = XLSX.utils.book_new();

  const c1 = extraction.consumer1;
  const c2 = extraction.consumer2;

  // Build the sheet as a 2D array (rows 1..29, 9 columns A..I)
  // Index: aoa[rowIdx][colIdx], row 0 = Excel row 1
  const ROWS = 30;
  const COLS = 9;
  const aoa: (string | number | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  const set = (row: number, col: number, val: string | number | null) => {
    aoa[row - 1][col - 1] = val;
  };

  // Row 2: Consumer Name
  set(2, 1, "Consumer Name");
  set(2, 3, c1.name ?? "");
  set(2, 7, c2.name ?? "");

  // Row 3: Consumer No
  set(3, 1, "Consumer No");
  set(3, 3, c1.consumer_number ?? "");
  set(3, 7, c2.consumer_number ?? "");

  // Row 4: Fixed Charges
  set(4, 1, "Fixed Charges");
  set(4, 3, 130);
  set(4, 7, 130);

  // Row 5: Sanctioned Load
  set(5, 1, "Sanct. Load (kW)");
  set(5, 3, c1.sanctioned_load_kw ?? "");
  set(5, 7, c2.sanctioned_load_kw ?? "");

  // Row 6: Connection Type
  set(6, 1, "Connection Type");
  set(6, 3, c1.connection_type ?? "");
  set(6, 7, c2.connection_type ?? "");

  // Row 7: Solar Panel wattage
  set(7, 1, "Solar Panel used");
  set(7, 2, 600);

  // Row 8: Column headers
  set(8, 1, "Sr.No");
  set(8, 2, "Month");
  set(8, 3, "Units");
  set(8, 4, "Bill Amount");
  set(8, 5, "Unit Cost");
  set(8, 6, "Month");
  set(8, 7, "Units");
  set(8, 8, "Bill Amount");
  set(8, 9, "Unit Cost");

  // Rows 9-21: Monthly data (13 rows for 13 months of history)
  // Fill current month's data in row 9 (most recent month)
  for (let r = 9; r <= 21; r++) {
    set(r, 1, r - 8); // Sr.No
  }

  // Consumer 1 current month data → row 9
  if (c1.current_month_date) set(9, 2, c1.current_month_date);
  if (c1.current_month_units !== null) set(9, 3, c1.current_month_units);
  if (c1.current_month_bill !== null) set(9, 4, c1.current_month_bill);

  // Consumer 2 current month data → row 9
  if (c2.current_month_date) set(9, 6, c2.current_month_date);
  if (c2.current_month_units !== null) set(9, 7, c2.current_month_units);
  if (c2.current_month_bill !== null) set(9, 8, c2.current_month_bill);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Row 22: Average formulas
  ws["D22"] = { t: "n", f: "AVERAGE(D9:D21)" };
  ws["I22"] = { t: "n", f: "AVERAGE(I9:I21)" };
  ws["A22"] = { t: "s", v: "Average" };

  // Rows 23-29: Calculation formulas
  ws["D23"] = { t: "n", f: "(D22*12*1.1)/1400" };
  ws["D24"] = { t: "n", f: "D23/$C$7*1000" };
  ws["D25"] = { t: "n", f: "ROUND(D24,0)*$C$7/1000" };
  ws["D26"] = { t: "n", f: "D25/$C$7*1000" };
  ws["D28"] = { t: "n", f: "SUM(C25:C25)" };
  ws["D29"] = { t: "n", f: "SUM(C26:C26)" };

  // Row labels for formula rows
  ws["A23"] = { t: "s", v: "Annual Generation (kWh)" };
  ws["A24"] = { t: "s", v: "No. of Panels" };
  ws["A25"] = { t: "s", v: "System Size (kW)" };
  ws["A26"] = { t: "s", v: "Actual Generation (kWh)" };
  ws["A28"] = { t: "s", v: "Total Panels" };
  ws["A29"] = { t: "s", v: "Total System Size (kW)" };

  // Column widths
  ws["!cols"] = [
    { wch: 22 }, // A
    { wch: 12 }, // B
    { wch: 12 }, // C
    { wch: 14 }, // D
    { wch: 12 }, // E
    { wch: 12 }, // F
    { wch: 12 }, // G
    { wch: 14 }, // H
    { wch: 12 }, // I
  ];

  // Set the sheet range
  ws["!ref"] = "A1:I30";

  XLSX.utils.book_append_sheet(wb, ws, "Solar Report");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buffer as Buffer;
}

router.post(
  "/bills/process",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Please upload a bill first" });
        return;
      }

      const { buffer, mimetype } = req.file;

      let extraction: BillExtractionRaw;
      try {
        extraction = await extractBillData(buffer, mimetype);
      } catch (err) {
        req.log.error({ err }, "Gemini extraction failed");
        res.status(500).json({ error: "AI extraction failed. Please try a clearer bill image." });
        return;
      }

      const c1 = extraction.consumer1;
      if (!c1.name && !c1.consumer_number && c1.current_month_units === null) {
        res.status(422).json({ error: "Could not extract consumer data from the bill. Try uploading a clearer image." });
        return;
      }

      let excelBuffer: Buffer;
      try {
        excelBuffer = generateExcel(extraction);
      } catch (err) {
        req.log.error({ err }, "Excel generation failed");
        res.status(500).json({ error: "Failed to generate Excel report." });
        return;
      }

      // Derive filename from bill month
      const rawDate = c1.current_month_date ?? "";
      let monthLabel = "Unknown";
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          monthLabel = d.toLocaleString("en-IN", { month: "long", year: "numeric" });
        }
      }
      const safeMonth = monthLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Solar_Report_${safeMonth}.xlsx`;
      const excelBase64 = excelBuffer.toString("base64");

      res.json({
        consumer1: {
          name: c1.name,
          consumerNumber: c1.consumer_number,
          sanctionedLoadKw: c1.sanctioned_load_kw,
          connectionType: c1.connection_type,
          currentMonthUnits: c1.current_month_units,
          currentMonthBill: c1.current_month_bill,
          currentMonthDate: c1.current_month_date,
        },
        consumer2: {
          name: extraction.consumer2.name,
          consumerNumber: extraction.consumer2.consumer_number,
          sanctionedLoadKw: extraction.consumer2.sanctioned_load_kw,
          connectionType: extraction.consumer2.connection_type,
          currentMonthUnits: extraction.consumer2.current_month_units,
          currentMonthBill: extraction.consumer2.current_month_bill,
          currentMonthDate: extraction.consumer2.current_month_date,
        },
        excelBase64,
        excelFilename: filename,
      });
    } catch (err) {
      req.log.error({ err }, "Unexpected error processing bill");
      res.status(500).json({ error: "An unexpected error occurred. Please try again." });
    }
  },
);

export default router;
