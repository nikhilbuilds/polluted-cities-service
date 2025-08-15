import axios from "axios";
import { env } from "../config/env";
import { cacheService } from "../services/cache.service";
import {
  SupportedCountry,
  RATE_LIMITS,
  EXTERNAL_APIS,
} from "../utils/constants";

interface LoginResponse {
  token: string;
  expiresIn: number;
  refreshToken?: string;
}

interface PollutionItem {
  name: unknown;
  pollution: unknown;
}

interface PollutionResponse {
  meta: { page: number; totalPages: number };
  results: PollutionItem[];
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class PolluApiClient {
  private static BASE_URL = EXTERNAL_APIS.POLLUTION_BASE_URL;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private refreshToken: string | null = null;
  private axiosInstance: any;

  // Rate limiting properties - 5 requests per 10 seconds

  private requestTimes: number[] = [];
  private readonly MAX_REQUESTS_PER_WINDOW =
    RATE_LIMITS.POLLUTION_API.MAX_REQUESTS;
  private readonly WINDOW_SIZE_MS = RATE_LIMITS.POLLUTION_API.WINDOW_MS;
  private readonly MAX_RETRIES = RATE_LIMITS.POLLUTION_API.MAX_RETRIES;

  constructor(
    private readonly username: string = env.polluApiUsername!,
    private readonly password: string = env.polluApiPassword!
  ) {
    this.axiosInstance = axios.create({
      baseURL: PolluApiClient.BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async rateLimitedRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    // Clean old request times outside the window
    const now = Date.now();
    this.requestTimes = this.requestTimes.filter(
      (time) => now - time < this.WINDOW_SIZE_MS
    );

    // If we've made 5 requests in the last 10 seconds, wait
    if (this.requestTimes.length >= this.MAX_REQUESTS_PER_WINDOW) {
      const oldestRequest = Math.min(...this.requestTimes);
      const waitTime = this.WINDOW_SIZE_MS - (now - oldestRequest);

      if (waitTime > 0) {
        console.log(`Rate limit: waiting ${waitTime}ms before next request...`);
        await this.sleep(waitTime + 100); // Add small buffer
      }
    }

    // Record this request time
    this.requestTimes.push(Date.now());

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await requestFn();
      } catch (error: any) {
        if (error.response?.status === 429) {
          // Rate limited - implement exponential backoff
          const retryAfter = error.response.headers["retry-after"];
          const backoffDelay = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.min(2000 * Math.pow(2, attempt - 1), 30000);

          console.warn(
            `Rate limited (429). Attempt ${attempt}/${this.MAX_RETRIES}. Waiting ${backoffDelay}ms...`
          );

          if (attempt === this.MAX_RETRIES) {
            throw new Error(
              `Rate limit exceeded after ${this.MAX_RETRIES} attempts. API allows 5 requests per 10 seconds.`
            );
          }

          await this.sleep(backoffDelay);
          continue;
        }

        throw error;
      }
    }

    throw new Error("Unexpected error in rate limited request");
  }

  private async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 5000) {
      return this.token;
    }

    if (this.refreshToken) {
      try {
        const response = await this.rateLimitedRequest(() =>
          this.axiosInstance.post("/auth/refresh", {
            refreshToken: this.refreshToken,
          })
        );

        const data = (response as any).data as LoginResponse;
        this.token = data.token;
        this.tokenExpiresAt = Date.now() + (data.expiresIn ?? 60) * 1000;

        // Update refresh token if provided in response
        if (data.refreshToken) {
          this.refreshToken = data.refreshToken;
        }

        return this.token!;
      } catch (error: any) {
        // If refresh fails, clear the refresh token and fall back to login
        console.warn(
          "Token refresh failed, falling back to login:",
          error.message
        );
        this.refreshToken = null;
      }
    }

    // Fall back to login if no refresh token or refresh failed
    try {
      const response = await this.rateLimitedRequest(() =>
        this.axiosInstance.post("/auth/login", {
          username: this.username,
          password: this.password,
        })
      );

      const data = (response as any).data as LoginResponse;
      this.token = data.token;
      this.tokenExpiresAt = Date.now() + (data.expiresIn ?? 60) * 1000;

      // Store refresh token if provided
      if (data.refreshToken) {
        this.refreshToken = data.refreshToken;
      }

      return this.token!;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `Auth failed with status ${error.response.status}: ${error.message}`
        );
      }
      throw new Error(`Auth failed: ${error.message || error}`);
    }
  }

  async fetchCountryPage(
    country: SupportedCountry,
    page: number,
    limit = 50
  ): Promise<PollutionResponse> {
    // Check Redis cache first
    const cached = await cacheService.getPollutionPage(country, page, limit);
    if (cached) {
      console.log(`Redis cache hit for ${country}:${page}:${limit}`);
      return cached;
    }

    const token = await this.ensureToken();

    const response = await this.rateLimitedRequest(async () => {
      try {
        const response = await this.axiosInstance.get("/pollution", {
          params: {
            country,
            page: String(page),
            limit: String(Math.min(Math.max(limit, 1), 50)),
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        return response.data as PollutionResponse;
      } catch (error: any) {
        if (error.response) {
          throw new Error(
            `Pollution fetch failed: ${error.response.status} - ${error.message}`
          );
        }
        throw new Error(`Pollution fetch failed: ${error.message || error}`);
      }
    });

    // Cache in Redis
    await cacheService.setPollutionPage(country, page, limit, response);
    return response;
  }

  // Original method - fetches ALL data (keep for backward compatibility)
  async fetchAllCountry(
    country: "PL" | "DE" | "ES" | "FR"
  ): Promise<PollutionItem[]> {
    const first = await this.fetchCountryPage(country, 1, 50);
    let items = first.results;
    for (let p = 2; p <= (first.meta?.totalPages ?? 1); p++) {
      const page = await this.fetchCountryPage(country, p, 50);
      items = items.concat(page.results);
    }
    return items;
  }

  // New optimized method - fetches incrementally until we have enough valid entries
  async fetchCountryLimited(
    country: "PL" | "DE" | "ES" | "FR",
    targetValidEntries: number,
    validator?: (item: PollutionItem) => boolean,
    pageSize?: number
  ): Promise<{
    items: PollutionItem[];
    totalFetched: number;
    pagesChecked: number;
  }> {
    const items: PollutionItem[] = [];
    let page = 1;
    let totalFetched = 0;
    let totalPages: number | null = null;

    const normalizedPageSize = Math.min(
      Math.max(pageSize ?? targetValidEntries, 1),
      50
    );

    while (true) {
      const needed = Math.max(targetValidEntries - items.length, 0);
      if (needed === 0) {
        return { items, totalFetched, pagesChecked: page - 1 };
      }

      // Use requested page size for first page, then only fetch what's needed (up to 50)
      const limitForThisPage =
        page === 1 ? normalizedPageSize : Math.min(needed, 50);
      const response = await this.fetchCountryPage(
        country,
        page,
        limitForThisPage
      );
      totalFetched += response.results.length;
      totalPages = totalPages ?? response.meta?.totalPages ?? 1;

      for (const item of response.results) {
        if (!validator || validator(item)) {
          items.push(item);
          if (items.length >= targetValidEntries) {
            return { items, totalFetched, pagesChecked: page };
          }
        }
      }

      if (page >= totalPages) {
        break;
      }
      page++;
    }

    return { items, totalFetched, pagesChecked: page };
  }
}
