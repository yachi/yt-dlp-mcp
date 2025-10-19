/**
 * Express middleware for authentication and rate limiting
 */

import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "crypto";
import { API_KEY, RATE_LIMIT } from "./config.mjs";

/**
 * Validate API key using constant-time comparison to prevent timing attacks
 */
function validateApiKey(req: Request): boolean {
  if (!API_KEY) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, '');

  // Constant-time comparison to prevent timing attacks
  if (token.length !== API_KEY.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(token),
      Buffer.from(API_KEY)
    );
  } catch {
    return false;
  }
}

/**
 * API key authentication middleware
 */
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    return next();
  }

  if (!validateApiKey(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Rate limiting middleware using express-rate-limit
 */
export const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: RATE_LIMIT,
  keyGenerator: (req: Request) => {
    // Use session ID for per-session rate limiting
    const sessionId = Array.isArray(req.headers['mcp-session-id'])
      ? req.headers['mcp-session-id'][0]
      : req.headers['mcp-session-id'];
    return sessionId || req.ip || 'anonymous';
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Rate limit exceeded' },
    });
  },
});
