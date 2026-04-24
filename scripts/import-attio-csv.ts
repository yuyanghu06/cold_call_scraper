#!/usr/bin/env tsx
// Import a CSV file (or a whole folder of CSVs) into Attio's Companies
// object using the same "upsert by Business Name, fill only empty fields"
// semantics as the in-app Google Places → Attio pipeline.
//
// Usage:
//   npm run import-csv -- path/to/file.csv                 (reads ATTIO_API_KEY from .env[.local])
//   npm run import-csv -- path/to/folder/                  (processes every .csv in the folder)
//   npm run import-csv -- <path> --caller "Yuyang"         (stamp every row with a Caller)
//   npm run import-csv -- <path> --yuyang                  (shorthand — one auto-flag per
//                                                           Caller option in Attio, e.g.
//                                                           "Jane Doe" → --jane-doe)
//   ATTIO_API_KEY=<key> npm run import-csv -- <path>       (explicit override)
//
// Expected CSV headers (case/space-insensitive; extra columns are ignored):
//   Business Name        → Attio `name` (match key). If col 0 has no header, col 0 is used.
//   Industry             → Attio `industry`
//   Result               → Attio `call_status`   (select — value must be an existing option)
//   Follow-up Number     → Attio `follow_up_number`
//   Owner Name           → Attio `owner_name`
//   Caller               → Attio `caller`        (select — value must be an existing option)
//   Notes                → Attio `notes`
//   Address              → Attio `address`
//
// --caller "<name>" stamps every row with that Caller. A non-empty Caller
// column in a given row overrides the CLI value for that row.
//
// Additionally, for each row the script calls Google Places (searchText) to
// look up the business and populates Territory from its state. Requires
// GOOGLE_PLACES_API_KEY in .env[.local]. If the key is missing, the step
// is skipped with a note and Territory stays empty.

import "./_load-env";
import fs from "node:fs";
import path from "node:path";
import {
  listAttributeOptions,
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
  caller: SLUG.caller,
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
  console.error("  npm run import-csv -- <path-to-csv-or-folder> [--caller \"<name>\"]");
  console.error("  npm run import-csv -- <path> --<first-name>       (shorthand, e.g. --yuyang)");
  console.error("  npx tsx scripts/import-attio-csv.ts <path> [--caller=<name>]");
  process.exit(1);
}

interface ParsedCsv {
  filename: string;
  inputs: CsvUpsertInput[];
  skippedRowLines: number[];
  unknownCols: string[];
  emailInFollowUp: number;
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function parseCsvFile(csvPath: string): ParsedCsv {
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error(`${path.basename(csvPath)}: no data rows`);
  }

  const [header, ...dataRows] = rows;
  const normalized = header.map(normalizeHeader);

  // If col 0's header is blank, treat it as Business Name — some source
  // sheets (e.g. Google Sheets rep trackers) leave the name column unnamed.
  if (normalized[0] === "" && !normalized.includes("business_name")) {
    normalized[0] = "business_name";
  }

  const nameCol = normalized.indexOf("business_name");
  if (nameCol === -1) {
    throw new Error(
      `${path.basename(csvPath)}: missing 'Business Name' column`,
    );
  }

  const inputs: CsvUpsertInput[] = [];
  const skippedRowLines: number[] = [];
  let emailInFollowUp = 0;
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const values: Record<string, unknown> = {};
    for (let i = 0; i < normalized.length; i++) {
      const slug = CSV_HEADER_TO_SLUG[normalized[i]];
      if (!slug) continue;
      const raw = (row[i] ?? "").trim();
      if (!raw) continue;
      values[slug] = raw;
      if (slug === SLUG.followUpNumber && looksLikeEmail(raw)) emailInFollowUp++;
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
    emailInFollowUp,
  };
}

interface EnrichmentSummary {
  lookedUp: number;
  filled: number;
  skippedOutOfRegion: number;
  errors: string[];
}

// Only these Territory values get written — anything Google resolves to
// some other state is left blank. Keep in sync with whichever Territory
// options the sales team actually staffs in Attio.
const ALLOWED_TERRITORIES = new Set(["New York", "Tennessee"]);

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
    skippedOutOfRegion: 0,
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
          if (!state) continue;
          const territory = normalizeTerritory(state);
          if (!ALLOWED_TERRITORIES.has(territory)) {
            summary.skippedOutOfRegion++;
            continue;
          }
          input.values[SLUG.territory] = [territory];
          summary.filled++;
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

interface CliArgs {
  target: string;
  caller: string | null;
  // Unrecognized long flags (e.g. `--yuyang`) collected here; resolved against
  // live Attio Caller options after we can query the API.
  unresolvedFlags: string[];
}

function parseCliArgs(argv: string[]): CliArgs {
  let target: string | null = null;
  let caller: string | null = null;
  const unresolvedFlags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--caller") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) usage("--caller requires a value");
      caller = next.trim();
      if (!caller) usage("--caller value cannot be blank");
      i++;
    } else if (a.startsWith("--caller=")) {
      caller = a.slice("--caller=".length).trim();
      if (!caller) usage("--caller value cannot be blank");
    } else if (a.startsWith("--")) {
      unresolvedFlags.push(a);
    } else if (!target) {
      target = a;
    } else {
      usage(`unexpected argument: ${a}`);
    }
  }
  if (!target) usage("missing CSV or folder path");
  return { target: target!, caller, unresolvedFlags };
}

