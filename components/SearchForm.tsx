"use client";

import { useMemo, useState } from "react";
import KeywordInput from "./KeywordInput";
import ChainExcludeInput from "./ChainExcludeInput";
import {
  DEFAULT_MAX_PLACES,
  DEFAULT_MAX_REVIEW_COUNT,
  DEFAULT_MIN_REVIEW_COUNT,
  DEFAULT_RADIUS_METERS,
  INDUSTRY_PRESETS,
  MAX_KEYWORDS_PER_REQUEST,
  MAX_PLACES_HARD_CAP,
  MAX_RADIUS_METERS,
  TWILIO_PRICE_PER_LOOKUP_USD,
} from "@/lib/constants";
import type { SearchRequest } from "@/lib/types";

const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = Math.floor(MAX_RADIUS_METERS / 1000);
const DEFAULT_RADIUS_KM = Math.max(
  MIN_RADIUS_KM,
  Math.floor(DEFAULT_RADIUS_METERS / 1000),
);

interface Props {
  loading: boolean;
  onSubmit: (payload: SearchRequest) => void;
}

const INPUT_CLASS =
  "w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 bg-white";

const LABEL_CLASS =
  "block text-[11px] uppercase tracking-[0.14em] text-neutral-500 mb-1.5";

export default function SearchForm({ loading, onSubmit }: Props) {
  const [location, setLocation] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludeChains, setExcludeChains] = useState<string[]>([]);
  const [maxReviewCount, setMaxReviewCount] = useState<number>(
    DEFAULT_MAX_REVIEW_COUNT,
  );
  const [minReviewCount, setMinReviewCount] = useState<number>(
    DEFAULT_MIN_REVIEW_COUNT,
  );
  const [maxPlaces, setMaxPlaces] = useState<number>(DEFAULT_MAX_PLACES);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [runTwilioLookup, setRunTwilioLookup] = useState(false);
  const [presetId, setPresetId] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function applyPreset(id: string) {
    setPresetId(id);
    if (!id) return;
    const preset = INDUSTRY_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setKeywords(preset.keywords);
    setExcludeChains(preset.excludeChains);
  }

  const estimatedPhones = useMemo(() => {
    return Math.min(maxPlaces, keywords.length * 60);
  }, [keywords.length, maxPlaces]);

  const estimatedCostUsd = useMemo(() => {
    return estimatedPhones * TWILIO_PRICE_PER_LOOKUP_USD;
  }, [estimatedPhones]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!location.trim()) {
      setValidationError("Location is required.");
      return;
    }
    if (keywords.length === 0) {
      setValidationError("Add at least one keyword.");
      return;
    }
    if (keywords.length > MAX_KEYWORDS_PER_REQUEST) {
      setValidationError(
        `Too many keywords (${keywords.length}). Max is ${MAX_KEYWORDS_PER_REQUEST}.`,
      );
      return;
    }
    if (minReviewCount > maxReviewCount) {
      setValidationError(
        "Min review count cannot be greater than max review count.",
      );
      return;
    }
    if (maxPlaces < 1 || maxPlaces > MAX_PLACES_HARD_CAP) {
      setValidationError(
        `Max places must be between 1 and ${MAX_PLACES_HARD_CAP}.`,
      );
      return;
    }

    onSubmit({
      keywords,
      location: location.trim(),
      excludeChains,
      maxReviewCount,
      minReviewCount,
      maxPlaces,
      radiusMeters: radiusKm * 1000,
      runTwilioLookup,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="location" className={LABEL_CLASS}>
          Location
        </label>
        <input
          id="location"
          type="text"
          className={INPUT_CLASS}
          placeholder="New York, NY  ·  Brooklyn  ·  94103"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor="radius" className={`${LABEL_CLASS} mb-0`}>
            Max radius
          </label>
          <span className="text-sm font-mono tabular-nums text-neutral-900">
            {radiusKm} km
          </span>
        </div>
        <input
          id="radius"
          type="range"
          min={MIN_RADIUS_KM}
          max={MAX_RADIUS_KM}
          step={1}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="w-full accent-neutral-900"
          title="Max distance from geocoded location center."
        />
        <div className="flex justify-between text-[10px] text-neutral-400 mt-1 font-mono tabular-nums">
          <span>{MIN_RADIUS_KM} km</span>
          <span>{MAX_RADIUS_KM} km</span>
        </div>
        <p className="text-xs text-neutral-500 mt-1.5">
          Hard distance cap from the geocoded center of your location.
        </p>
      </div>

      <div>
        <label htmlFor="preset" className={LABEL_CLASS}>
          Industry preset
        </label>
        <select
          id="preset"
          className={INPUT_CLASS}
          value={presetId}
          onChange={(e) => applyPreset(e.target.value)}
        >
          <option value="">— Load preset (optional) —</option>
          {INDUSTRY_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-500 mt-1.5">
          Presets populate keywords and chain exclusions. Edit freely before
          submitting.
        </p>
      </div>

      <KeywordInput
        label="Search keywords"
        values={keywords}
        onChange={setKeywords}
        placeholder="auto repair, tire shop, …"
      />

      <ChainExcludeInput values={excludeChains} onChange={setExcludeChains} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="minReviews" className={LABEL_CLASS}>
            Min reviews
          </label>
          <input
            id="minReviews"
            type="number"
            min={0}
            className={`${INPUT_CLASS} font-mono tabular-nums`}
            value={minReviewCount}
            onChange={(e) =>
              setMinReviewCount(Math.max(0, Number(e.target.value) || 0))
            }
            title="Set this to filter out shops with no review history."
          />
          <p className="text-xs text-neutral-500 mt-1.5">
            Filter out shops with no review history.
          </p>
        </div>
        <div>
          <label htmlFor="maxReviews" className={LABEL_CLASS}>
            Max reviews
          </label>
          <input
            id="maxReviews"
            type="number"
            min={0}
            className={`${INPUT_CLASS} font-mono tabular-nums`}
            value={maxReviewCount}
            onChange={(e) =>
              setMaxReviewCount(Math.max(0, Number(e.target.value) || 0))
            }
            title="Shops with more reviews than this are usually chains or very large operations."
          />
          <p className="text-xs text-neutral-500 mt-1.5">
            Above this is usually a chain or big operation.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="maxPlaces" className={LABEL_CLASS}>
          Max places
        </label>
        <input
          id="maxPlaces"
          type="number"
          min={1}
          max={MAX_PLACES_HARD_CAP}
          className={`${INPUT_CLASS} font-mono tabular-nums`}
          value={maxPlaces}
          onChange={(e) =>
            setMaxPlaces(
              Math.max(
                1,
                Math.min(MAX_PLACES_HARD_CAP, Number(e.target.value) || 1),
              ),
            )
          }
          title="Hard cap on unique places sent to filter + Twilio. Keeps cost predictable."
        />
        <p className="text-xs text-neutral-500 mt-1.5">
          Hard cap on unique places after dedup (max {MAX_PLACES_HARD_CAP}).
        </p>
      </div>

      <label
        htmlFor="twilio"
        className="flex items-start gap-3 border border-neutral-300 p-3 cursor-pointer hover:border-neutral-900"
      >
        <input
          id="twilio"
          type="checkbox"
          className="mt-0.5 accent-neutral-900"
          checked={runTwilioLookup}
          onChange={(e) => setRunTwilioLookup(e.target.checked)}
        />
        <div className="text-sm">
          <div className="font-medium">Run Twilio phone validation</div>
          <p className="text-neutral-500 text-xs mt-0.5 leading-relaxed">
            Line type (landline / mobile / voip) via Twilio Lookup v2.
            Upper-bound:{" "}
            <span className="font-mono tabular-nums">
              ${TWILIO_PRICE_PER_LOOKUP_USD.toFixed(3)} × {estimatedPhones} = $
              {estimatedCostUsd.toFixed(2)}
            </span>
            . Actual is usually lower after filter.
          </p>
        </div>
      </label>

      {validationError && (
        <p className="text-sm text-neutral-900 border-l-2 border-neutral-900 pl-3 py-1">
          {validationError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-neutral-900 hover:bg-black disabled:bg-neutral-400 text-white text-sm font-medium py-2.5 tracking-wide"
      >
        {loading ? "Running…" : "Generate leads"}
      </button>
    </form>
  );
}
