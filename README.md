# MicroAGI Lead Gen

Internal web tool for the MicroAGI sales team. Generates CSV lead lists of small businesses via Google Maps Places API (parallel text search across keywords), dedup + chain/size filters, and optional Twilio phone validation.

See `CLAUDE.md` for the canonical build spec.

## Quick start

```bash
npm install
cp .env.local.example .env.local
# fill in GOOGLE_PLACES_API_KEY and (optionally) TWILIO_*
npm run dev
```

Open http://localhost:3000, pick an industry preset (or type your own keywords), set a location, and hit **Generate leads**.

## Environment

See `.env.local.example` for the full list. At minimum:

- `GOOGLE_PLACES_API_KEY` — Google Cloud key with "Places API (New)" enabled
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — only if you want phone validation

## Tests

```bash
npm test
```

Unit tests cover `lib/dedup.ts`, `lib/filter.ts`, and `lib/csv.ts`.

## Deploy

1. Push to GitHub.
2. Import the repo in Vercel.
3. Set the env vars in the Vercel dashboard.
4. Deploy. Vercel auto-deploys on every push to `main`.

The `/api/search` route declares `maxDuration = 300`, which requires the Vercel Pro plan. On Hobby, reduce to 60 and cap result volume.

## Costs

- Google Places (New) Pro fields: ~$20 / 1,000 calls
- Twilio Line Type Intelligence: ~$0.015 / number

Verify both with upstream docs before committing to a large run. The form shows a rough upper-bound cost estimate before submit.
