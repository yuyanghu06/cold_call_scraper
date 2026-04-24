import {
  attioRequest,
  createPacer,
  type AttioRecord,
  type AttioValueEntry,
} from "@/lib/clients/attioClient";
import type { Place } from "@/lib/types";
import type {
  TrackingCompany,
  TrackingUpdate,
  ListCompaniesParams,
  ListCompaniesResult,
} from "@/lib/viewmodels/trackingViewModel";

const WRITE_RATE_PER_SEC = 20;
const PACE_INTERVAL_MS = Math.ceil(1000 / WRITE_RATE_PER_SEC);
const CONCURRENCY = 5;

export const SLUG = {
  name: "name",
  googleId: "googleid",
  territory: "territory",
  stage: "stage",
  signed: "signed",
  warmth: "warmth",
  industry: "industry",
  address: "address",
  primaryLocation: "primary_location",
  companyNumber: "store_number",
  callStatus: "call_status",
  followUpNumber: "follow_up_number",
  ownerName: "owner_name",
  notes: "notes",
} as const;

const US_STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam",
  VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
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

export interface CsvUpsertInput {
  values: Record<string, unknown>;
}

type Outcome = "created" | "updated" | "skipped";

// ─── Value readers ────────────────────────────────────────────────────────────

function extractOptionTitle(e: AttioValueEntry): string | null {
  const direct = (e as { option?: { title?: unknown } }).option?.title;
  if (typeof direct === "string" && direct) return direct;
  const nested = (e as { value?: { option?: { title?: unknown } } }).value?.option?.title;
  if (typeof nested === "string" && nested) return nested;
  const v = (e as { value?: unknown }).value;
  if (typeof v === "string" && v) return v;
  return null;
}

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
  return entries.map(extractOptionTitle).filter((t): t is string => t !== null);
}

