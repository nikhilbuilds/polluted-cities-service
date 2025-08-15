import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import { env } from "../config/env";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  let error: AppError;

  if (err instanceof AppError) {
    error = err;
  } else if (err instanceof Error) {
    error = new AppError(err.message, 500, false);
  } else {
    error = new AppError("Internal Server Error", 500, false);
  }

  const payload: Record<string, unknown> = { message: error.message };
  if (env.nodeEnv !== "production" && (error as any).stack) {
    payload.stack = (error as any).stack;
  }

  res.status(error.statusCode || 500).json(payload);
}
