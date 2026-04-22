# MicroAGI Lead Gen Tool — Build Spec

This file is the canonical spec for building and maintaining the MicroAGI lead generation tool. Read this first before writing any code. Update it when architecture decisions change.

## What we're building

An internal web tool that lets the MicroAGI sales team generate CSV lead lists of small businesses in any geography by running Google Maps Places API searches in parallel across a set of user-defined keywords, filtering out chains and oversized operations, and optionally validating phone numbers via Twilio Lookup.

The operator types in:
- A list of search keywords (e.g. `tire shop, auto repair, mechanic, brake shop`)
- A location or geography
- A list of chain names to exclude
- Filter thresholds (max review count, etc.)
- Whether to run Twilio phone validation

Tool returns a downloadable CSV.

Deployment target: **Vercel** (Next.js frontend + serverless API routes).

## Audience for this file

This file is read by Claude Code (or whoever) when adding features, debugging, or onboarding. Keep it tight. If something isn't in here and it matters, add it.

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS
- **Backend:** Next.js API routes (serverless functions on Vercel)
- **APIs:**
  - Google Places API (New) — `places.googleapis.com/v1/places:searchText`
  - Nominatim (OpenStreetMap) — `nominatim.openstreetmap.org/search` — free geocoding for the operator's location string
  - Twilio Lookup API v2 — `lookups.twilio.com/v2/PhoneNumbers`
- **Deployment:** Vercel
- **Storage:** None. All processing is in-memory per request. CSV returned as a file download.
- **Auth:** Auth.js v5 (NextAuth) with Google OAuth. Access is granted if EITHER (a) Google's signed ID token reports `hd === AUTH_ALLOWED_DOMAIN` (i.e. Workspace member), OR (b) the verified email is in `AUTH_ALLOWED_EMAILS` (comma-separated invite list for outside collaborators). We deliberately do NOT pass an `hd` authorization param to Google — that would block invite-list users from reaching the consent screen. Middleware gates all routes; `/api/search` also checks `auth()` server-side.

## Project structure

```
/
├── CLAUDE.md                          ← this file
├── README.md                          ← short user-facing readme
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
├── .env.local.example                 ← template, committed
├── .env.local                         ← real keys, gitignored
├── auth.ts                            ← Auth.js v5 config (Google provider, domain gate)
├── middleware.ts                      ← gates every route except /api/auth, /signin, static
├── app/
│   ├── layout.tsx                     ← header + sign-out, reads session server-side
│   ├── page.tsx                       ← main form UI
│   ├── signin/page.tsx                ← Google sign-in screen (server action)
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts ← NextAuth handler
│   │   ├── search/route.ts            ← POST endpoint: runs the full pipeline
│   │   └── health/route.ts            ← GET: health check
│   └── globals.css
├── lib/
│   ├── google-places.ts               ← Google Places API client
│   ├── geocode.ts                     ← Nominatim geocoding client
│   ├── twilio-lookup.ts               ← Twilio Lookup client
│   ├── dedup.ts                       ← dedup logic
│   ├── filter.ts                      ← chain exclusion + size proxy filters
│   ├── csv.ts                         ← CSV serialization
│   ├── types.ts                       ← shared TypeScript types
│   └── constants.ts                   ← default chain lists per industry
└── components/
    ├── SearchForm.tsx
    ├── KeywordInput.tsx               ← chip-style input for keywords
    ├── ChainExcludeInput.tsx          ← chip-style input for chain names
    ├── ResultsPanel.tsx
    └── ProgressBar.tsx
```

## Environment variables

```
GOOGLE_PLACES_API_KEY=                # required
TWILIO_ACCOUNT_SID=                   # required if Twilio lookup enabled
TWILIO_AUTH_TOKEN=                    # required if Twilio lookup enabled
NOMINATIM_USER_AGENT=                 # required — Nominatim ToS demands a real UA, e.g. "microagi-lead-gen/1.0 (ops@micro-agi.com)"
AUTH_GOOGLE_ID=                       # required — Google OAuth client ID
AUTH_GOOGLE_SECRET=                   # required — Google OAuth client secret
AUTH_SECRET=                          # required — 32+ byte random, signs session JWTs (openssl rand -base64 32)
AUTH_ALLOWED_DOMAIN=micro-agi.com     # Workspace domain allowed to sign in (ID-token `hd` claim)
AUTH_ALLOWED_EMAILS=                  # optional, comma-separated invite list for non-Workspace users
NODE_ENV=development|production
```

