// wikipedia.client.ts
import axios from "axios";
import { asciiFold } from "../utils/asciiFold";
import { cacheService } from "../services/cache.service";
import {
  EXTERNAL_APIS,
  COUNTRY_LABELS,
  SupportedCountry,
  RATE_LIMITS,
} from "../utils/constants";

type QueryPage = {
  pageid?: number;
  ns: number;
  title: string;
  missing?: true;
  extract?: string;
  categories?: { title: string }[];
  pageprops?: { disambiguation?: string };
};

const API = EXTERNAL_APIS.WIKIPEDIA_BASE_URL;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runInPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  const executing: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = worker(items[i], i).finally(() => {
      const idx = executing.indexOf(p);
      if (idx >= 0) executing.splice(idx, 1);
    });
    executing.push(p);
    if (executing.length >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
}

// ——— Validation heuristics (short and safe for enwiki) ———
const NEG_INTRO =
  /\b(is|was|are|were)\s+(?:an?|the)\s+(?:[a-z-]+\s+){0,4}(district|county|province|region|suburb|neighbou?rhood|borough|ward|township|village|hamlet|airport|railway\s+station|metro\s+station|university|power\s+(?:plant|station)|park|lake|river)\b/i;

const POS_INTRO =
  /\b(is|was|are|were)\s+(?:an?|the)\s+(?:[a-z-]+\s+){0,4}(city|capital|metropolis|municipality|independent\s+city|city[-\s]state|city[-\s]county)\b/i;

const CAT_ALLOW: RegExp[] = [
  /^Category:Cities?(?: and towns)? in .+/i,
  /^Category:City counties of .+/i,
  /^Category:Port cities and towns .+/i,
  /^Category:Capitals (?:of|in) .+/i,
  /^Category:Municipalities in .+/i,
];

const CAT_DENY: RegExp[] = [
  /^Category:(Districts|Suburbs|Neighbourhoods|Neighborhoods|Villages|Towns|Townships|Boroughs) in .+/i,
  /^Category:.* (railway stations|airports|power stations|universities|lakes|rivers) in .+/i,
];

// Build resolved title using normalized/redirects arrays
function resolveTitle(
  input: string,
  normalized: Array<{ from: string; to: string }> = [],
  redirects: Array<{ from: string; to: string }> = []
): string {
  // chain: input -> normalized.to (if any) -> redirects.to (if any)
  const norm = normalized.find((n) => n.from === input)?.to ?? input;
  const redir = redirects.find((r) => r.from === norm)?.to ?? norm;
  return redir;
}

function firstSentence(s: string): string {
  const noParens = s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = noParens.match(/^[^.!?]+/);
  return (m ? m[0] : noParens).trim();
}

// Validate a single page
function validatePageIsCity(p: QueryPage): { ok: boolean; reason: string } {
  if (p.missing) return { ok: false, reason: "missing" };
  if (p.ns !== 0) return { ok: false, reason: "not-article" };
  if (p.pageprops?.disambiguation !== undefined)
    return { ok: false, reason: "disambiguation" };

  const cats = (p.categories || []).map((c) => c.title);
  if (cats.some((c) => CAT_DENY.some((rx) => rx.test(c))))
    return { ok: false, reason: "deny-category" };
  if (cats.some((c) => CAT_ALLOW.some((rx) => rx.test(c))))
    return { ok: true, reason: "allow-category" };

  const introFull = (p.extract || "").trim();
  if (!introFull) return { ok: false, reason: "no-intro" };

  const intro = firstSentence(introFull);

  // ✅ Prefer positive signal
  if (POS_INTRO.test(intro)) return { ok: true, reason: "intro-cityish" };

  // 🚫 Then look for a strong negative head noun
  if (NEG_INTRO.test(intro)) return { ok: false, reason: "intro-noncity" };

  return { ok: false, reason: "no-signal" };
}

export class WikipediaClient {
  private action: any;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor() {
    this.action = axios.create({
      baseURL: API,
      timeout: 2500,
      headers: { "User-Agent": "BookingGuruCities/1.0" },

      validateStatus: (status) => status < 500,
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await requestFn();
      } catch (error: any) {
        lastError = error;

        if (this.isRetryableError(error)) {
          // Exponential backoff
          const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
          console.warn(
            `Wikipedia API ${context} failed (attempt ${attempt}/${this.MAX_RETRIES}): ${error.message}. Retrying in ${delay}ms...`
          );

          if (attempt < this.MAX_RETRIES) {
            await this.sleep(delay);
            continue;
          }
        }

        break;
      }
    }

    // All retries failed or non-retryable error
    console.error(
      `Wikipedia API ${context} failed after ${this.MAX_RETRIES} attempts:`,
      lastError.message
    );
    throw new Error(`Wikipedia API unavailable: ${lastError.message}`);
  }

