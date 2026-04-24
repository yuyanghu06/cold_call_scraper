import type { GeocodedLocation } from "@/lib/types";

export interface PlacesSearchArea {
  center: GeocodedLocation;
  radiusMeters: number;
}
