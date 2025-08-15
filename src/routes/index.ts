import { Router } from "express";
import { cityRouter } from "./city.routes";

export const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true }));
router.use("/cities", cityRouter);
