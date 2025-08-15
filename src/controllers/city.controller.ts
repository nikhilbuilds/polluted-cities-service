import { Request, Response, NextFunction } from "express";
import { CityService } from "../services/city.service";
import {
  SUPPORTED_COUNTRIES,
  SupportedCountry,
  API_LIMITS,
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

      const data = await this.service.getMostPollutedByCountry(
        country as SupportedCountry,
        isNaN(limit) ? API_LIMITS.DEFAULT_CITY_LIMIT : limit
      );

      res.json({ country, limit: data.length, results: data });
    } catch (err) {
      console.error(err);
      next(err);
    }
  };
}