  private isRetryableError(error: any): boolean {
    if (error.code) {
      // Network errors that are worth retrying
      const retryableCodes = [
        "ETIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        "ENETUNREACH",
        "ENOTFOUND",
        "EAI_AGAIN",
      ];

      if (retryableCodes.includes(error.code)) {
        return true;
      }
    }

    // HTTP status codes worth retrying
    if (error.response?.status) {
      const retryableStatuses = [408, 429, 502, 503, 504];
      return retryableStatuses.includes(error.response.status);
    }

    return false;
  }

  // Single batch call (with category continuation handled internally)
  private async fetchBatchSingle(titles: string[]): Promise<{
    normalized: Array<{ from: string; to: string }>;
    redirects: Array<{ from: string; to: string }>;
    pagesByTitle: Map<string, QueryPage>;
  }> {
    const base = {
      action: "query",
      format: "json",
      formatversion: 2,
      redirects: 1,
      prop: "pageprops|categories|extracts",
      ppprop: "wikibase_item|disambiguation",
      clshow: "!hidden",
      cllimit: "max",
      exintro: 1,
      explaintext: 1,
      exsentences: 2,
      titles: titles.join("|"),
      origin: "*",
    } as const;

    return this.retryRequest(async () => {
      let cont: Record<string, string> | undefined;
      const pagesByTitle = new Map<string, QueryPage>();
      const normalizedAll: Array<{ from: string; to: string }> = [];
      const redirectsAll: Array<{ from: string; to: string }> = [];

      do {
        const params = cont ? { ...base, ...cont } : base;
        const { data } = await this.action.get("", { params });

        if (data.query?.normalized)
          normalizedAll.push(...data.query.normalized);
        if (data.query?.redirects) redirectsAll.push(...data.query.redirects);

        for (const p of data.query?.pages || []) {
          const key = p.title; // exact case
          const prev = pagesByTitle.get(key);
          if (!prev) {
            pagesByTitle.set(key, {
              ...p,
              categories: p.categories ? [...p.categories] : [],
            });
          } else {
            // merge categories/extract across clcontinue pages
            if (p.extract && !prev.extract) prev.extract = p.extract;
            if (p.pageprops && !prev.pageprops) prev.pageprops = p.pageprops;
            if (Array.isArray(p.categories)) {
              const seen = new Set(prev.categories?.map((c) => c.title));
              for (const c of p.categories)
                if (!seen.has(c.title)) prev.categories!.push(c);
            }
          }
        }

        cont = data.continue;
      } while (cont && cont.clcontinue);

      return {
        normalized: normalizedAll,
        redirects: redirectsAll,
        pagesByTitle,
      };
    }, `batch fetch for ${titles.length} titles`);
  }

  /**
   * Chunk-aware fetch: splits 'titles' into ≤50, runs with small concurrency,
   * and merges normalized/redirects/pages across chunks.
   */
  private async fetchBatch(titles: string[]): Promise<{
    normalized: Array<{ from: string; to: string }>;
    redirects: Array<{ from: string; to: string }>;
    pagesByTitle: Map<string, QueryPage>;
  }> {
    // ---- Limits / helpers for batching ----
    const MAX_TITLES = RATE_LIMITS.WIKIPEDIA_API.MAX_TITLES;
    const CONCURRENCY = RATE_LIMITS.WIKIPEDIA_API.MAX_CONCURRENCY;
    if (titles.length <= MAX_TITLES) {
      return this.fetchBatchSingle(titles);
    }

    const batches = chunk(titles, MAX_TITLES);

    const normalizedAll: Array<{ from: string; to: string }> = [];
    const redirectsAll: Array<{ from: string; to: string }> = [];
    const pagesByTitle = new Map<string, QueryPage>();

    await runInPool(batches, CONCURRENCY, async (batch) => {
      try {
        const r = await this.fetchBatchSingle(batch);
        normalizedAll.push(...r.normalized);
        redirectsAll.push(...r.redirects);

        // Increased delay between requests to be more respectful
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // merge pages
        for (const [k, v] of r.pagesByTitle.entries()) {
          const prev = pagesByTitle.get(k);
          if (!prev) {
            pagesByTitle.set(k, {
              ...v,
              categories: v.categories ? [...v.categories] : [],
            });
          } else {
            if (v.extract && !prev.extract) prev.extract = v.extract;
            if (v.pageprops && !prev.pageprops) prev.pageprops = v.pageprops;
            if (Array.isArray(v.categories)) {
              const seen = new Set(prev.categories?.map((c) => c.title));
              for (const c of v.categories)
                if (!seen.has(c.title)) prev.categories!.push(c);
            }
          }
        }
      } catch (error: any) {
        // The missing data will be handled as null results
        console.error(`Failed to fetch batch:`, error.message);
      }
    });

    return { normalized: normalizedAll, redirects: redirectsAll, pagesByTitle };
  }

