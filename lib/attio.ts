import type { Place } from "./types";

const ATTIO_BASE = "https://api.attio.com/v2";

// Attio's write-side rate limit is 25 req/s per workspace. Pace at 20 req/s
// to leave ~20% headroom for other workspace traffic and clock skew. 429
// responses are still retried once the Retry-After date passes.
// Source: https://docs.attio.com/rest-api/guides/rate-limiting
const WRITE_RATE_PER_SEC = 20;
const PACE_INTERVAL_MS = Math.ceil(1000 / WRITE_RATE_PER_SEC); // 50ms
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 4;

// Attribute slugs on the Attio Companies object. Adjust if the workspace uses
// different slugs — select options ("Cold Lead" / "No" / "Low") must match the
// option titles configured in Attio exactly.
//
// Attribute types in our workspace (matters for payload shape):
//   - territory: MULTI-SELECT → value must be an array of option titles
//   - stage / signed / warmth: single-select → plain string
// If Attio later returns a `validation_type` 400 for one of these, flip the
// corresponding write below between scalar and array form.
// If Attio auto-slugs any of these differently in your workspace (e.g.
// "Company Number" → `company_number` vs `companynumber`), change the string
// here. To find the real slug: Attio → Companies → that column → "Edit
// property" → API slug.
export const SLUG = {
  name: "name",
  googleId: "googleid", // stable unique key from Google Places
  territory: "territory",
  stage: "stage",
  signed: "signed",
  warmth: "warmth",
  industry: "industry",
  // Added for the Google Places → Attio pipeline:
  address: "address",
  // Attio's built-in location attribute on every Company — shows up in the
  // right-rail "Primary location" card. Expects a structured object with
  // line_1, locality, region, postcode, country_code, latitude, longitude.
  primaryLocation: "primary_location",
  // NOTE: Attio's slug is "store_number" — the column was originally created
  // under a different name and renamed to "Company Number"; Attio doesn't
  // update slugs on rename. Verified via `npm run list-slugs`.
  companyNumber: "store_number", // place.phone (main business line)
  // Added for the CSV import script + manual create form:
  callStatus: "call_status", // CSV "Result" column
  followUpNumber: "follow_up_number",
  ownerName: "owner_name",
  notes: "notes",
} as const;

// Google Places returns US states as two-letter codes ("NY", "CA"), but Attio's
// Territory select options are full state names ("New York"). Map before send.
// Unknown values pass through unchanged — non-US searches will surface an Attio
// 400, which is expected for a US-only tool.
const US_STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands",
  AS: "American Samoa", MP: "Northern Mariana Islands",
};

export function normalizeTerritory(state: string): string {
  const upper = state.trim().toUpperCase();
  return US_STATE_ABBR_TO_NAME[upper] ?? state;
}

export interface AttioPushResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  errors: string[];
}

type Outcome = "created" | "updated" | "skipped";

// Shape of a record returned by the Attio query endpoint. We only read the
// record id and value arrays — any further shape details are Attio's business.
type AttioValueEntry = Record<string, unknown>;
interface AttioRecord {
  id: { record_id: string };
  values: Record<string, AttioValueEntry[] | undefined>;
}

// Normalized record for the tracking UI. All fields are flattened out of
// Attio's entry-array shape into plain strings / string arrays so the frontend
// doesn't need to know anything about Attio internals.
export interface TrackingCompany {
  id: string;
  name: string | null;
  territory: string[];
  callStatus: string | null;
  industry: string | null;
  address: string | null;
  ownerName: string | null;
  followUpNumber: string | null;
  notes: string | null;
}

export interface ListCompaniesParams {
  territory?: string[] | null;
  callStatus?: string[] | null;
  industry?: string[] | null;
  limit?: number;
  offset?: number;
}

export interface ListCompaniesResult {
  companies: TrackingCompany[];
  nextOffset: number | null;
}