function readText(entries: AttioValueEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;
  for (const e of entries) {
    const v = (e as { value?: unknown }).value;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

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

// ─── Record normalizer ────────────────────────────────────────────────────────

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

// ─── Location helper ──────────────────────────────────────────────────────────

function extractStreetLine(formattedAddress: string | null | undefined): string | null {
  if (!formattedAddress) return null;
  const first = formattedAddress.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function buildLocationPayload(place: Place): Record<string, unknown> | null {
  const street = extractStreetLine(place.address) ?? place.address ?? null;
  const countryCode =
    place.country && /^[A-Za-z]{2}$/.test(place.country)
      ? place.country.toUpperCase()
      : null;
  const payload: Record<string, unknown> = {
    line_1: street || null, line_2: null, line_3: null, line_4: null,
    locality: place.city ?? null,
    region: place.state ?? null,
    postcode: place.zip ?? null,
    country_code: countryCode,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
  };
  if (!payload.line_1 && !payload.locality && !payload.region && !payload.postcode && payload.latitude === null) {
    return null;
  }
  return payload;
}

// ─── Payload builders ─────────────────────────────────────────────────────────

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

function buildUpdatePayload(
  place: Place,
  existing: Record<string, AttioValueEntry[] | undefined>,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (isFieldEmpty(existing[SLUG.stage])) updates[SLUG.stage] = "Cold Lead";
  if (isFieldEmpty(existing[SLUG.signed])) updates[SLUG.signed] = "No";
  if (isFieldEmpty(existing[SLUG.warmth])) updates[SLUG.warmth] = "Low";
  if (isFieldEmpty(existing[SLUG.callStatus])) updates[SLUG.callStatus] = "Not called yet";
  if (isFieldEmpty(existing[SLUG.territory]) && place.state) {
    updates[SLUG.territory] = [normalizeTerritory(place.state)];
  }
  if (isFieldEmpty(existing[SLUG.industry]) && place.industry) updates[SLUG.industry] = place.industry;
  if (isFieldEmpty(existing[SLUG.address]) && place.address) updates[SLUG.address] = place.address;
  if (isFieldEmpty(existing[SLUG.companyNumber]) && place.phone) updates[SLUG.companyNumber] = place.phone;
  if (isFieldEmpty(existing[SLUG.primaryLocation])) {
    const location = buildLocationPayload(place);
    if (location) updates[SLUG.primaryLocation] = location;
  }
  return updates;
}

// ─── Finders ──────────────────────────────────────────────────────────────────

async function findCompanyByGoogleId(
  apiKey: string,
  googleId: string,
  pace: () => Promise<void>,
): Promise<AttioRecord | null> {
  const res = await attioRequest(apiKey, "POST", "/objects/companies/records/query", {
    filter: { [SLUG.googleId]: googleId },
    limit: 1,
  }, pace);
  const data = (await res.json()) as { data?: AttioRecord[] };
  return data.data?.[0] ?? null;
}

async function findCompanyByName(
  apiKey: string,
  name: string,
  pace: () => Promise<void>,
): Promise<AttioRecord | null> {
  const res = await attioRequest(apiKey, "POST", "/objects/companies/records/query", {
    filter: { [SLUG.name]: name },
    limit: 1,
  }, pace);
  const data = (await res.json()) as { data?: AttioRecord[] };
  return data.data?.[0] ?? null;
}

// ─── Public service functions ─────────────────────────────────────────────────

export async function listTrackingCompanies(
  apiKey: string,
  params: ListCompaniesParams,
): Promise<ListCompaniesResult> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  const andClauses: Record<string, unknown>[] = [];
  const addFilter = (values: string[] | null | undefined, slug: string) => {
    const v = (values ?? []).filter(Boolean);
    if (v.length === 1) andClauses.push({ [slug]: v[0] });
    else if (v.length > 1) andClauses.push({ $or: v.map((x) => ({ [slug]: x })) });
  };
  addFilter(
    (params.territory ?? []).map(normalizeTerritory),
    SLUG.territory,
  );
  addFilter(params.callStatus ?? [], SLUG.callStatus);
  addFilter(params.industry ?? [], SLUG.industry);

  const body: Record<string, unknown> = { limit, offset };
  if (andClauses.length === 1) body.filter = andClauses[0];
  else if (andClauses.length > 1) body.filter = { $and: andClauses };

  const res = await attioRequest(apiKey, "POST", "/objects/companies/records/query", body, pace);
  const data = (await res.json()) as { data?: AttioRecord[] };
  const rows = data.data ?? [];
  return {
    companies: rows.map(normalizeTrackingCompany),
    nextOffset: rows.length === limit ? offset + rows.length : null,
  };
}

export async function updateTrackingCompany(
  apiKey: string,
  recordId: string,
  update: TrackingUpdate,
): Promise<TrackingCompany> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const values: Record<string, unknown> = {};
  if (update.name !== undefined) {
    const trimmed = (update.name ?? "").trim();
    if (!trimmed) throw new Error("Business name cannot be empty");
    values[SLUG.name] = trimmed;
  }
  if (update.territory !== undefined) values[SLUG.territory] = update.territory.map(normalizeTerritory);
  if (update.callStatus !== undefined) values[SLUG.callStatus] = update.callStatus ?? "";
  if (update.industry !== undefined) values[SLUG.industry] = update.industry ?? "";
  if (update.address !== undefined) values[SLUG.address] = update.address ?? "";
  if (update.ownerName !== undefined) values[SLUG.ownerName] = update.ownerName ?? "";
  if (update.followUpNumber !== undefined) values[SLUG.followUpNumber] = update.followUpNumber ?? "";
  if (update.notes !== undefined) values[SLUG.notes] = update.notes ?? "";

  if (Object.keys(values).length === 0) {
    const res = await attioRequest(apiKey, "GET", `/objects/companies/records/${recordId}`, undefined, pace);
    const data = (await res.json()) as { data?: AttioRecord };
    if (!data.data) throw new Error("Attio: record not found");
    return normalizeTrackingCompany(data.data);
  }

  const res = await attioRequest(
    apiKey, "PATCH", `/objects/companies/records/${recordId}`, { data: { values } }, pace,
  );
  const data = (await res.json()) as { data?: AttioRecord };
  if (!data.data) throw new Error("Attio: empty PATCH response");
  return normalizeTrackingCompany(data.data);
}

export async function listAttributeOptions(
  apiKey: string,
  attributeSlug: string,
): Promise<string[]> {
  const pace = createPacer(PACE_INTERVAL_MS);
  const res = await attioRequest(
    apiKey, "GET", `/objects/companies/attributes/${attributeSlug}/options`, undefined, pace,
  );
  const data = (await res.json()) as { data?: Array<{ title?: string; is_archived?: boolean }> };
  return (data.data ?? [])
    .filter((o) => !o.is_archived && typeof o.title === "string" && o.title)
    .map((o) => o.title!);
}

export async function pushPlacesToAttio(
  apiKey: string,
  places: Place[],
): Promise<AttioPushResult> {
  const result: AttioPushResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: places.length, errors: [] };
  if (places.length === 0) return result;

  const pace = createPacer(PACE_INTERVAL_MS);
  const queue = [...places];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (true) {
      const p = queue.shift();
      if (!p) break;
      try {
        let existing = await findCompanyByGoogleId(apiKey, p.placeId, pace);
        let needsGoogleIdBackfill = false;

        if (!existing) {
          const nameMatch = await findCompanyByName(apiKey, p.name, pace);
          if (nameMatch && isFieldEmpty(nameMatch.values[SLUG.googleId])) {
            existing = nameMatch;
            needsGoogleIdBackfill = true;
          }
        }

        if (!existing) {
          await attioRequest(apiKey, "POST", "/objects/companies/records", { data: { values: buildCreateValues(p) } }, pace);
          result.created++;
        } else {
          const updates = buildUpdatePayload(p, existing.values);
          if (needsGoogleIdBackfill) updates[SLUG.googleId] = p.placeId;
          if (Object.keys(updates).length === 0) {
            result.skipped++;
          } else {
            await attioRequest(apiKey, "PATCH", `/objects/companies/records/${existing.id.record_id}`, { data: { values: updates } }, pace);
            result.updated++;
          }
        }
      } catch (err) {
        result.failed++;
        result.errors.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  await Promise.all(workers);
  return result;
}

export async function pushCsvRowsToAttio(
  apiKey: string,
  inputs: CsvUpsertInput[],
): Promise<AttioPushResult> {
  const result: AttioPushResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: inputs.length, errors: [] };
  if (inputs.length === 0) return result;

  const pace = createPacer(PACE_INTERVAL_MS);
  const queue = [...inputs];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (true) {
      const input = queue.shift();
      if (!input) break;
      const label =
        typeof input.values[SLUG.name] === "string" ? (input.values[SLUG.name] as string) : "<unnamed>";
      try {
        const name = input.values[SLUG.name];
        if (typeof name !== "string" || !name.trim()) throw new Error("row missing Business Name");

        const existing = await findCompanyByName(apiKey, name, pace);
        if (!existing) {
          await attioRequest(apiKey, "POST", "/objects/companies/records", { data: { values: input.values } }, pace);
          result.created++;
        } else {
          const updates: Record<string, unknown> = {};
          for (const [slug, value] of Object.entries(input.values)) {
            if (slug === SLUG.name) continue;
            if (value === undefined || value === null || value === "") continue;
            if (isFieldEmpty(existing.values[slug])) updates[slug] = value;
          }
          if (Object.keys(updates).length === 0) {
            result.skipped++;
          } else {
            await attioRequest(apiKey, "PATCH", `/objects/companies/records/${existing.id.record_id}`, { data: { values: updates } }, pace);
            result.updated++;
          }
        }
      } catch (err) {
        result.failed++;
        result.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  await Promise.all(workers);
  return result;
}
