import { Request, Response, NextFunction } from "express";

/**
 * API Key middleware for public landing page endpoints.
 * The landing page must send: x-api-key: <LANDING_PAGE_API_KEY>
 * This ensures random users cannot hit the onboarding endpoint directly.
 */
export const validateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.LANDING_PAGE_API_KEY;

  if (!expectedKey) {
    console.error("[ApiKeyAuth] LANDING_PAGE_API_KEY is not set in .env");
    return res.status(500).json({ message: "Server misconfiguration." });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      message: "Unauthorized. Invalid or missing API key.",
    });
  }

  next();
};
