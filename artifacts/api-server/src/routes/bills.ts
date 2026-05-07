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

interface BillExtraction {
  units_consumed: number | null;
  connected_load: number | null;
  tariff_type: string | null;
  bill_month: string | null;
}

async function extractBillData(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<BillExtraction> {
  const prompt = `You are an expert at reading Indian electricity bills, especially MSEDCL (Maharashtra State Electricity Distribution Company Ltd) bills.

Extract the following data from this electricity bill:
1. units_consumed: The total units (kWh) consumed in this billing period. Look for "Units Consumed", "Total Units", "Net Units", or similar. Return as a number.
2. connected_load: The sanctioned/connected load in kW. Look for "Connected Load", "Sanctioned Load", or similar. Return as a number in kW.
3. tariff_type: The tariff category. Classify as exactly one of: "residential", "commercial", or "industrial".
4. bill_month: The billing month and year as a string like "January 2026".

Return ONLY a valid JSON object with exactly these 4 keys. If a value cannot be found, use null.
Example: {"units_consumed": 245, "connected_load": 2.5, "tariff_type": "residential", "bill_month": "March 2026"}`;

  const base64Data = fileBuffer.toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
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
  const parsed = JSON.parse(cleaned) as BillExtraction;

  return {
    units_consumed: typeof parsed.units_consumed === "number" ? parsed.units_consumed : null,
    connected_load: typeof parsed.connected_load === "number" ? parsed.connected_load : null,
    tariff_type: typeof parsed.tariff_type === "string" ? parsed.tariff_type : null,
    bill_month: typeof parsed.bill_month === "string" ? parsed.bill_month : null,
  };
}

function generateExcel(extraction: BillExtraction): Buffer {
  const wb = XLSX.utils.book_new();

  const units = extraction.units_consumed ?? 0;
  const load = extraction.connected_load ?? 0;
  const recommendedSolar = Math.ceil((units / 120) * 10) / 10;
  const estimatedSavings = units * 7;
  const paybackPeriod = estimatedSavings > 0 ? Math.round((50000 / estimatedSavings) * 10) / 10 : null;

  const rows = [
    ["Field", "Value", "Formula / Notes"],
    ["Average Monthly Units (kWh)", units, `${units} kWh`],
    ["Connected Load (kW)", load, `${load} kW`],
    ["Tariff Type", extraction.tariff_type ?? "N/A", ""],
    ["Bill Month", extraction.bill_month ?? "N/A", ""],
    ["Recommended Solar System (kW)", recommendedSolar, "=ROUNDUP(Units/120, 1)"],
    ["Estimated Monthly Savings (Rs)", estimatedSavings, "=Units * 7"],
    ["Payback Period (years)", paybackPeriod, "=ROUND(50000/Savings, 1)"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [{ wch: 35 }, { wch: 20 }, { wch: 30 }];

  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "10B981" } },
  };

  ["A1", "B1", "C1"].forEach((cell) => {
    if (ws[cell]) {
      ws[cell].s = headerStyle;
    }
  });

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

      let extraction: BillExtraction;
      try {
        extraction = await extractBillData(buffer, mimetype);
      } catch (err) {
        req.log.error({ err }, "Gemini extraction failed");
        res.status(500).json({ error: "AI extraction failed. Please try a clearer bill image." });
        return;
      }

      if (!extraction.units_consumed && !extraction.connected_load && !extraction.tariff_type) {
        res.status(422).json({ error: "Could not extract data from the bill. Try uploading a clearer image." });
        return;
      }

      const units = extraction.units_consumed ?? 0;
      const recommendedSolarKw = Math.ceil((units / 120) * 10) / 10;
      const estimatedMonthlySavings = units * 7;
      const paybackPeriodYears =
        estimatedMonthlySavings > 0
          ? Math.round((50000 / estimatedMonthlySavings) * 10) / 10
          : null;

      let excelBuffer: Buffer;
      try {
        excelBuffer = generateExcel(extraction);
      } catch (err) {
        req.log.error({ err }, "Excel generation failed");
        res.status(500).json({ error: "Failed to generate Excel report." });
        return;
      }

      const billMonth = extraction.bill_month ?? "Unknown";
      const safeMonth = billMonth.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `Solar_Report_${safeMonth}.xlsx`;
      const excelBase64 = excelBuffer.toString("base64");

      res.json({
        unitsConsumed: extraction.units_consumed,
        connectedLoad: extraction.connected_load,
        tariffType: extraction.tariff_type,
        billMonth: extraction.bill_month,
        recommendedSolarKw,
        estimatedMonthlySavings,
        paybackPeriodYears,
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
