// cityFilter.ts (simplified)
import { asciiFold } from "./asciiFold";
import { toNameCase } from "./nameCase";

type RawEntry = { name: string; pollution?: number };

export type Verdict = "keep" | "salvage" | "reject";
export type FilterResult =
  | {
      verdict: "keep";
      city: string;
      englishCity: string;
      reason: string;
      confidence: number;
    }
  | {
      verdict: "salvage";
      city: string;
      englishCity: string;
      reason: string;
      confidence: number;
    }
  | {
      verdict: "reject";
      reason: string;
      confidence: number;
      englishCity: string;
    };

const normalize = (s: string) =>
  s?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";

const DIR = [
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
];

const FACILITY = [
  "airport",
  "station",
  "terminal",
  "harbor",
  "harbour",
  "port",
  "metro",
  "railway",
  "bus",
  "power plant",
  "refinery",
  "mine",
  "industrial",
  "zone",
  "park",
  "bridge",
  "dam",
  "factory",
  "plant",
  "works",
  "depot",
  "yard",
  "stadium",
  "arena",
  "mall",
  "market",
  "plaza",
  "campus",
  "university",
  "college",
  "hospital",
  "clinic",
];

const ADMIN = [
  "state",
  "province",
  "region",
  "county",
  "district",
  "prefecture",
  "municipality",
  "commune",
  "arrondissement",
  "borough",
  "canton",
  "parish",
  "division",
  "ward",
  "zone",
];

const NON_CITY_LOCALITY = [
  "village",
  "hamlet",
  "suburb",
  "neighbourhood",
  "neighborhood",
  "sector",
  "block",
  "phase",
  "quarter",
  "colony",
  "township",
];

const PLACEHOLDER = ["unknown", "n/a", "null", "test", "sample", "area"];

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (s: string, words: string[]) =>
  words.some((w) => new RegExp(`\\b${escapeRx(w)}\\b`, "iu").test(s));

const hasDigits = (s: string) => /\d/.test(s);
const hasBadSymbols = (s: string) => /[@/_#|\\]/.test(s);
const mostlyNonLetters = (s: string) => {
  const letters = (s.match(/\p{L}/gu) || []).length;
  return letters === 0 || letters / s.length < 0.5;
};

// Strip final parentheses: "Name (District)" -> "Name"
const stripParen = (s: string) => s.replace(/\s*\(([^)]+)\)\s*$/u, "").trim();
// Strip trailing directionals like "-East"
const stripDirectional = (s: string) => {
  const re = new RegExp(
    `\\s*[-–—]?\\s*(?:${DIR.map(escapeRx).join("|")})\\b\\.?$`,
    "iu"
  );
  return s.replace(re, "").trim();
};
// Handle "City of X" / "X City" (multilingual variants omitted for simplicity)
const salvageCityOf = (s: string) => {
  const cityWords = "city|capital|metropolis|municipality";
  const ofRe = new RegExp(`^(?:${cityWords})\\s+of\\s+(.+)$`, "iu");
  const postRe = new RegExp(`^(.+?)\\s+(?:${cityWords})$`, "iu");
  if (ofRe.test(s)) return s.replace(ofRe, "$1").trim();
  if (postRe.test(s)) return s.replace(postRe, "$1").trim();
  return s;
};

function baseName(
  raw: string,
  locale = "en"
): {
  base: string;
  changed: boolean;
  quals: string[];
} {
  const quals: string[] = [];
  let name = normalize(raw);
  const before = name;

  const hadParen = /\(([^)]+)\)\s*$/u.test(name);
  if (hadParen) {
    name = stripParen(name);
    quals.push("paren");
  }
  const afterParen = name;
  name = stripDirectional(name);
  if (name !== afterParen) quals.push("direction");
  const afterDir = name;
  name = salvageCityOf(name);
  if (name !== afterDir) quals.push("city-noun");

  // Simple title-case
  name = name.toLowerCase().replace(/(^|\s|[-'’])/gu, (m) => m.toUpperCase());

  name = toNameCase(name, locale);

  return { base: name, changed: name !== before, quals };
}

function looksLikeFacilityOrAdmin(s: string): boolean {
  const low = s.toLowerCase();
  if (hasWord(low, PLACEHOLDER) && hasDigits(low)) return true;
  if (
    hasWord(low, FACILITY) ||
    hasWord(low, ADMIN) ||
    hasWord(low, NON_CITY_LOCALITY)
  )
    return true;
  if (hasDigits(low) && (hasWord(low, FACILITY) || hasWord(low, ADMIN)))
    return true;
  return false;
}

export function classify(raw: RawEntry, locale = "en"): FilterResult {
  const original = normalize(raw.name || "");
  const englishOriginal = asciiFold(original, { removePunctuation: true });
  if (!original)
    return {
      verdict: "reject",
      reason: "empty",
      confidence: 1,
      englishCity: englishOriginal,
    };
  if (hasBadSymbols(original) || mostlyNonLetters(original)) {
    return {
      verdict: "reject",
      reason: "bad-shape",
      confidence: 1,
      englishCity: englishOriginal,
    };
  }

  const { base, changed, quals } = baseName(original, locale);
  const englishBase = asciiFold(base, { removePunctuation: true });

  if (base.length < 2 || base.length > 64) {
    return {
      verdict: "reject",
      reason: "length",
      confidence: 1,
      englishCity: englishBase,
    };
  }

  //   if (lowerName.includes('station') ||
  //   lowerName.includes('powerplant') ||
  //   lowerName.includes('industrial') ||
  //   lowerName.includes('district') ||
  //   lowerName.includes('zone') ||
  //   lowerName.includes('monitoring')) {
  //   return false;
  // }

  // If original mentions facility/admin → try to salvage; else reject
  if (looksLikeFacilityOrAdmin(original)) {
    if (looksLikeFacilityOrAdmin(base) || hasDigits(base)) {
      return {
        verdict: "reject",
        reason: "facility/admin",
        confidence: 1,
        englishCity: englishBase,
      };
    }
    return {
      verdict: "salvage",
      city: base,
      englishCity: englishBase,
      reason: `salvaged:${quals.join(",") || "qualifier"}`,
      confidence: 0.7,
    };
  }

  if (hasDigits(base)) {
    return {
      verdict: "reject",
      reason: "digits",
      confidence: 1,
      englishCity: englishBase,
    };
  }

  // Clean-looking toponym
  if (!changed) {
    return {
      verdict: "keep",
      city: base,
      englishCity: englishBase,
      reason: "heuristic",
      confidence: 0.9,
    };
  }
  return {
    verdict: "salvage",
    city: base,
    englishCity: englishBase,
    reason: `normalized:${quals.join(",")}`,
    confidence: 0.7,
  };
}