  /**
   * Get city descriptions for many titles.
   * Pass 1: query + validate.
   * Pass 2 (retry once): re-query only the unresolved titles, with disambiguation handling.
   */
  async getSummaries(
    titles: string[],
    country: SupportedCountry
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (!titles.length) return result;

    try {
      // Check cache first
      const cacheResults = cacheService.getWikiDescriptionsBatch(titles);
      const uncachedTitles: string[] = [];

      for (const title of titles) {
        const cached = cacheResults.get(title);
        if (cached !== undefined) {
          result.set(title, cached);
        } else {
          uncachedTitles.push(title);
        }
      }

      if (!uncachedTitles.length) {
        console.log(
          `All ${titles.length} Wikipedia descriptions served from cache`
        );
        return result;
      }

      console.log(
        `Fetching ${uncachedTitles.length}/${titles.length} Wikipedia descriptions from API`
      );

      // PASS 1
      const r1 = await this.fetchBatch(uncachedTitles);

      // Helper to find the page for an input
      const getPage = (
        input: string,
        r: ReturnType<WikipediaClient["fetchBatch"]> extends Promise<infer T>
          ? T
          : never
      ) => {
        const resolved = resolveTitle(input, r.normalized, r.redirects);
        // exact title first
        let page = r.pagesByTitle.get(resolved);
        if (!page) {
          // try case-insensitive fallback (rare)
          const lower = resolved.toLowerCase();
          for (const [k, v] of r.pagesByTitle.entries()) {
            if (k.toLowerCase() === lower) {
              page = v;
              break;
            }
          }
        }
        return page;
      };

      // Track what needs retry and how to map back to original titles
      const retryMap = new Map<string, string>(); // queryTitle -> originalTitle
      const unresolved: string[] = [];

      for (const input of uncachedTitles) {
        const page = getPage(input, r1);
        if (!page) {
          unresolved.push(input);
          retryMap.set(input, input);
          continue;
        }

        const verdict = validatePageIsCity(page);

        if (verdict.reason === "disambiguation") {
          const countryLabel = COUNTRY_LABELS[country];
          const newInput = `${input}, ${countryLabel}`;
          unresolved.push(newInput);
          retryMap.set(newInput, input);
        } else if (verdict.ok) {
          const description = (page.extract || "").trim() || null;
          result.set(input, description);
          cacheService.setWikiDescription(input, description);
        } else if (
          verdict.reason === "missing" ||
          verdict.reason === "no-intro" ||
          verdict.reason === "no-signal"
        ) {
          // retry these once
          unresolved.push(input);
          retryMap.set(input, input);
        } else {
          result.set(input, null); // deny-category / not-article
          cacheService.setWikiDescription(input, null);
        }
      }

      if (!unresolved.length) return result;

      // ASCII fold for retry queries
      const asciiFoldMap = new Map<string, string>();
      for (const queryTitle of unresolved) {
        const folded = asciiFold(queryTitle, { removePunctuation: false });
        asciiFoldMap.set(folded, queryTitle);
      }

      const foldedTitles = Array.from(asciiFoldMap.keys());

      // PASS 2 (retry same API once)
      const r2 = await this.fetchBatch(foldedTitles);
      for (const foldedTitle of foldedTitles) {
        const queryTitle = asciiFoldMap.get(foldedTitle)!;
        const originalTitle = retryMap.get(queryTitle)!;

        const page = getPage(foldedTitle, r2);
        if (!page) {
          result.set(originalTitle, null);
          await cacheService.setWikiDescription(originalTitle, null);
          continue;
        }

        const verdict = validatePageIsCity(page);
        const description = verdict.ok
          ? (page.extract || "").trim() || null
          : null;
        result.set(originalTitle, description); // Always use original title as key
        await cacheService.setWikiDescription(originalTitle, description);
      }

      return result;
    } catch (error: any) {
      console.error("Wikipedia API completely failed:", error.message);

      // Return null for all requested titles if Wikipedia is completely down
      for (const title of titles) {
        if (!result.has(title)) {
          result.set(title, null);
          cacheService.setWikiDescription(title, null, 5 * 60 * 1000); // Cache failure for 5 minutes
        }
      }

      return result;
    }
  }
}
