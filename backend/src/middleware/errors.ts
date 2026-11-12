import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class HttpProblem extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Ugyldige data",
      details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof HttpProblem) {
    return res.status(err.status).json({ error: err.message });
  }
  if ((err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "Ugyldig JSON" });
  }
  logger.error({ err: (err as Error).message, stack: (err as Error).stack, path: req.path }, "Uventet feil");
  res.status(500).json({ error: "Noe gikk galt på serveren" });
};
