#!/usr/bin/env node

/**
 * Remote MCP Server for yt-dlp-mcp using Streamable HTTP Transport
 *
 * This server exposes yt-dlp MCP tools over HTTP using the official
 * StreamableHTTPServerTransport from @modelcontextprotocol/sdk.
 *
 * Security Features:
 * - CORS configuration
 * - Rate limiting per session
 * - Request size limits (4MB via SDK)
 * - Content-type validation (via SDK)
 * - Optional API key authentication
 * - Session management with timeouts
 *
 * Usage:
 *   yt-dlp-mcp-http [--port 3000] [--host 0.0.0.0]
 *
 * Environment Variables:
 *   YTDLP_HTTP_PORT - Server port (default: 3000)
 *   YTDLP_HTTP_HOST - Server host (default: 0.0.0.0)
 *   YTDLP_API_KEY - Optional API key for authentication
 *   YTDLP_CORS_ORIGIN - CORS allowed origin (default: *)
 *   YTDLP_RATE_LIMIT - Max requests per minute per session (default: 60)
 *   YTDLP_SESSION_TIMEOUT - Session timeout in ms (default: 3600000 = 1 hour)
 */

import express from "express";
import cors from "cors";
import { PORT, HOST, API_KEY, CORS_ORIGIN, RATE_LIMIT, SESSION_TIMEOUT, TIMEOUTS, VERSION } from "./http/config.mjs";
import { apiKeyMiddleware, rateLimitMiddleware } from "./http/middleware.mjs";
import { handleHealthCheck, handleMcpPost, handleMcpGet, handleMcpDelete } from "./http/routes.mjs";
import { SessionManager } from "./http/session.mjs";
import { initialize } from "./http/validation.mjs";

/**
 * Start HTTP server
 */
async function startServer() {
  await initialize();

  const app = express();
  const sessionManager = new SessionManager();

  // Configure body parser with explicit size limit
  app.use(express.json({ limit: '4mb' }));

  // Configure CORS
  app.use(cors({
    origin: CORS_ORIGIN,
    credentials: CORS_ORIGIN !== '*', // credentials not allowed with wildcard origin
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }));

  // Apply API key authentication
  app.use(apiKeyMiddleware);

  // Apply rate limiting to MCP endpoints
  app.use('/mcp', rateLimitMiddleware);

  // Health check endpoint
  app.get('/health', (req, res) => handleHealthCheck(req, res, sessionManager));

  // MCP endpoints
  app.post('/mcp', (req, res) => handleMcpPost(req, res, sessionManager));
  app.get('/mcp', (req, res) => handleMcpGet(req, res, sessionManager));
  app.delete('/mcp', (req, res) => handleMcpDelete(req, res, sessionManager));

  // Start listening
  const httpServer = app.listen(PORT, HOST, () => {
    // Configure timeouts for long-running downloads
    httpServer.timeout = TIMEOUTS.HTTP_REQUEST;
    httpServer.keepAliveTimeout = TIMEOUTS.KEEP_ALIVE;
    httpServer.headersTimeout = TIMEOUTS.HEADERS;

    // Start cleanup interval
    setInterval(async () => {
      try {
        await sessionManager.cleanupExpired();
      } catch (err) {
        console.error('Error during session cleanup:', err);
      }
    }, TIMEOUTS.CLEANUP_INTERVAL);

    printStartupBanner();
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');

    await sessionManager.closeAll();

    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, TIMEOUTS.SHUTDOWN_FORCE);
  });
}

/**
 * Print startup banner
 */
function printStartupBanner() {
  console.log(`
╔════════════════════════════════════════════════╗
║  🎬 yt-dlp-mcp HTTP Server                    ║
╟────────────────────────────────────────────────╢
║  Version:   ${VERSION.padEnd(34)} ║
║  Protocol:  Streamable HTTP (MCP Spec)${' '.repeat(7)}║
║  Endpoint:  http://${HOST}:${PORT}/mcp${' '.repeat(Math.max(0, 17 - HOST.length - PORT.toString().length))}║
║  Health:    http://${HOST}:${PORT}/health${' '.repeat(Math.max(0, 13 - HOST.length - PORT.toString().length))}║
╟────────────────────────────────────────────────╢
║  Security:                                     ║
║    • API Key:       ${API_KEY ? '✓ Enabled' : '✗ Disabled'}${' '.repeat(API_KEY ? 18 : 19)}║
║    • CORS:          ${CORS_ORIGIN.padEnd(25)} ║
║    • Rate Limit:    ${RATE_LIMIT}/min per session${' '.repeat(Math.max(0, 11 - RATE_LIMIT.toString().length))}║
║    • Session Timeout: ${(SESSION_TIMEOUT / 60000).toFixed(0)} minutes${' '.repeat(Math.max(0, 18 - (SESSION_TIMEOUT / 60000).toFixed(0).length))}║
╚════════════════════════════════════════════════╝
  `);

  if (!API_KEY) {
    console.warn('⚠️  Warning: No API key configured. Set YTDLP_API_KEY for production use.');
  }
}

startServer().catch(console.error);