export async function listTrackingCompanies(
  apiKey: string,
  params: ListCompaniesParams,
): Promise<ListCompaniesResult> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  // Attio accepts `{slug: "X"}` as scalar equality. For multi-value filters we
  // combine per-value equality clauses with $or — works for both text select
  // attributes and multi-select attributes (matches if any listed value is in
  // the record's option set).
  const andClauses: Record<string, unknown>[] = [];
  const territoryValues = (params.territory ?? []).filter(Boolean);
  const callStatusValues = (params.callStatus ?? []).filter(Boolean);
  const industryValues = (params.industry ?? []).filter(Boolean);
  if (territoryValues.length === 1) {
    andClauses.push({ [SLUG.territory]: territoryValues[0] });
  } else if (territoryValues.length > 1) {
    andClauses.push({
      $or: territoryValues.map((v) => ({ [SLUG.territory]: v })),
    });
  }
  if (callStatusValues.length === 1) {
    andClauses.push({ [SLUG.callStatus]: callStatusValues[0] });
  } else if (callStatusValues.length > 1) {
    andClauses.push({
      $or: callStatusValues.map((v) => ({ [SLUG.callStatus]: v })),
    });
  }
  if (industryValues.length === 1) {
    andClauses.push({ [SLUG.industry]: industryValues[0] });
  } else if (industryValues.length > 1) {
    andClauses.push({
      $or: industryValues.map((v) => ({ [SLUG.industry]: v })),
    });
  }

  const body: Record<string, unknown> = { limit, offset };
  if (andClauses.length === 1) body.filter = andClauses[0];
  else if (andClauses.length > 1) body.filter = { $and: andClauses };

  const res = await attioRequest(
    apiKey,
    "POST",
    "/objects/companies/records/query",
    body,
    pace,
  );
  const data = (await res.json()) as { data?: AttioRecord[] };
  const rows = data.data ?? [];
  const companies = rows.map(normalizeTrackingCompany);
  const nextOffset = rows.length === limit ? offset + rows.length : null;
  return { companies, nextOffset };
}

function normalizeTrackingCompany(record: AttioRecord): TrackingCompany {
  const v = record.values;
  return {
    id: record.id.record_id,
    name: readText(v[SLUG.name]),
    territory: readMultiSelect(v[SLUG.territory]),
    callStatus: readSelect(v[SLUG.callStatus]),
    industry: readText(v[SLUG.industry]) ?? readSelect(v[SLUG.industry]),
    address: readText(v[SLUG.address]),
    ownerName: readText(v[SLUG.ownerName]),
    followUpNumber: readText(v[SLUG.followUpNumber]),
    notes: readText(v[SLUG.notes]),
  };
}

// Attio's select/multi-select entries put the option title under `value.option.title`
// in some responses and under `option.title` in others, depending on API version.
// Probe both, return the first string we find.
function readSelect(entries: AttioValueEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;
  for (const e of entries) {
    const title = extractOptionTitle(e);
    if (title) return title;
  }
  return null;
}

function readMultiSelect(entries: AttioValueEntry[] | undefined): string[] {
  if (!entries || entries.length === 0) return [];
  const out: string[] = [];
  for (const e of entries) {
    const title = extractOptionTitle(e);
    if (title) out.push(title);
  }
  return out;
}

function extractOptionTitle(e: AttioValueEntry): string | null {
  const direct = (e as { option?: { title?: unknown } }).option?.title;
  if (typeof direct === "string" && direct) return direct;
  const nested = (e as { value?: { option?: { title?: unknown } } }).value
    ?.option?.title;
  if (typeof nested === "string" && nested) return nested;
  // Fallback: some text-ish fields may land in a select slot during migrations.
  const v = (e as { value?: unknown }).value;
  if (typeof v === "string" && v) return v;
  return null;
}

function readText(entries: AttioValueEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;
  for (const e of entries) {
    const v = (e as { value?: unknown }).value;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export interface TrackingUpdate {
  name?: string | null;
  territory?: string[];
  callStatus?: string | null;
  industry?: string | null;
  address?: string | null;
  ownerName?: string | null;
  followUpNumber?: string | null;
  notes?: string | null;
}

export async function updateTrackingCompany(
  apiKey: string,
  recordId: string,
  update: TrackingUpdate,
): Promise<TrackingCompany> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const values: Record<string, unknown> = {};
  if (update.name !== undefined) {
    // Attio requires a non-empty name — reject clears here rather than at Attio.
    const trimmed = (update.name ?? "").trim();
    if (!trimmed) throw new Error("Business name cannot be empty");
    values[SLUG.name] = trimmed;
  }
  if (update.territory !== undefined) {
    values[SLUG.territory] = update.territory.map(normalizeTerritory);
  }
  if (update.callStatus !== undefined) {
    values[SLUG.callStatus] = update.callStatus ?? "";
  }
  if (update.industry !== undefined) {
    values[SLUG.industry] = update.industry ?? "";
  }
  if (update.address !== undefined) {
    values[SLUG.address] = update.address ?? "";
  }
  if (update.ownerName !== undefined) {
    values[SLUG.ownerName] = update.ownerName ?? "";
  }
  if (update.followUpNumber !== undefined) {
    values[SLUG.followUpNumber] = update.followUpNumber ?? "";
  }
  if (update.notes !== undefined) {
    values[SLUG.notes] = update.notes ?? "";
  }
  if (Object.keys(values).length === 0) {
    // Nothing to write — just re-read.
    return getTrackingCompany(apiKey, recordId);
  }

  const res = await attioRequest(
    apiKey,
    "PATCH",
    `/objects/companies/records/${recordId}`,
    { data: { values } },
    pace,
  );
  const data = (await res.json()) as { data?: AttioRecord };
  if (!data.data) throw new Error("Attio: empty PATCH response");
  return normalizeTrackingCompany(data.data);
}

async function getTrackingCompany(
  apiKey: string,
  recordId: string,
): Promise<TrackingCompany> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const res = await attioRequest(
    apiKey,
    "GET",
    `/objects/companies/records/${recordId}`,
    undefined,
    pace,
  );
  const data = (await res.json()) as { data?: AttioRecord };
  if (!data.data) throw new Error("Attio: record not found");
  return normalizeTrackingCompany(data.data);
}