`.env.local.example` should be committed with empty values and a comment next to each explaining where to get it.

## Core data types

Define in `lib/types.ts`:

```typescript
export interface SearchRequest {
  keywords: string[];              // ["auto repair", "tire shop"]
  location: string;                // "New York, NY" or a specific neighborhood — geocoded via Nominatim
  radiusMeters: number;            // default 1000 (1km), min 500, max 50000 (Google Places circle hard cap)
  excludeChains: string[];         // ["Mavis", "Firestone", ...]
  maxReviewCount?: number;         // default 400
  minReviewCount?: number;         // default 0
  maxPlaces?: number;              // default 500, hard cap 5000
  runTwilioLookup: boolean;
}

export interface Place {
  placeId: string;
  name: string;
  phone: string | null;
  formattedPhone: string | null;   // E.164 for Twilio
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  googleMapsUrl: string;
  latitude: number | null;
  longitude: number | null;
  // enrichment
  phoneVerified?: boolean;
  phoneLineType?: string;           // "landline" | "mobile" | "voip" | etc.
  // filter flags (kept for debugging)
  excludedReason?: string;
}

export interface SearchResponse {
  totalFound: number;
  afterDedup: number;
  afterFilter: number;
  phoneValidated: number;
  results: Place[];
  csvData: string;                  // base64-encoded CSV, or a download URL
  warnings: string[];
}
```

## Pipeline

When `POST /api/search` is hit, run this pipeline in order.

### Step 0 — Geocode location (Nominatim)

Resolve `request.location` to a `{lat, lng}` center point via Nominatim in `lib/geocode.ts`. This lets Step 1 enforce a hard distance radius instead of relying on Google's fuzzy text-based location biasing.

**Endpoint:** `GET https://nominatim.openstreetmap.org/search?q=<location>&format=json&limit=1&addressdetails=0`

**Headers:**
```
User-Agent: <NOMINATIM_USER_AGENT>
```

Nominatim's ToS requires a real, contact-identifying `User-Agent` and rate-limits to ~1 req/sec. The User-Agent is mandatory — requests without one get blocked.

**Response:** take the first result's `lat` and `lon` (strings, parse to float). Ignore the rest.

**Caching:** keep a module-level `Map<string, {lat, lng}>` keyed on the trimmed, lowercased location string. Hits are free and invisible to Nominatim. Cache only lives for the warm lifetime of a serverless instance — that's fine, it's a courtesy not a correctness requirement.

**Errors:**
- Empty result array → reject the request with HTTP 400: `"Couldn't find a location matching '<input>'. Try a city, neighborhood, or zip code."`
- Network / 5xx → retry once after 1s, then fail with a clear error. Don't fall back to unrestricted Google search silently.

### Step 1 — Parallel Google Places text search

For each keyword in `keywords`, call Google Places API `searchText` in parallel. Use `Promise.all`.

**Endpoint:** `POST https://places.googleapis.com/v1/places:searchText`

**Headers:**
```
Content-Type: application/json
X-Goog-Api-Key: <GOOGLE_PLACES_API_KEY>
X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types,places.googleMapsUri,places.location
```

**Body:**
```json
{
  "textQuery": "<keyword>",
  "pageSize": 20,
  "maxResultCount": 20,
  "locationRestriction": {
    "rectangle": {
      "low":  { "latitude": <south>, "longitude": <west> },
      "high": { "latitude": <north>, "longitude": <east> }
    }
  }
}
```

Important Places (New) quirk: `searchText`'s `locationRestriction` only accepts `rectangle`. `circle` is only valid under `locationBias` (a soft hint, not a hard cap) or on the `searchNearby` endpoint. To honor the operator's circular `radiusMeters` as a hard cutoff, Step 1 converts (center, radiusMeters) into a bounding box in `lib/google-places.ts` via `circleToRectangle` (1° lat ≈ 111.32 km; lng scaled by cos(lat)). The resulting square is ~27% larger in area than the target circle but is a true hard cutoff by Google. No post-filter for a perfect-circle shape — not worth the added complexity for this tool.

