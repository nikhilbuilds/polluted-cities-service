// Application Constants

// Supported countries for pollution data
export const SUPPORTED_COUNTRIES = ["PL", "DE", "ES", "FR"] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

// API Limits
export const API_LIMITS = {
  MIN_CITY_LIMIT: 1,
  MAX_CITY_LIMIT: 50,
  DEFAULT_CITY_LIMIT: 10,
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  POLLUTION_TTL: 5 * 60 * 1000, // 5 minutes
  WIKIPEDIA_TTL: 24 * 60 * 60 * 1000, // 24 hours
  COUNTRY_TTL: 2 * 60 * 60 * 1000, // 2 hours

  // LRU Cache Sizes
  POLLUTION_CACHE_SIZE: 500,
  WIKIPEDIA_CACHE_SIZE: 1000,
  COUNTRY_CACHE_SIZE: 50,
} as const;

// Rate Limiting
export const RATE_LIMITS = {
  POLLUTION_API: {
    MAX_REQUESTS: 5,
    WINDOW_MS: 10000, // 10 seconds
    MAX_RETRIES: 3,
  },
  WIKIPEDIA_API: {
    MAX_CONCURRENCY: 2, // Wikipedia API limit
    MAX_TITLES: 20,
  },
} as const;

// External API URLs
export const EXTERNAL_APIS = {
  POLLUTION_BASE_URL: "https://be-recruitment-task.onrender.com",
  WIKIPEDIA_BASE_URL: "https://en.wikipedia.org/w/api.php",
} as const;

// City Name Validation
export const CITY_VALIDATION = {
  MIN_LENGTH: 2,
  MAX_LENGTH: 64,
  BLACKLISTED_NAMES: [
    "unknown",
    "n/a",
    "na",
    "null",
    "undefined",
    "test",
    "lorem",
    "sample",
    "example",
  ],
} as const;

// Country Labels for Wikipedia disambiguation
export const COUNTRY_LABELS: Record<SupportedCountry, string> = {
  PL: "Poland",
  DE: "Germany",
  ES: "Spain",
  FR: "France",
} as const;