// Fetches the list of select options for one of the select/multi-select
// attributes (e.g. Territory, Call Status). Used to populate filter + edit
// dropdowns on the tracking page.
export async function listAttributeOptions(
  apiKey: string,
  attributeSlug: string,
): Promise<string[]> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const res = await attioRequest(
    apiKey,
    "GET",
    `/objects/companies/attributes/${attributeSlug}/options`,
    undefined,
    pace,
  );
  const data = (await res.json()) as {
    data?: Array<{ title?: string; is_archived?: boolean }>;
  };
  return (data.data ?? [])
    .filter((o) => !o.is_archived && typeof o.title === "string" && o.title)
    .map((o) => o.title!) ;
}

export async function pushPlacesToAttio(
  apiKey: string,
  places: Place[],
): Promise<AttioPushResult> {
  const result: AttioPushResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    total: places.length,
    errors: [],
  };
  if (places.length === 0) return result;

  const pace = createPacer(PACE_INTERVAL_MS);
  const queue = [...places];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (true) {
        const p = queue.shift();
        if (!p) break;
        try {
          const outcome = await upsertOne(apiKey, p, pace);
          result[outcome]++;
        } catch (err) {
          result.failed++;
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`${p.name}: ${msg}`);
        }
      }
    },
  );
  await Promise.all(workers);
  return result;
}

async function upsertOne(
  apiKey: string,
  place: Place,
  pace: () => Promise<void>,
): Promise<Outcome> {
  // Primary match by google_id — the stable unique key going forward.
  let existing = await findCompanyByGoogleId(apiKey, place.placeId, pace);
  let needsGoogleIdBackfill = false;

  // Fallback for legacy rows created before google_id was wired up: match by
  // name, but only adopt the row if its google_id is still empty. If the
  // name-matched row already has a *different* google_id, that's a legit
  // name collision between two different businesses — fall through to create
  // a new row instead of overwriting the other company's id.
  if (!existing) {
    const nameMatch = await findCompanyByName(apiKey, place.name, pace);
    if (nameMatch && isFieldEmpty(nameMatch.values[SLUG.googleId])) {
      existing = nameMatch;
      needsGoogleIdBackfill = true;
    }
  }

  if (!existing) {
    await createCompanyRecord(apiKey, place, pace);
    return "created";
  }

  const updates = buildUpdatePayload(place, existing.values);
  if (needsGoogleIdBackfill) {
    updates[SLUG.googleId] = place.placeId;
  }
  if (Object.keys(updates).length === 0) {
    return "skipped";
  }
  await patchCompanyRecord(apiKey, existing.id.record_id, updates, pace);
  return "updated";
}

// ─── CSV import path ──────────────────────────────────────────────────────
//
// For rows imported from a spreadsheet (see scripts/import-attio-csv.ts).
// Match key is Business Name (SLUG.name); there's no google_id to work with.
// Same "fill only if empty" semantics as the Google Places path.

export interface CsvUpsertInput {
  /** Full field map. Must include SLUG.name; any other slug is optional. */
  values: Record<string, unknown>;
}

export async function pushCsvRowsToAttio(
  apiKey: string,
  inputs: CsvUpsertInput[],
): Promise<AttioPushResult> {
  const result: AttioPushResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    total: inputs.length,
    errors: [],
  };
  if (inputs.length === 0) return result;

  const pace = createPacer(PACE_INTERVAL_MS);
  const queue = [...inputs];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (true) {
        const input = queue.shift();
        if (!input) break;
        const label =
          typeof input.values[SLUG.name] === "string"
            ? (input.values[SLUG.name] as string)
            : "<unnamed>";
        try {
          const outcome = await upsertCsvRow(apiKey, input, pace);
          result[outcome]++;
        } catch (err) {
          result.failed++;
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`${label}: ${msg}`);
        }
      }
    },
  );
  await Promise.all(workers);
  return result;
}

