import { PolluApiClient } from "../external/polluApi.client";
import { WikipediaClient } from "../external/wikipedia.client";
import { asciiFold } from "../utils/asciiFold";
import { classify } from "../utils/cityFilter";
import { cacheService } from "./cache.service";
import { SupportedCountry, API_LIMITS } from "../utils/constants";

export interface CityResult {
  country: SupportedCountry;
  city: string;
  pollution: number;
  description: string | null;
}

const parsePollution = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

const cityKey = (name: string, country: CityResult["country"]) =>
  `${asciiFold(name, { removePunctuation: true }).toLowerCase()}|${country}`;

export class CityService {
  constructor(
    private readonly pollu: PolluApiClient,
    private readonly wiki: WikipediaClient
  ) {}

  async getMostPollutedByCountry(
    country: SupportedCountry,
    limit = API_LIMITS.DEFAULT_CITY_LIMIT as number
  ): Promise<CityResult[]> {
    // Validate limit using constants
    limit = Math.max(
      API_LIMITS.MIN_CITY_LIMIT,
      Math.min(limit, API_LIMITS.MAX_CITY_LIMIT)
    );

    // Get from cache service
    const cacheEntry = cacheService.getCountryCache(country);

    if (cacheEntry && cacheEntry.cities.length >= limit) {
      console.log(
        `Cache hit: returning ${limit}/${cacheEntry.cities.length} cached cities for ${country}`
      );
      return cacheEntry.cities
        .sort((a, b) => b.pollution - a.pollution)
        .slice(0, limit);
    }

    // Check if cache is complete but has fewer cities than requested
    if (cacheEntry?.isComplete && cacheEntry.cities.length < limit) {
      console.log(
        `Cache complete but only ${cacheEntry.cities.length} cities available for ${country} (requested ${limit})`
      );
      return cacheEntry.cities.sort((a, b) => b.pollution - a.pollution);
    }

    const alreadyHave = cacheEntry?.cities.length || 0;
    const needMore = limit - alreadyHave;

    if (alreadyHave > 0) {
      console.log(
        `Partial cache hit: have ${alreadyHave}, need ${needMore} more cities for ${country}`
      );
    } else {
      console.log(
        `Cache miss: fetching fresh data for ${country} cities (${limit} requested)`
      );
    }

    const chosen: CityResult[] = cacheEntry ? [...cacheEntry.cities] : [];
    const seen = new Set<string>(chosen.map((c) => cityKey(c.city, c.country)));

    let page = cacheEntry ? cacheEntry.lastPage + 1 : 1;
    let totalPages: number | null = cacheEntry?.totalPages || null;

    // Keep pulling until we have enough or pages are exhausted
    while (chosen.length < limit) {
      if (totalPages && page > totalPages) {
        console.log(
          `Reached end of pages (${totalPages}) for ${country}. Have ${chosen.length}, wanted ${limit}`
        );
        break;
      }

      const resp = await this.pollu.fetchCountryPage(
        country,
        page,
        Math.max(1, 50)
      );

      totalPages = totalPages ?? resp.meta?.totalPages ?? 1;

      // 1) Sanitize + de-dupe candidates from this page
      const batch: {
        city: string;
        pollution: number;
        wikiTitle: string;
        key: string;
      }[] = [];

      for (const row of resp.results ?? []) {
        const pollution = parsePollution(row?.pollution);
        if (pollution === null) continue;

        const verdict = classify(
          {
            name: String(row?.name ?? ""),
            pollution,
          },
          country
        );
        if (verdict.verdict !== "keep" && verdict.verdict !== "salvage")
          continue;

        const city = verdict.city;
        const key = cityKey(city, country);
        if (seen.has(key)) continue; // drop dupes
        seen.add(key);

        let wikiTitle = city;

        // Format wiki title for 2-word cities
        if (wikiTitle.split(" ").length === 2) {
          const cap = (w: string) =>
            w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
          const parts = wikiTitle.split(/\s+/);
          if (parts.length === 2) {
            wikiTitle = `${cap(parts[0])}_${cap(parts[1])}`;
          } else {
            wikiTitle = parts.map(cap).join(" ");
          }
        }

        batch.push({ city, pollution, wikiTitle, key });
      }

      if (batch.length === 0) {
        if (page >= (totalPages ?? 1)) {
          // Mark as complete - merge with existing cache
          const updatedCacheData = {
            cities: chosen, // All cities we have so far
            lastPage: page - 1,
            totalPages,
            timestamp: Date.now(),
            isComplete: true,
          };
          cacheService.setCountryCache(country, updatedCacheData);
          console.log(
            `No more cities found. Marking ${country} as complete with ${chosen.length} cities`
          );
          break;
        }
        page++;
        continue;
      }

      // 2) Batch Wikipedia summaries for this batch
      const titles = batch.map((b) => b.wikiTitle);
      const descMap = await this.wiki.getSummaries(titles, country);

      // 3) Add cities with descriptions to our collection
      const newCities: CityResult[] = [];
      for (const { city, pollution, wikiTitle } of batch) {
        const description = (descMap.get(wikiTitle) ?? "").trim();
        if (description) {
          newCities.push({ country, city, pollution, description });
        }
      }

      chosen.push(...newCities);

      // Update cache with ALL cities accumulated so far
      const isComplete = page >= (totalPages ?? 1);
      const updatedCacheData = {
        cities: chosen, // All cities accumulated so far
        lastPage: page,
        totalPages,
        timestamp: Date.now(),
        isComplete,
      };
      cacheService.setCountryCache(country, updatedCacheData);

      console.log(
        `Page ${page}: Added ${newCities.length} new cities. Total: ${chosen.length}/${limit}`
      );

      if (page >= (totalPages ?? 1)) break;
      page++;
    }

    // Final ordering & trim
    const result = chosen
      .sort((a, b) => b.pollution - a.pollution)
      .slice(0, limit);

    console.log(
      `Returning ${result.length} cities for ${country} (${chosen.length} total in cache, requested ${limit})`
    );

    return result;
  }

  getCacheStats() {
    return cacheService.getCacheStats();
  }
}
