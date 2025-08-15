import { Request, Response, NextFunction } from "express";
import { CityService } from "../services/city.service";
import {
  SUPPORTED_COUNTRIES,
  SupportedCountry,
  API_LIMITS,
  COUNTRY_LABELS,
} from "../utils/constants";

export class CityController {
  constructor(private readonly service: CityService) {}

  getCities = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const country = String(req.query.country || "").toUpperCase();

      if (!SUPPORTED_COUNTRIES.includes(country as SupportedCountry)) {
        return res.status(400).json({
          error: `Invalid or missing country. Use one of: ${SUPPORTED_COUNTRIES.join(
            ", "
          )}`,
        });
      }

      const limit = req.query.limit
        ? Number(req.query.limit)
        : API_LIMITS.DEFAULT_CITY_LIMIT;
      const page = req.query.page ? Number(req.query.page) : 1;

      // Validate page and limit
      if (page < 1) {
        return res.status(400).json({ error: "Page must be 1 or greater" });
      }

      const result = await this.service.getMostPollutedByCountry(
        country as SupportedCountry,
        isNaN(limit) ? API_LIMITS.DEFAULT_CITY_LIMIT : limit,
        isNaN(page) ? 1 : page
      );

      res.json({
        page,
        limit: result.cities.length,
        hasMore: result.hasMore,
        cities: result.cities.map((city) => ({
          name: city.city,
          country: COUNTRY_LABELS[country as SupportedCountry],
          pollution: city.pollution,
          description: city.description,
        })),
      });
    } catch (err) {
      console.error(err);
      next(err);
    }
  };
}