// "Jane Doe" → "jane-doe"; used to match shorthand flags like --jane-doe.
function flagKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveCallerFlag(
  flag: string,
  callerOptions: string[],
): string | "ambiguous" | "unknown" {
  const key = flag.replace(/^--/, "");
  const matches = callerOptions.filter((opt) => flagKey(opt) === key);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return "ambiguous";
  return "unknown";
}

async function main(): Promise<void> {
  const { target, caller: callerFlagValue, unresolvedFlags } =
    parseCliArgs(process.argv.slice(2));
  let caller: string | null = callerFlagValue;

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

  // Pre-parse all CSVs so we can validate select-attribute values (Call Status,
  // Caller) against Attio's live option titles before we hit the API with any
  // writes. Cheaper to fail fast than to watch every row 400.
  const parsedFiles: ParsedCsv[] = [];
  for (const csvPath of csvPaths) {
    try {
      parsedFiles.push(parseCsvFile(csvPath));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Skipped: ${msg}`);
    }
  }

  const [callStatusOptions, callerOptions] = await Promise.all([
    listAttributeOptions(apiKey!, SLUG.callStatus).catch(() => [] as string[]),
    listAttributeOptions(apiKey!, SLUG.caller).catch(() => [] as string[]),
  ]);

  // Resolve shorthand flags like --yuyang against live Caller options.
  for (const flag of unresolvedFlags) {
    if (callerOptions.length === 0) {
      usage(
        `unknown flag ${flag} (could not fetch Caller options to resolve shorthand flags)`,
      );
    }
    const resolved = resolveCallerFlag(flag, callerOptions);
    if (resolved === "unknown") {
      console.error(`Error: unknown flag ${flag}.`);
      console.error(
        `  Caller shorthand flags available: ${callerOptions.map((o) => `--${flagKey(o)}`).join(", ")}`,
      );
      process.exit(1);
    }
    if (resolved === "ambiguous") {
      console.error(
        `Error: flag ${flag} matches multiple Caller options — use --caller "<name>" instead.`,
      );
      process.exit(1);
    }
    if (caller && caller !== resolved) {
      console.error(
        `Error: conflicting Caller values — "${caller}" (from --caller) vs "${resolved}" (from ${flag}).`,
      );
      process.exit(1);
    }
    caller = resolved;
  }

  if (caller) {
    if (callerOptions.length === 0) {
      console.log(
        `Warning: could not fetch Caller options to validate --caller "${caller}". Proceeding anyway.`,
      );
    } else if (!callerOptions.includes(caller)) {
      console.error(
        `Error: --caller "${caller}" is not an existing Caller option in Attio.`,
      );
      console.error(`  Available: ${callerOptions.join(", ")}`);
      process.exit(1);
    }
  }

  if (callStatusOptions.length > 0) {
    const seen = new Set<string>();
    for (const pf of parsedFiles) {
      for (const input of pf.inputs) {
        const v = input.values[SLUG.callStatus];
        if (typeof v === "string" && v) seen.add(v);
      }
    }
    const unknown = [...seen].filter((v) => !callStatusOptions.includes(v));
    if (unknown.length > 0) {
      console.error(
        `Error: Call Status (Result column) values not present in Attio: ${unknown.join(", ")}`,
      );
      console.error(`  Available: ${callStatusOptions.join(", ")}`);
      console.error(
        "  Add the missing options in Attio, or edit the CSV, then re-run.",
      );
      process.exit(1);
    }
  }

  const totals = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    total: 0,
    errors: [] as string[],
  };

  for (const parsed of parsedFiles) {
    const header = isBatch
      ? `\n─── ${parsed.filename} ───`
      : "";
    if (header) console.log(header);

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
    if (parsed.emailInFollowUp > 0) {
      console.log(
        `Note: ${parsed.emailInFollowUp} Follow-up Number value${parsed.emailInFollowUp === 1 ? "" : "s"} look${parsed.emailInFollowUp === 1 ? "s" : ""} like an email. Written to follow_up_number verbatim (Attio has no separate email column today).`,
      );
    }
    if (parsed.inputs.length === 0) continue;

    // Stamp the CLI-level Caller on every row that doesn't already have one.
    if (caller) {
      for (const input of parsed.inputs) {
        if (!input.values[SLUG.caller]) input.values[SLUG.caller] = caller;
      }
    }

    if (googleApiKey) {
      console.log(
        `Looking up state via Google Places for ${parsed.inputs.length} business${parsed.inputs.length === 1 ? "" : "es"}…`,
      );
      const enrichment = await enrichRowsWithState(parsed.inputs, googleApiKey);
      const skippedPart =
        enrichment.skippedOutOfRegion > 0
          ? `; ${enrichment.skippedOutOfRegion} outside NY/TN (left blank)`
          : "";
      const errorPart =
        enrichment.errors.length > 0
          ? `; ${enrichment.errors.length} lookup error${enrichment.errors.length === 1 ? "" : "s"}`
          : "";
      console.log(
        `  → Filled Territory on ${enrichment.filled} of ${enrichment.lookedUp}${skippedPart}${errorPart}.`,
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
