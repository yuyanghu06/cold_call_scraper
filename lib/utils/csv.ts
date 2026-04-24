import type { Place } from "@/lib/types";

const COLUMNS = [
  "shop_name",
  "phone",
  "phone_verified",
  "phone_line_type",
  "address",
  "city",
  "state",
  "zip",
  "website",
  "google_rating",
  "google_review_count",
  "categories",
  "google_maps_url",
  "latitude",
  "longitude",
  "place_id",
  "notes",
] as const;

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function placeToRow(p: Place): string[] {
  return [
    p.name,
    p.phone ?? "",
    p.phoneVerified === undefined ? "" : p.phoneVerified ? "true" : "false",
    p.phoneLineType ?? "",
    p.address,
    p.city ?? "",
    p.state ?? "",
    p.zip ?? "",
    p.website ?? "",
    p.rating === null ? "" : String(p.rating),
    p.reviewCount === null ? "" : String(p.reviewCount),
    p.categories.join("|"),
    p.googleMapsUrl,
    p.latitude === null ? "" : String(p.latitude),
    p.longitude === null ? "" : String(p.longitude),
    p.placeId,
    "",
  ];
}

export function placesToCsv(places: Place[]): string {
  const header = COLUMNS.map(escapeCell).join(",");
  const rows = places.map((p) => placeToRow(p).map(escapeCell).join(","));
  return [header, ...rows].join("\r\n");
}
