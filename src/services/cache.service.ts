interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

import { CACHE_CONFIG, SupportedCountry } from "../utils/constants";

interface CountryCacheData {
  cities: Array<{
    country: SupportedCountry;
    city: string;
    pollution: number;
    description: string | null;
  }>;
  lastPage: number;
  totalPages: number | null;
  timestamp: number;
  isComplete: boolean;
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check expiry
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(key: string, data: T, ttl: number): void {
    this.cache.delete(key);

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export class CacheService {
  private pollutionCache = new LRUCache<any>(CACHE_CONFIG.POLLUTION_CACHE_SIZE);
  private wikiCache = new LRUCache<string | null>(
    CACHE_CONFIG.WIKIPEDIA_CACHE_SIZE
  );
  private countryCache = new LRUCache<CountryCacheData>(
    CACHE_CONFIG.COUNTRY_CACHE_SIZE
  );

  getPollutionPage(country: string, page: number, limit: number): any | null {
    const key = `${country}:${page}:${limit}`;
    return this.pollutionCache.get(key);
  }

  setPollutionPage(
    country: string,
    page: number,
    limit: number,
    data: any,
    ttl = CACHE_CONFIG.POLLUTION_TTL
  ): void {
    const key = `${country}:${page}:${limit}`;
    this.pollutionCache.set(key, data, ttl);
  }

  getWikiDescription(title: string): string | null | undefined {
    const result = this.wikiCache.get(title);
    return result === null ? undefined : result;
  }

  setWikiDescription(
    title: string,
    description: string | null,
    ttl = CACHE_CONFIG.WIKIPEDIA_TTL
  ): void {
    this.wikiCache.set(title, description, ttl);
  }

  getWikiDescriptionsBatch(
    titles: string[]
  ): Map<string, string | null | undefined> {
    const result = new Map<string, string | null | undefined>();

    titles.forEach((title) => {
      const cached = this.getWikiDescription(title);
      result.set(title, cached);
    });

    return result;
  }

  getCountryCache(country: string): CountryCacheData | null {
    return this.countryCache.get(country);
  }

  setCountryCache(
    country: string,
    data: CountryCacheData,
    ttl = CACHE_CONFIG.COUNTRY_TTL
  ): void {
    this.countryCache.set(country, data, ttl);
  }

  clearCache(): void {
    this.pollutionCache.clear();
    this.wikiCache.clear();
    this.countryCache.clear();
  }

  getCacheStats(): {
    totalKeys: number;
    pollutionKeys: number;
    wikiKeys: number;
    countryKeys: number;
  } {
    return {
      totalKeys:
        this.pollutionCache.size() +
        this.wikiCache.size() +
        this.countryCache.size(),
      pollutionKeys: this.pollutionCache.size(),
      wikiKeys: this.wikiCache.size(),
      countryKeys: this.countryCache.size(),
    };
  }
}

export const cacheService = new CacheService();
