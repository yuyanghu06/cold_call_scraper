export interface SearchRequest {
  keywords: string[];
  location: string;
  radiusMeters: number;
  excludeChains: string[];
  maxReviewCount?: number;
  minReviewCount?: number;
  maxPlaces?: number;
  runTwilioLookup: boolean;
}

export interface GeocodedLocation {
  lat: number;
  lng: number;
}

export interface Place {
  placeId: string;
  name: string;
  phone: string | null;
  formattedPhone: string | null;
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
  phoneVerified?: boolean;
  phoneLineType?: string;
  industry?: string;
  excludedReason?: string;
}

export interface SearchResponse {
  totalFound: number;
  afterDedup: number;
  afterFilter: number;
  phoneValidated: number;
  results: Place[];
  excluded: Place[];
  csvData: string;
  warnings: string[];
}

export interface IndustryPreset {
  id: string;
  label: string;
  keywords: string[];
  excludeChains: string[];
}
