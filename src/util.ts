import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Wraps an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Final JSON error middleware. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : "Server error.";
  // A Mongoose "before initial connection" error means the DB is unreachable.
  const dbDown = /initial connection|buffering timed out|ECONNREFUSED/i.test(message);
  console.error("Request error:", message);
  res
    .status(dbDown ? 503 : 500)
    .json({ error: dbDown ? "Service temporarily unavailable." : "Server error." });
}
