# Energybase Solar Calculator

A web app that reads electricity bills (PDF or image) using AI, extracts key data, and generates a downloadable solar recommendation Excel report.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/energybase run dev` — run the frontend (port 20893)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (Tailwind CSS, shadcn/ui, framer-motion)
- API: Express 5
- AI: Google Gemini 2.5 Flash (via Replit AI Integrations — no user API key needed)
- Excel: xlsx (SheetJS)
- File uploads: multer (in-memory storage, 10MB limit)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated Zod schemas
- `lib/integrations-gemini-ai/` — Gemini AI SDK wrapper
- `artifacts/api-server/src/routes/bills.ts` — bill processing route
- `artifacts/energybase/src/` — frontend React app

## Architecture decisions

- File uploads use `multer` with in-memory storage (no disk writes); files are passed directly as base64 to Gemini vision API
- Gemini 2.5 Flash is used for bill OCR extraction with a JSON response mode prompt tuned for Indian MSEDCL bills
- Excel is generated server-side with SheetJS and returned as base64 in the JSON response; the client decodes and triggers a browser download
- `@google/genai` is marked external in esbuild config, so it must be a direct dependency of api-server (not just a transitive dep)
- The file upload endpoint uses raw fetch + FormData on the frontend (not the generated Orval hook) because multipart uploads require custom handling

## Product

- Upload electricity bill (PDF or image, max 10MB)
- AI extracts: units consumed, connected load, tariff type, bill month
- Computed fields: recommended solar system kW, estimated monthly savings (₹), payback period (years)
- Download filled Excel report with solar calculations

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, always re-run codegen before using updated types
- `@google/genai` must be a direct `dependency` in `artifacts/api-server/package.json` because it's externalized in esbuild config
- Do NOT use `export * from "./generated/types"` in `lib/api-zod/src/index.ts` — Orval also exports the same names from `./generated/api`, causing duplicate export errors. Use named type re-exports instead.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
