#!/usr/bin/env tsx
// Import a CSV file (or a whole folder of CSVs) into Attio's Companies
// object using the same "upsert by Business Name, fill only empty fields"
// semantics as the in-app Google Places → Attio pipeline.
//
// Usage:
//   npm run import-csv -- path/to/file.csv         (reads ATTIO_API_KEY from .env[.local])
//   npm run import-csv -- path/to/folder/          (processes every .csv in the folder)
//   ATTIO_API_KEY=<key> npm run import-csv -- <path>   (explicit override)
//
// Expected CSV headers (case/space-insensitive; extra columns are ignored):
//   Business Name        → matched to Attio's Company name (match key)
//   Industry             → Attio `industry`
//   Result               → Attio `call_status`
//   Follow-up Number     → Attio `follow_up_number`
//   Owner Name           → Attio `owner_name`
//   Notes                → Attio `notes`
//   Address              → Attio `address`
//
// Additionally, for each row the script calls Google Places (searchText) to
// look up the business and populates Territory from its state. Requires
// GOOGLE_PLACES_API_KEY in .env[.local]. If the key is missing, the step
// is skipped with a note and Territory stays empty.
//
// "Follow-up" (email) is not mapped — Attio has no matching column today. If
// you add one, add a corresponding slug to SLUG in lib/attio.ts and an entry
// to CSV_HEADER_TO_SLUG below.

import "./_load-env";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeTerritory,
  pushCsvRowsToAttio,
  SLUG,
  type CsvUpsertInput,
} from "../lib/services/attioService";
import { findStateByBusinessName } from "../lib/services/searchService";

// Map normalized CSV header → Attio slug. Headers are normalized via
// `normalizeHeader` below (lowercased, non-alphanumerics → underscore).
const CSV_HEADER_TO_SLUG: Record<string, string> = {
  business_name: SLUG.name,
  industry: SLUG.industry,
  result: SLUG.callStatus,
  follow_up_number: SLUG.followUpNumber,
  owner_name: SLUG.ownerName,
  notes: SLUG.notes,
  address: SLUG.address,
};

function normalizeHeader(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// RFC 4180-ish CSV parser. Handles quoted fields (including commas and
// doubled-up "" escapes) and both CRLF / LF line endings. Unquoted fields
// are taken verbatim. No support for multi-line quoted fields with embedded
// newlines beyond what the state machine below gives for free.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r" && text[i + 1] === "\n") {
        row.push(field);
        rows.push(row);
        field = "";
        row = [];
        i++;
      } else if (c === "\n" || c === "\r") {
        row.push(field);
        rows.push(row);
        field = "";
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error("Usage:");
  console.error("  npm run import-csv -- <path-to-csv-or-folder>");
  console.error("  npx tsx scripts/import-attio-csv.ts <path>");
  process.exit(1);
}

interface ParsedCsv {
  filename: string;
  inputs: CsvUpsertInput[];
  skippedRowLines: number[];
  unknownCols: string[];
}

function parseCsvFile(csvPath: string): ParsedCsv {
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error(`${path.basename(csvPath)}: no data rows`);
  }

  const [header, ...dataRows] = rows;
  const normalized = header.map(normalizeHeader);
  const nameCol = normalized.indexOf("business_name");
  if (nameCol === -1) {
    throw new Error(
      `${path.basename(csvPath)}: missing 'Business Name' column`,
    );
  }

  const inputs: CsvUpsertInput[] = [];
  const skippedRowLines: number[] = [];
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const values: Record<string, unknown> = {};
    for (let i = 0; i < normalized.length; i++) {
      const slug = CSV_HEADER_TO_SLUG[normalized[i]];
      if (!slug) continue;
      const raw = (row[i] ?? "").trim();
      if (!raw) continue;
      values[slug] = raw;
    }
    const name = values[SLUG.name];
    if (typeof name !== "string" || !name.trim()) {
      skippedRowLines.push(r + 2); // +2: header + 1-indexed
      continue;
    }
    inputs.push({ values });
  }

  const unknownCols = normalized.filter(
    (h) => h && !(h in CSV_HEADER_TO_SLUG),
  );

  return {
    filename: path.basename(csvPath),
    inputs,
    skippedRowLines,
    unknownCols,
  };
}

interface EnrichmentSummary {
  lookedUp: number;
  filled: number;
  errors: string[];
}

