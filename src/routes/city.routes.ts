import { Router } from "express";
import { PolluApiClient } from "../external/polluApi.client";
import { WikipediaClient } from "../external/wikipedia.client";
import { CityService } from "../services/city.service";
import { CityController } from "../controllers/city.controller";

const polluClient = new PolluApiClient();
const wikiClient = new WikipediaClient();
const cityService = new CityService(polluClient, wikiClient);
const cityController = new CityController(cityService);

export const cityRouter = Router();

cityRouter.get("/", cityController.getCities);
