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
    country: CityResult["country"],
    limit = 10,
    page = 1
  ): Promise<{ cities: CityResult[]; hasMore: boolean }> {
    const offset = (page - 1) * limit;
    const want = Math.max(1, Math.min(limit, 50));

    // Get from cache service
    const cacheEntry = cacheService.getCountryCache(country);

    // Check if we have enough cached data for this page
    if (cacheEntry && cacheEntry.cities.length >= offset + want) {
      const startIndex = offset;
      const endIndex = offset + want;

      console.log(
        `Cache hit: returning page ${page} (${startIndex}-${endIndex}) from ${cacheEntry.cities.length} cached cities`
      );

      return {
        cities: cacheEntry.cities
          .sort((a, b) => b.pollution - a.pollution)
          .slice(startIndex, endIndex),
        hasMore: endIndex < cacheEntry.cities.length,
      };
    }

    // Calculate how many cities we need to fetch
    const neededCities = offset + want;
    const alreadyHave = cacheEntry?.cities.length || 0;
    const needMore = Math.max(0, neededCities - alreadyHave);

    if (alreadyHave > 0) {
      console.log(
        `Partial cache hit: have ${alreadyHave}, need ${needMore} more cities for page ${page}`
      );
    } else {
      console.log(
        `Cache miss: fetching fresh data for ${country} cities (page ${page}, ${want} requested)`
      );
    }

    const chosen: CityResult[] = cacheEntry ? [...cacheEntry.cities] : [];
    const seen = new Set<string>(chosen.map((c) => cityKey(c.city, c.country)));

    let currentPage = cacheEntry ? cacheEntry.lastPage + 1 : 1;
    let totalPages: number | null = cacheEntry?.totalPages || null;

    // Keep pulling until we have enough for the requested page
    while (chosen.length < neededCities) {
      if (totalPages && currentPage > totalPages) {
        console.log(`Reached end of pages (${totalPages}) for ${country}`);
        break;
      }

      const resp = await this.pollu.fetchCountryPage(
        country,
        currentPage,
        Math.max(1, 50) // Always fetch max to build better cache
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
        if (currentPage >= (totalPages ?? 1)) {
          // Mark as complete - merge with existing cache
          const updatedCacheData = {
            cities: chosen, // All cities we have so far
            lastPage: currentPage - 1,
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
        currentPage++;
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

      // Update cache with new cities from this page
      const isComplete = currentPage >= (totalPages ?? 1);
      const updatedCacheData = {
        cities: chosen, // All cities accumulated so far
        lastPage: currentPage,
        totalPages,
        timestamp: Date.now(),
        isComplete,
      };
      cacheService.setCountryCache(country, updatedCacheData);

      if (currentPage >= (totalPages ?? 1)) break;
      currentPage++;
    }

    // Return paginated results
    const startIndex = offset;
    const endIndex = Math.min(offset + want, chosen.length);

    const result = chosen
      .sort((a, b) => b.pollution - a.pollution)
      .slice(startIndex, endIndex);

    console.log(
      `Returning page ${page}: ${result.length} cities (${startIndex}-${endIndex} of ${chosen.length} total)`
    );

    return {
      cities: result,
      hasMore: endIndex < chosen.length,
    };
  }

  getCacheStats() {
    return cacheService.getCacheStats();
  }
}