async function upsertCsvRow(
  apiKey: string,
  input: CsvUpsertInput,
  pace: () => Promise<void>,
): Promise<Outcome> {
  const name = input.values[SLUG.name];
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("row missing Business Name");
  }

  const existing = await findCompanyByName(apiKey, name, pace);
  if (!existing) {
    await attioRequest(
      apiKey,
      "POST",
      "/objects/companies/records",
      { data: { values: input.values } },
      pace,
    );
    return "created";
  }

  const updates: Record<string, unknown> = {};
  for (const [slug, value] of Object.entries(input.values)) {
    if (slug === SLUG.name) continue; // match key / display name — never overwrite
    if (value === undefined || value === null || value === "") continue;
    if (isFieldEmpty(existing.values[slug])) {
      updates[slug] = value;
    }
  }

  if (Object.keys(updates).length === 0) return "skipped";

  await attioRequest(
    apiKey,
    "PATCH",
    `/objects/companies/records/${existing.id.record_id}`,
    { data: { values: updates } },
    pace,
  );
  return "updated";
}

// ─────────────────────────────────────────────────────────────────────────

function buildCreateValues(place: Place): Record<string, unknown> {
  const values: Record<string, unknown> = {
    [SLUG.name]: place.name,
    [SLUG.googleId]: place.placeId,
    [SLUG.stage]: "Cold Lead",
    [SLUG.signed]: "No",
    [SLUG.warmth]: "Low",
    [SLUG.callStatus]: "Not called yet",
  };
  if (place.state) values[SLUG.territory] = [normalizeTerritory(place.state)];
  if (place.industry) values[SLUG.industry] = place.industry;
  if (place.address) values[SLUG.address] = place.address;
  if (place.phone) values[SLUG.companyNumber] = place.phone;
  const location = buildLocationPayload(place);
  if (location) values[SLUG.primaryLocation] = location;
  return values;
}

// Map Google Places components into Attio's location attribute shape. Attio's
// location values are objects with: line_1..line_4, locality (city),
// region (state), postcode, country_code, latitude, longitude. Returns null
// if nothing useful is available.
//
// line_1 is a best-effort street line: Google's formattedAddress puts street
// before the first comma ("123 Main St, New York, NY 10001, USA"), so we split
// on "," and take the first non-empty piece. Falls back to the full formatted
// address if that heuristic yields nothing.
function buildLocationPayload(place: Place): Record<string, unknown> | null {
  const street = extractStreetLine(place.address) ?? place.address ?? null;
  // country shortText from Google Places is already ISO-3166 alpha-2 ("US").
  const countryCode =
    place.country && /^[A-Za-z]{2}$/.test(place.country)
      ? place.country.toUpperCase()
      : null;
  const payload: Record<string, unknown> = {
    line_1: street || null,
    line_2: null,
    line_3: null,
    line_4: null,
    locality: place.city ?? null,
    region: place.state ?? null,
    postcode: place.zip ?? null,
    country_code: countryCode,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
  };
  // Bail if nothing substantive — Attio doesn't want an empty location object.
  if (
    !payload.line_1 &&
    !payload.locality &&
    !payload.region &&
    !payload.postcode &&
    payload.latitude === null
  ) {
    return null;
  }
  return payload;
}

