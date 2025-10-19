/**
 * HTTP Server Configuration
 */

export const VERSION = '0.7.0';

// Server configuration with validation
export const PORT = Math.max(1, Math.min(65535, parseInt(process.env.YTDLP_HTTP_PORT || '3000', 10)));
export const HOST = process.env.YTDLP_HTTP_HOST || '0.0.0.0';
export const API_KEY = process.env.YTDLP_API_KEY;
export const CORS_ORIGIN = process.env.YTDLP_CORS_ORIGIN || '*';
export const RATE_LIMIT = Math.max(1, parseInt(process.env.YTDLP_RATE_LIMIT || '60', 10));
export const SESSION_TIMEOUT = Math.max(60000, parseInt(process.env.YTDLP_SESSION_TIMEOUT || '3600000', 10));

// Timeout constants
export const TIMEOUTS = {
  HTTP_REQUEST: 10 * 60 * 1000,    // 10 minutes
  CLEANUP_INTERVAL: 5 * 60 * 1000,  // 5 minutes
  SHUTDOWN_GRACE: 5000,             // 5 seconds
  SHUTDOWN_FORCE: 10000,            // 10 seconds
  KEEP_ALIVE: 65000,                // 65 seconds
  HEADERS: 66000,                   // 66 seconds
} as const;
