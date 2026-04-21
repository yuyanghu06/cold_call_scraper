import type { IndustryPreset } from "./types";

export const DEFAULT_MAX_REVIEW_COUNT = 400;
export const DEFAULT_MIN_REVIEW_COUNT = 0;
export const DEFAULT_RADIUS_METERS = 50000;
export const DEFAULT_MAX_PLACES = 500;

export const MAX_KEYWORDS_PER_REQUEST = 20;
export const MAX_RESULTS_PER_KEYWORD = 60;
export const MAX_PLACES_HARD_CAP = 5000;
export const MAX_TWILIO_PHONES_PER_REQUEST = 2000;
export const TWILIO_CONCURRENCY_LIMIT = 10;

export const TWILIO_PRICE_PER_LOOKUP_USD = 0.015;
export const GOOGLE_PLACES_PRO_PRICE_PER_CALL_USD = 0.02;

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: "auto-repair",
    label: "Auto repair / mechanic shops",
    keywords: [
      "auto repair",
      "mechanic",
      "auto service",
      "automotive repair",
      "brake shop",
      "transmission repair",
      "tire shop",
      "oil change",
    ],
    excludeChains: [
      "Mavis",
      "Firestone",
      "Midas",
      "Meineke",
      "Jiffy Lube",
      "Monro",
      "Pep Boys",
      "Valvoline",
      "AAMCO",
      "Grease Monkey",
      "Express Oil",
      "Christian Brothers",
      "Big O Tires",
      "Discount Tire",
      "Mr. Tire",
      "NTB",
      "Goodyear",
      "Pirelli",
      "Precision Tune",
      "Maaco",
      "Caliber Collision",
      "Gerber Collision",
      "Service King",
      "CARSTAR",
      "Ziebart",
      "Tuffy",
      "Car-X",
      "Brake Check",
    ],
  },
  {
    id: "auto-body",
    label: "Auto body / collision",
    keywords: [
      "auto body shop",
      "collision repair",
      "auto body",
      "body shop",
      "paint shop automotive",
    ],
    excludeChains: [
      "Maaco",
      "Caliber Collision",
      "Gerber Collision",
      "Service King",
      "CARSTAR",
      "ABRA",
      "Crash Champions",
    ],
  },
  {
    id: "hvac",
    label: "HVAC",
    keywords: [
      "hvac",
      "heating and cooling",
      "air conditioning repair",
      "hvac contractor",
      "furnace repair",
    ],
    excludeChains: [
      "One Hour Heating",
      "ARS",
      "Lennox",
      "Carrier",
      "Trane",
      "Service Experts",
      "Horizon Services",
    ],
  },
  {
    id: "plumbing",
    label: "Plumbing",
    keywords: [
      "plumber",
      "plumbing contractor",
      "plumbing repair",
      "emergency plumber",
    ],
    excludeChains: [
      "Roto-Rooter",
      "Benjamin Franklin Plumbing",
      "Mr. Rooter",
      "Horizon Services",
      "ARS",
      "Rescue Rooter",
    ],
  },
  {
    id: "electrical",
    label: "Electrical",
    keywords: [
      "electrician",
      "electrical contractor",
      "electrical repair",
      "residential electrician",
    ],
    excludeChains: ["Mister Sparky", "Mr. Electric", "ARS"],
  },
  {
    id: "landscaping",
    label: "Landscaping",
    keywords: [
      "landscaping",
      "lawn care",
      "landscape contractor",
      "tree service",
      "lawn maintenance",
    ],
    excludeChains: [
      "TruGreen",
      "Brightview",
      "The Grounds Guys",
      "LawnStarter",
      "Weed Man",
    ],
  },
  {
    id: "cleaning",
    label: "Cleaning / janitorial",
    keywords: [
      "commercial cleaning",
      "janitorial service",
      "office cleaning",
      "commercial cleaner",
    ],
    excludeChains: [
      "ServiceMaster",
      "ServPro",
      "Stanley Steemer",
      "Jan-Pro",
      "Jani-King",
      "Coverall",
      "Merry Maids",
      "The Cleaning Authority",
    ],
  },
  {
    id: "warehousing",
    label: "Warehousing / 3PL",
    keywords: [
      "warehouse",
      "3PL",
      "third party logistics",
      "fulfillment center",
      "distribution center",
    ],
    excludeChains: [
      "Amazon",
      "UPS",
      "FedEx",
      "DHL",
      "XPO",
      "GXO",
      "Ryder",
      "Penske Logistics",
      "DB Schenker",
      "Kuehne + Nagel",
    ],
  },
  {
    id: "construction",
    label: "Construction / general contracting",
    keywords: [
      "general contractor",
      "home builder",
      "construction company",
      "remodeling contractor",
    ],
    excludeChains: [
      "Power Home Remodeling",
      "Home Depot",
      "Lowe's",
      "Re-Bath",
      "Bath Fitter",
    ],
  },
  {
    id: "moving",
    label: "Moving / storage",
    keywords: [
      "moving company",
      "movers",
      "storage facility",
      "self storage",
    ],
    excludeChains: [
      "U-Haul",
      "Public Storage",
      "Extra Space Storage",
      "CubeSmart",
      "Life Storage",
      "PODS",
      "Two Men and a Truck",
      "College Hunks",
      "Allied",
      "North American Van Lines",
      "Mayflower",
      "Bekins",
    ],
  },
];