// For each row, query Google Places for the business and extract its state
// from administrative_area_level_1. Skips rows whose Territory slot is
// already populated (e.g. if a future CSV adds that column). Runs with
// bounded concurrency since Google Places is rate-limited per project.
async function enrichRowsWithState(
  inputs: CsvUpsertInput[],
  googleApiKey: string,
): Promise<EnrichmentSummary> {
  const CONCURRENCY = 5;
  const summary: EnrichmentSummary = {
    lookedUp: 0,
    filled: 0,
    errors: [],
  };

  const queue = inputs
    .filter((i) => !i.values[SLUG.territory])
    .map((i) => i);
  summary.lookedUp = queue.length;

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const input = queue.shift();
        if (!input) break;
        const name =
          typeof input.values[SLUG.name] === "string"
            ? (input.values[SLUG.name] as string)
            : "";
        if (!name) continue;
        const address =
          typeof input.values[SLUG.address] === "string"
            ? (input.values[SLUG.address] as string)
            : null;
        try {
          const state = await findStateByBusinessName(
            googleApiKey,
            name,
            address,
          );
          if (state) {
            input.values[SLUG.territory] = [normalizeTerritory(state)];
            summary.filled++;
          }
        } catch (err) {
          summary.errors.push(
            `${name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
  );
  await Promise.all(workers);
  return summary;
}

function resolveCsvPaths(resolved: string): string[] {
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory()) usage(`not a file or directory: ${resolved}`);

  const files = fs
    .readdirSync(resolved)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(resolved, f))
    .sort();
  if (files.length === 0) usage(`no .csv files in ${resolved}`);
  return files;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) usage("missing CSV or folder path");

  const apiKey = process.env.ATTIO_API_KEY;
  if (!apiKey || !apiKey.trim()) usage("ATTIO_API_KEY env var is not set");

  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleApiKey || !googleApiKey.trim()) {
    console.log(
      "Note: GOOGLE_PLACES_API_KEY not set — Territory lookup will be skipped.\n",
    );
  }

  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) usage(`path not found: ${resolved}`);

  const csvPaths = resolveCsvPaths(resolved);
  const isBatch = csvPaths.length > 1;

  if (isBatch) {
    console.log(`Processing ${csvPaths.length} CSV files from ${resolved}\n`);
  }

  const totals = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    total: 0,
    errors: [] as string[],
  };

  for (const csvPath of csvPaths) {
    const header = isBatch
      ? `\n─── ${path.basename(csvPath)} ───`
      : "";
    if (header) console.log(header);

    let parsed: ParsedCsv;
    try {
      parsed = parseCsvFile(csvPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Skipped: ${msg}`);
      totals.errors.push(msg);
      continue;
    }

    console.log(
      `Parsed ${parsed.inputs.length} rows from ${parsed.filename}.` +
        (parsed.skippedRowLines.length > 0
          ? ` Skipped ${parsed.skippedRowLines.length} row${parsed.skippedRowLines.length === 1 ? "" : "s"} with no Business Name (line${parsed.skippedRowLines.length === 1 ? "" : "s"} ${parsed.skippedRowLines.slice(0, 10).join(", ")}${parsed.skippedRowLines.length > 10 ? ", …" : ""}).`
          : ""),
    );
    if (parsed.unknownCols.length > 0) {
      console.log(
        `Ignored ${parsed.unknownCols.length} unknown column${parsed.unknownCols.length === 1 ? "" : "s"}: ${parsed.unknownCols.join(", ")}`,
      );
    }
    if (parsed.inputs.length === 0) continue;

    if (googleApiKey) {
      console.log(
        `Looking up state via Google Places for ${parsed.inputs.length} business${parsed.inputs.length === 1 ? "" : "es"}…`,
      );
      const enrichment = await enrichRowsWithState(parsed.inputs, googleApiKey);
      console.log(
        `  → Filled Territory on ${enrichment.filled} of ${enrichment.lookedUp}${enrichment.errors.length > 0 ? `; ${enrichment.errors.length} lookup error${enrichment.errors.length === 1 ? "" : "s"}` : ""}.`,
      );
      if (enrichment.errors.length > 0) {
        const shown = enrichment.errors.slice(0, 3);
        for (const e of shown) console.log(`    — ${e}`);
        if (enrichment.errors.length > shown.length) {
          console.log(
            `    … and ${enrichment.errors.length - shown.length} more`,
          );
        }
      }
    }

    console.log("Syncing to Attio…");
    const result = await pushCsvRowsToAttio(apiKey, parsed.inputs);
    console.log(
      `  → ${result.created} created, ${result.updated} filled, ${result.skipped} unchanged, ${result.failed} failed (of ${result.total}).`,
    );
    if (result.errors.length > 0) {
      const shown = result.errors.slice(0, 5);
      for (const e of shown) console.log(`    — ${e}`);
      if (result.errors.length > shown.length) {
        console.log(`    … and ${result.errors.length - shown.length} more`);
      }
    }

    totals.created += result.created;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    totals.total += result.total;
    totals.errors.push(
      ...result.errors.map((e) => `${parsed.filename}: ${e}`),
    );
  }

  if (isBatch) {
    console.log("\n═══ Totals ═══");
    console.log(
      `${totals.created} created, ${totals.updated} filled, ${totals.skipped} unchanged, ${totals.failed} failed (of ${totals.total}) across ${csvPaths.length} files.`,
    );
  }

  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