**Pagination:** Google Places (New) returns up to 20 results per call, max 60 via pagination (`nextPageToken`). Paginate until no more results or 60 reached. Each keyword therefore returns up to 60 places.

**Rate limit awareness:** Google Places has per-minute and per-day quotas. Default quota is generous (thousands per minute on new accounts). If we hit a 429, back off with exponential retry (3 attempts, 1s / 2s / 4s).

**Field mask is critical.** Google charges per field class. The mask above includes "Pro" fields (phone, website) which are billable at the Places Pro SKU (~$20/1000 calls as of early 2026 — **verify current pricing in the Google Places billing docs before deploying**). Keep the field mask tight; don't add fields we don't use.

### Step 2 — Dedup

Dedup across all keyword result sets in `lib/dedup.ts`.

**Primary key:** `placeId` (Google's unique ID). If two results have the same `placeId`, they're the same place.

**Secondary key (fallback for edge cases):** normalized `phone` (strip all non-digits, use last 10 digits). If two results have different `placeId` but same phone, prefer the one with more review data.

Output: a single deduped array of `Place` objects.

### Step 2b — Max places cap

If `maxPlaces` is set and `deduped.length > maxPlaces`, truncate to the first `maxPlaces` entries and add a warning. This caps the input to filter + Twilio so cost stays predictable regardless of keyword count. Hard ceiling: 5,000.

### Step 3 — Filter

In `lib/filter.ts`, apply in this order:

1. **Chain exclusion:** case-insensitive substring match. If the place name contains any of the strings in `excludeChains`, set `excludedReason = "chain:<match>"` and drop it.
2. **Review count ceiling:** if `reviewCount > maxReviewCount`, drop it. Flag as `excludedReason = "too_many_reviews"`.
3. **Review count floor:** if `reviewCount < minReviewCount`, drop it. Flag as `excludedReason = "too_few_reviews"`.
4. **No phone:** if `phone === null`, drop it. Can't call it anyway.

Keep excluded places in a separate array for debugging. Don't return them to the frontend by default, but log counts.

### Step 4 — Twilio Lookup (optional)

If `runTwilioLookup === true`, for each place with a phone number call Twilio Lookup v2:

**Endpoint:** `GET https://lookups.twilio.com/v2/PhoneNumbers/<E164_number>?Fields=line_type_intelligence`

**Auth:** HTTP Basic Auth using `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`.

**Cost:** Carrier lookup is ~$0.008 per number (verify current Twilio pricing). Line Type Intelligence is ~$0.015. Use `line_type_intelligence` — it identifies landline vs mobile vs voip vs toll-free, which is what we care about.

**Behavior:**
- If lookup succeeds and returns `valid: true`, set `phoneVerified = true` and `phoneLineType = <line_type>`.
- If lookup returns 404 or `valid: false`, set `phoneVerified = false`.
- If Twilio call itself errors (network, auth), set `phoneVerified = undefined` (unknown) and add a warning to the response.

**Concurrency:** batch these with a concurrency limit of 10 (don't fire 3000 Twilio calls at once — use `p-limit` or a manual semaphore).

**Cost cap:** reject the request upfront if `places.length > 5000` and `runTwilioLookup === true`. Show the operator the estimated cost before running (frontend responsibility).

### Step 5 — CSV export

In `lib/csv.ts`, serialize results to CSV with these columns (in this order):

```
shop_name, phone, phone_verified, phone_line_type, address, city, state, zip,
website, google_rating, google_review_count, categories, google_maps_url,
latitude, longitude, place_id, notes
```

- `categories` is pipe-delimited: `auto_repair|car_repair|point_of_interest`
- `notes` is an empty column for the rep to fill in while calling
- Always quote fields containing commas, newlines, or quotes (RFC 4180)
- Header row first

Return the CSV as a string in the API response under `csvData`. Frontend handles the file download via `Blob` + anchor tag.

## Frontend UX

Single page. Form on the left, results on the right (or stacked on mobile).

### Form fields

1. **Location** — text input. Placeholder: "New York, NY" or "Brooklyn" or a zip code. Geocoded via Nominatim server-side.
2. **Max radius** — range slider (km), default 1, min 1, max 50. Label: "Max distance from geocoded location center (km)". 50km matches Google Places' `locationRestriction.circle.radius` hard cap.
3. **Search keywords** — chip/tag input. User types a keyword and hits enter to add it. Shows existing keywords as removable chips. Starts empty, but has a "Load preset" dropdown with saved industry presets (see below).
4. **Chain names to exclude** — chip/tag input, same UX as keywords. Also has a "Load preset" dropdown matching the industry preset.
5. **Max review count** — number input. Default 400. Tooltip: "Shops with more reviews than this are usually chains or very large operations."
6. **Min review count** — number input. Default 0. Tooltip: "Set this to filter out shops with no review history."
7. **Run Twilio validation** — toggle. Below the toggle, show estimated cost: `~$0.015 × N phones = $X.XX`.
8. **Submit** — big button. Disabled while in flight.

The UI sends `radiusMeters` (km × 1000) to the API.

### Industry presets

Hardcode these in `lib/constants.ts`. Each preset has a keyword list AND a chain-exclude list.

Start with these presets (expand as needed):

- **Auto repair / mechanic shops**
  - Keywords: `auto repair, mechanic, auto service, automotive repair, brake shop, transmission repair, tire shop, oil change`
  - Exclude: `Mavis, Firestone, Midas, Meineke, Jiffy Lube, Monro, Pep Boys, Valvoline, AAMCO, Grease Monkey, Express Oil, Christian Brothers, Big O Tires, Discount Tire, Mr. Tire, NTB, Goodyear, Pirelli, Precision Tune, Maaco, Caliber Collision, Gerber Collision, Service King, CARSTAR, Ziebart, Tuffy, Car-X, Brake Check`
- **Auto body / collision**
  - Keywords: `auto body shop, collision repair, auto body, body shop, paint shop automotive`
  - Exclude: `Maaco, Caliber Collision, Gerber Collision, Service King, CARSTAR, ABRA, Crash Champions`
- **HVAC**
  - Keywords: `hvac, heating and cooling, air conditioning repair, hvac contractor, furnace repair`
  - Exclude: `One Hour Heating, ARS, Lennox, Carrier, Trane, Service Experts, Horizon Services`
- **Plumbing**
  - Keywords: `plumber, plumbing contractor, plumbing repair, emergency plumber`
  - Exclude: `Roto-Rooter, Benjamin Franklin Plumbing, Mr. Rooter, Horizon Services, ARS, Rescue Rooter`
- **Electrical**
  - Keywords: `electrician, electrical contractor, electrical repair, residential electrician`
  - Exclude: `Mister Sparky, Mr. Electric, ARS`
- **Landscaping**
  - Keywords: `landscaping, lawn care, landscape contractor, tree service, lawn maintenance`
  - Exclude: `TruGreen, Brightview, The Grounds Guys, LawnStarter, Weed Man`
- **Cleaning / janitorial**
  - Keywords: `commercial cleaning, janitorial service, office cleaning, commercial cleaner`
  - Exclude: `ServiceMaster, ServPro, Stanley Steemer, Jan-Pro, Jani-King, Coverall, Merry Maids, The Cleaning Authority`
- **Warehousing / 3PL**
  - Keywords: `warehouse, 3PL, third party logistics, fulfillment center, distribution center`
  - Exclude: `Amazon, UPS, FedEx, DHL, XPO, GXO, Ryder, Penske Logistics, DB Schenker, Kuehne + Nagel`
- **Construction / general contracting**
  - Keywords: `general contractor, home builder, construction company, remodeling contractor`
  - Exclude: `Power Home Remodeling, Home Depot, Lowe's, Re-Bath, Bath Fitter`
- **Moving / storage**
  - Keywords: `moving company, movers, storage facility, self storage`
  - Exclude: `U-Haul, Public Storage, Extra Space Storage, CubeSmart, Life Storage, PODS, Two Men and a Truck, College Hunks, Allied, North American Van Lines, Mayflower, Bekins`

The UI loads the full list into the form when a preset is selected. The operator can then edit before submitting. Presets are a starting point, not a lock-in.

### Results panel

After submit, show:
- Running status (which step we're on)
- Final counts: total found / after dedup / after filter / phone validated
- Table preview (first 50 rows) with sortable columns
- **Download CSV** button (primary action)
- List of excluded places with reason (collapsible, for debugging)

### Progress bar

Since the pipeline runs server-side in one request, use a simple indeterminate spinner with rotating status messages. If we want real-time progress updates later, switch to Server-Sent Events or a job queue (see Future section).

## API contract

### `POST /api/search`

Request body: `SearchRequest` (see types above).

Response (success):
```json
{
  "totalFound": 847,
  "afterDedup": 612,
  "afterFilter": 438,
  "phoneValidated": 401,
  "results": [...],
  "csvData": "<csv string>",
  "warnings": []
}
```

Response (error): HTTP 4xx/5xx with `{ "error": "message" }`.

Auth: none. The endpoint is open on the deployed URL.

## Auth

Auth.js v5 with Google OAuth. Two-gate allowlist: domain OR invite email.

**Policy (lib/auth-policy.ts):** A sign-in is accepted if *either* condition holds:
1. `profile.hd === AUTH_ALLOWED_DOMAIN` — the user is in our Google Workspace org. `hd` is the Workspace "hosted domain" claim, signed by Google in the ID token. Not spoofable.
2. `profile.email ∈ AUTH_ALLOWED_EMAILS` — explicit invite list for outside collaborators (comma-separated env var, case-insensitive match, Google-verified emails only).

Personal Gmail accounts have no `hd` claim, so they can only get in via (2).

**Why no `hd` authorization param:** Prior versions passed `hd=micro-agi.com` to Google, which would hide the consent screen from non-Workspace users. That breaks the invite-email path — an allowlisted `@gmail.com` user would never reach our `signIn` callback. We drop `hd` so any Google user can start the flow; the `signIn` callback is the real gate.

**Files:**
- `lib/auth-policy.ts` — pure policy: `isAllowedDomain`, `isAllowedEmail`, `isAllowed`, env readers. Unit-tested.
- `auth.ts` — NextAuth config. Google provider (no `hd` param), `signIn` callback that delegates to `isAllowed`.
- `middleware.ts` — function-form: API routes get JSON 401, everything else redirects to `/signin`.
- `app/api/auth/[...nextauth]/route.ts` — mounts the NextAuth handler.
- `app/signin/page.tsx` — minimal sign-in UI with a server-action form that calls `signIn("google")`.
- `app/api/search/route.ts` — calls `auth()` at the top and returns 401 if no session (defense in depth).

**Google Cloud Console one-time setup:**
1. APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorized redirect URIs: `https://<prod-domain>/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.
3. OAuth consent screen → **User type: External** (since invite-list users may be outside the Workspace). Add the ops email as test user while in testing mode, or submit for verification to publish.
4. Client ID → `AUTH_GOOGLE_ID`, Client Secret → `AUTH_GOOGLE_SECRET`.

**Adding collaborators:**
- Same Workspace: add them to `@micro-agi.com`. No app-side change.
- Outside collaborator: append their email to `AUTH_ALLOWED_EMAILS` in `.env` / Vercel env and redeploy.

## Error handling

- **Nominatim no match:** reject with HTTP 400 and a clear message — don't silently proceed with unrestricted Google search.
- **Nominatim 5xx / timeout:** retry once after 1s, then fail. Don't mask the outage.
- **Google Places 429:** retry with exponential backoff (3 attempts).
- **Google Places quota exhausted:** surface a clear error to the user: "Google Places daily quota hit. Try again tomorrow or contact admin."
- **Twilio error:** don't fail the whole request. Mark affected phones as unvalidated and add to `warnings[]`.
- **Empty Google results:** Step 0 succeeded but Places returned nothing — usually means the radius is too small or the keywords don't match. Frontend should warn the user if `totalFound === 0`.
- **Keyword list too long:** cap at 20 keywords per request (serverless timeout risk). Reject with a clear error.
- **Radius out of bounds:** reject client-side and server-side if `radiusMeters < 500` or `> 50000`.

## Timeouts

Vercel serverless functions default to 10s (Hobby) / 60s (Pro). This pipeline can easily take longer with Twilio lookups on 500+ numbers.

- Set `export const maxDuration = 300;` at the top of `/api/search/route.ts` (requires Pro plan).
- If we stay on Hobby, cap total results processed per request at ~200 phones for Twilio or add job queuing.

**Action item:** confirm which Vercel plan MicroAGI is on before deploying. Pro is required for realistic lead volumes.

## Cost controls

Google Places (New) Pro fields cost ~$20 per 1,000 calls. Twilio Line Type Intelligence costs ~$0.015 per number. Verify both with official docs before final deployment.

A typical run might be:
- 8 keywords × 3 pages × $0.02 = ~$0.48 per search (Places)
- 500 phone validations × $0.015 = ~$7.50 (Twilio)

Show the estimated cost in the UI before submit. Log actual cost per run to a simple in-memory counter (future: proper logging).

Hard caps in code:
- Max 20 keywords per search
- Max 60 places per keyword (API enforced anyway)
- Max 5,000 total places kept post-dedup (operator sets `maxPlaces`, defaults to 500)
- Max 2,000 total phones sent to Twilio per single request

## Testing

- Unit tests for `lib/dedup.ts`, `lib/filter.ts`, `lib/csv.ts` — pure functions, easy to test.
- Mock Google Places and Twilio responses with Vitest + MSW.
- One end-to-end test: form submission → mocked API → CSV download.

Test command: `npm test`. Run before every PR.

## Deployment

1. Push to GitHub.
2. Connect repo to Vercel.
3. Set env vars in Vercel dashboard (all four from the env list).
4. Deploy. Vercel auto-deploys on every push to `main`.

Custom domain (optional): something like `leads.micro-agi.com`.

## Future (not v1)

Build only if asked. These are parked ideas, not commitments.

- **Job queue:** move the pipeline to a background worker (e.g. Inngest, Trigger.dev, or a simple queue in Vercel KV) for longer runs with real-time progress via SSE.
- **Saved searches:** let operators save a keyword/exclude/location combo and re-run it.
- **Deduplication across runs:** keep a persistent store (Supabase or Vercel Postgres) so shops hit in multiple runs aren't re-pulled.
- **Email enrichment:** Hunter.io or Apollo fallback for when the rep wants email outreach.
- **Owner name enrichment:** optional column populated by an LLM pass over Google reviews. Originally descoped — rep does this manually per-shop.
- **CRM push:** direct export into GoHighLevel instead of CSV download.
- **Yelp enrichment:** add Yelp rating/review count by cross-matching phone numbers (Yelp API is expensive, do this only for high-priority leads).
- **Review response parsing:** pull "Response from owner — Mike" strings out of reviews, return as a confidence-scored owner_name column.
- **Industrial zone heatmap:** instead of city-level search, accept a polygon or bounding box and pull shops inside it.

## Rules for Claude Code / future maintainers

- Never commit `.env.local`. Update `.env.local.example` when you add a new env var.
- Never hardcode API keys. Always read from env.
- Keep the field mask on Google Places tight. Adding fields increases cost.
- Don't add dependencies without a reason. This is a small tool.
- TypeScript strict mode is on. No `any` without a comment explaining why.
- If a change affects the CSV schema, update both `lib/csv.ts` AND the "CSV export" section of this file in the same PR.
- If you change the pipeline steps, update the "Pipeline" section of this file in the same PR.
- Code comments are welcome where intent isn't obvious. Keep them short.
- Ask before building "Future" section features. They're parked for a reason.

## Questions for the operator when unclear

If building or debugging this tool and something in the spec is ambiguous, don't guess. Ask:

1. What's the target Vercel plan (Hobby vs Pro)?
2. What's the current Google Places API daily quota on the project key?
3. Should Twilio validation default ON or OFF in the form?
4. Do we want per-user audit logs (who ran what search, when)?
5. Should the app prevent duplicate downloads (e.g. same keyword/location run twice in 24h)?

## Change log

- v1 (initial spec): Google Places search + dedup + filter + optional Twilio + CSV export + Next.js frontend on Vercel.
- v1.1: Added Nominatim geocoding (Step 0) and wired `radiusMeters` into Google Places `locationRestriction.circle`. Hard distance boundary replaces fuzzy "`<keyword> in <location>`" text biasing. Max radius is a slider: default 1km, range 1–50km (Google's circle hard cap).
- v1.2: Added Auth.js v5 Google OAuth gated to `@micro-agi.com`. Middleware protects every route; `/api/search` double-checks `auth()` server-side.
- v1.3: Expanded auth allowlist to a union of `AUTH_ALLOWED_DOMAIN` (Workspace `hd` claim) and `AUTH_ALLOWED_EMAILS` (explicit invite list). Dropped the Google `hd` authorization param so invite-list users can reach the consent screen.