function extractStreetLine(formattedAddress: string | null | undefined): string | null {
  if (!formattedAddress) return null;
  const first = formattedAddress.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// Only include fields that are currently empty on the existing record.
// Preserves rep progress: e.g. if Stage is already "Onboarding", we don't
// overwrite it back to "Cold Lead".
function buildUpdatePayload(
  place: Place,
  existing: Record<string, AttioValueEntry[] | undefined>,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  // google_id is the match key (the record was found by it, so it's already
  // set). name is the primary display label — never auto-overwrite a rep's
  // curated name with whatever Google currently returns.
  if (isFieldEmpty(existing[SLUG.stage])) updates[SLUG.stage] = "Cold Lead";
  if (isFieldEmpty(existing[SLUG.signed])) updates[SLUG.signed] = "No";
  if (isFieldEmpty(existing[SLUG.warmth])) updates[SLUG.warmth] = "Low";
  if (isFieldEmpty(existing[SLUG.callStatus])) {
    updates[SLUG.callStatus] = "Not called yet";
  }
  if (isFieldEmpty(existing[SLUG.territory]) && place.state) {
    updates[SLUG.territory] = [normalizeTerritory(place.state)];
  }
  if (isFieldEmpty(existing[SLUG.industry]) && place.industry) {
    updates[SLUG.industry] = place.industry;
  }
  if (isFieldEmpty(existing[SLUG.address]) && place.address) {
    updates[SLUG.address] = place.address;
  }
  if (isFieldEmpty(existing[SLUG.companyNumber]) && place.phone) {
    updates[SLUG.companyNumber] = place.phone;
  }
  if (isFieldEmpty(existing[SLUG.primaryLocation])) {
    const location = buildLocationPayload(place);
    if (location) updates[SLUG.primaryLocation] = location;
  }
  return updates;
}

// Attio returns each attribute as an array of value entries. Unset → empty
// array (or the slug missing from `values` entirely). Defensive: also treat
// entries whose value/option payload is null-ish as empty.
function isFieldEmpty(entries: AttioValueEntry[] | undefined): boolean {
  if (!entries || entries.length === 0) return true;
  return entries.every((e) => {
    if (!e) return true;
    const v =
      (e as { value?: unknown }).value ??
      (e as { option?: unknown }).option ??
      (e as { referenced_actor_id?: unknown }).referenced_actor_id ??
      (e as { target_object?: unknown }).target_object;
    return v === null || v === undefined || v === "";
  });
}

async function findCompanyByGoogleId(
  apiKey: string,
  googleId: string,
  pace: () => Promise<void>,
): Promise<AttioRecord | null> {
  const res = await attioRequest(
    apiKey,
    "POST",
    "/objects/companies/records/query",
    { filter: { [SLUG.googleId]: googleId }, limit: 1 },
    pace,
  );
  const data = (await res.json()) as { data?: AttioRecord[] };
  return data.data?.[0] ?? null;
}

async function findCompanyByName(
  apiKey: string,
  name: string,
  pace: () => Promise<void>,
): Promise<AttioRecord | null> {
  const res = await attioRequest(
    apiKey,
    "POST",
    "/objects/companies/records/query",
    { filter: { [SLUG.name]: name }, limit: 1 },
    pace,
  );
  const data = (await res.json()) as { data?: AttioRecord[] };
  return data.data?.[0] ?? null;
}

async function createCompanyRecord(
  apiKey: string,
  place: Place,
  pace: () => Promise<void>,
): Promise<void> {
  await attioRequest(
    apiKey,
    "POST",
    "/objects/companies/records",
    { data: { values: buildCreateValues(place) } },
    pace,
  );
}

async function patchCompanyRecord(
  apiKey: string,
  recordId: string,
  values: Record<string, unknown>,
  pace: () => Promise<void>,
): Promise<void> {
  await attioRequest(
    apiKey,
    "PATCH",
    `/objects/companies/records/${recordId}`,
    { data: { values } },
    pace,
  );
}

// Shared pace + retry wrapper. 429 respects Retry-After; 5xx exponential
// backoff; 4xx (other) surfaces immediately. Returns the Response for callers
// that need to parse a body (query); write calls just discard it.
async function attioRequest(
  apiKey: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: unknown,
  pace: () => Promise<void>,
): Promise<Response> {
  const serialized = body === undefined ? undefined : JSON.stringify(body);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pace();
    const res = await fetch(`${ATTIO_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: serialized,
    });
    if (res.ok) return res;

    const isLast = attempt === MAX_ATTEMPTS;
    if (res.status === 429 && !isLast) {
      const waitMs = parseRetryAfter(res.headers.get("retry-after"), 2000);
      await sleep(waitMs);
      continue;
    }
    if (res.status >= 500 && res.status < 600 && !isLast) {
      await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`Attio ${res.status}: ${text.slice(0, 240)}`);
  }
  throw new Error("Attio: retries exhausted");
}

// Attio's Retry-After is an HTTP-date, but the spec also permits a seconds
// value — accept either. Fall back to `fallbackMs` if the header is missing
// or unparseable.
export function parseRetryAfter(
  header: string | null,
  fallbackMs: number,
): number {
  if (!header) return fallbackMs;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.ceil(asSeconds * 1000);
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return fallbackMs;
}

// Paces all callers through a shared "next allowed slot" cursor. Each caller
// reserves a slot `intervalMs` after the previous reservation, so steady-state
// throughput never exceeds 1000 / intervalMs req/s regardless of concurrency.
function createPacer(intervalMs: number): () => Promise<void> {
  let nextAllowedAt = 0;
  return async () => {
    const now = Date.now();
    const slot = Math.max(now, nextAllowedAt);
    nextAllowedAt = slot + intervalMs;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
