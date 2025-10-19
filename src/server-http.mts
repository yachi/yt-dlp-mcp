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
 *   YTDLP_STATELESS - Enable stateless mode (default: false)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { EventStore, EventId, StreamId } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  isInitializeRequest
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest, JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { randomUUID, timingSafeEqual } from "crypto";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "./config.js";
import { _spawnPromise, safeCleanup } from "./modules/utils.js";
import { downloadVideo } from "./modules/video.js";
import { downloadAudio } from "./modules/audio.js";
import { listSubtitles, downloadSubtitles, downloadTranscript } from "./modules/subtitle.js";
import { searchVideos } from "./modules/search.js";
import { getVideoMetadata, getVideoMetadataSummary } from "./modules/metadata.js";

const VERSION = '0.7.0';

// Server configuration with validation
const PORT = Math.max(1, Math.min(65535, parseInt(process.env.YTDLP_HTTP_PORT || '3000', 10)));
const HOST = process.env.YTDLP_HTTP_HOST || '0.0.0.0';
const API_KEY = process.env.YTDLP_API_KEY;
const CORS_ORIGIN = process.env.YTDLP_CORS_ORIGIN || '*';
const RATE_LIMIT = Math.max(1, parseInt(process.env.YTDLP_RATE_LIMIT || '60', 10));
const SESSION_TIMEOUT = Math.max(60000, parseInt(process.env.YTDLP_SESSION_TIMEOUT || '3600000', 10));
const STATELESS = process.env.YTDLP_STATELESS === 'true';

// Type for transport management
interface TransportEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  created: number;
  requestCount: number;
  lastRequest: number;
}

// Session storage
const transports = new Map<string, TransportEntry>();

/**
 * Simple in-memory event store for session resumability
 */
class SimpleEventStore implements EventStore {
  private events = new Map<StreamId, Array<{ eventId: EventId; message: JSONRPCMessage }>>();

  /**
   * Generates a unique event ID that includes the stream ID for efficient lookup
   */
  private generateEventId(streamId: StreamId): EventId {
    return `${streamId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Extracts stream ID from an event ID
   */
  private getStreamIdFromEventId(eventId: EventId): StreamId {
    const parts = eventId.split('_');
    return parts.length > 0 ? parts[0] : '';
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    if (!this.events.has(streamId)) {
      this.events.set(streamId, []);
    }
    const eventId = this.generateEventId(streamId);
    this.events.get(streamId)!.push({ eventId, message });
    return eventId;
  }

  async deleteSession(streamId: StreamId): Promise<void> {
    this.events.delete(streamId);
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    if (!lastEventId) {
      return '';
    }

    // Extract stream ID from event ID for efficient lookup
    const streamId = this.getStreamIdFromEventId(lastEventId);
    if (!streamId || !this.events.has(streamId)) {
      return '';
    }

    const streamEvents = this.events.get(streamId)!;
    const index = streamEvents.findIndex(e => e.eventId === lastEventId);

    if (index >= 0) {
      // Replay all events after the given event ID
      const eventsToReplay = streamEvents.slice(index + 1);
      for (const { eventId, message } of eventsToReplay) {
        await send(eventId, message);
      }
    }

    return streamId;
  }
}

/**
 * Simple rate limiting per session
 */
function checkRateLimit(sessionId: string): boolean {
  const entry = transports.get(sessionId);
  if (!entry) return true;

  const now = Date.now();
  const timeSinceLastRequest = now - entry.lastRequest;

  // Reset counter if more than 1 minute has passed
  if (timeSinceLastRequest > 60000) {
    entry.requestCount = 1;
    entry.lastRequest = now;
    return true;
  }

  if (entry.requestCount >= RATE_LIMIT) {
    return false;
  }

  entry.requestCount++;
  entry.lastRequest = now;
  return true;
}

/**
 * Cleanup expired sessions
 */
async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  for (const [sessionId, entry] of transports.entries()) {
    if (now - entry.created > SESSION_TIMEOUT) {
      console.log(`Cleaning up expired session: ${sessionId}`);

      // Clean up event store to prevent memory leak
      const eventStore = (entry.transport as any)._eventStore as SimpleEventStore | undefined;
      if (eventStore?.deleteSession) {
        await eventStore.deleteSession(sessionId);
      }

      entry.transport.close();
      transports.delete(sessionId);
    }
  }
}

/**
 * Validate API key if configured (uses constant-time comparison to prevent timing attacks)
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

// Zod Schemas for Input Validation
const SearchVideosSchema = z.object({
  query: z.string().min(1).max(200),
  maxResults: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
  response_format: z.enum(["json", "markdown"]).default("markdown"),
}).strict();

const ListSubtitleLanguagesSchema = z.object({
  url: z.string().url(),
}).strict();

const DownloadVideoSubtitlesSchema = z.object({
  url: z.string().url(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/).optional(),
}).strict();

const DownloadVideoSchema = z.object({
  url: z.string().url(),
  resolution: z.enum(["480p", "720p", "1080p", "best"]).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/).optional(),
}).strict();

const DownloadAudioSchema = z.object({
  url: z.string().url(),
}).strict();

const DownloadTranscriptSchema = z.object({
  url: z.string().url(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/).optional(),
}).strict();

const GetVideoMetadataSchema = z.object({
  url: z.string().url(),
  fields: z.array(z.string()).optional(),
}).strict();

const GetVideoMetadataSummarySchema = z.object({
  url: z.string().url(),
}).strict();

/**
 * Validate system configuration
 */
async function validateConfig(): Promise<void> {
  if (!fs.existsSync(CONFIG.file.downloadsDir)) {
    throw new Error(`Downloads directory does not exist: ${CONFIG.file.downloadsDir}`);
  }

  try {
    const testFile = path.join(CONFIG.file.downloadsDir, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
  } catch (error) {
    throw new Error(`No write permission in downloads directory: ${CONFIG.file.downloadsDir}`);
  }

  try {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), CONFIG.file.tempDirPrefix));
    await safeCleanup(testDir);
  } catch (error) {
    throw new Error(`Cannot create temporary directory in: ${os.tmpdir()}`);
  }
}

/**
 * Check required external dependencies
 */
async function checkDependencies(): Promise<void> {
  for (const tool of CONFIG.tools.required) {
    try {
      await _spawnPromise(tool, ["--version"]);
    } catch (error) {
      throw new Error(`Required tool '${tool}' is not installed or not accessible`);
    }
  }
}

/**
 * Initialize server
 */
async function initialize(): Promise<void> {
  try {
    await validateConfig();
    await checkDependencies();
    console.log('✓ Configuration validated');
    console.log('✓ Dependencies checked');
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  }
}

/**
 * Create MCP Server instance with tool handlers
 */
function createMcpServer(): Server {
  const server = new Server(
    {
      name: "yt-dlp-mcp-http",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {}
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "ytdlp_search_videos",
          description: "Search for videos on YouTube with pagination support",
          inputSchema: SearchVideosSchema,
        },
        {
          name: "ytdlp_list_subtitle_languages",
          description: "List all available subtitle languages for a video",
          inputSchema: ListSubtitleLanguagesSchema,
        },
        {
          name: "ytdlp_download_video_subtitles",
          description: "Download video subtitles in VTT format",
          inputSchema: DownloadVideoSubtitlesSchema,
        },
        {
          name: "ytdlp_download_video",
          description: "Download video file to Downloads folder",
          inputSchema: DownloadVideoSchema,
        },
        {
          name: "ytdlp_download_audio",
          description: "Extract and download audio from video",
          inputSchema: DownloadAudioSchema,
        },
        {
          name: "ytdlp_download_transcript",
          description: "Generate clean plain text transcript",
          inputSchema: DownloadTranscriptSchema,
        },
        {
          name: "ytdlp_get_video_metadata",
          description: "Extract comprehensive video metadata in JSON format",
          inputSchema: GetVideoMetadataSchema,
        },
        {
          name: "ytdlp_get_video_metadata_summary",
          description: "Get human-readable summary of key video information",
          inputSchema: GetVideoMetadataSummarySchema,
        },
      ],
    };
  });

  async function handleToolExecution<T>(
    action: () => Promise<T>,
    errorPrefix: string
  ): Promise<{
    content: Array<{ type: "text", text: string }>,
    isError?: boolean
  }> {
    try {
      const result = await action();
      return {
        content: [{ type: "text", text: String(result) }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `${errorPrefix}: ${errorMessage}` }],
        isError: true
      };
    }
  }

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const toolName = request.params.name;
      const args = request.params.arguments as {
        url: string;
        language?: string;
        resolution?: string;
        startTime?: string;
        endTime?: string;
        query?: string;
        maxResults?: number;
        fields?: string[];
      };

      try {
        if (toolName === "ytdlp_search_videos") {
          const validated = SearchVideosSchema.parse(args);
          return handleToolExecution(
            () => searchVideos(validated.query, validated.maxResults, validated.offset, validated.response_format, CONFIG),
            "Error searching videos"
          );
        } else if (toolName === "ytdlp_list_subtitle_languages") {
          const validated = ListSubtitleLanguagesSchema.parse(args);
          return handleToolExecution(
            () => listSubtitles(validated.url),
            "Error listing subtitle languages"
          );
        } else if (toolName === "ytdlp_download_video_subtitles") {
          const validated = DownloadVideoSubtitlesSchema.parse(args);
          return handleToolExecution(
            () => downloadSubtitles(validated.url, validated.language || CONFIG.download.defaultSubtitleLanguage, CONFIG),
            "Error downloading subtitles"
          );
        } else if (toolName === "ytdlp_download_video") {
          const validated = DownloadVideoSchema.parse(args);
          return handleToolExecution(
            () => downloadVideo(
              validated.url,
              CONFIG,
              validated.resolution as "480p" | "720p" | "1080p" | "best",
              validated.startTime,
              validated.endTime
            ),
            "Error downloading video"
          );
        } else if (toolName === "ytdlp_download_audio") {
          const validated = DownloadAudioSchema.parse(args);
          return handleToolExecution(
            () => downloadAudio(validated.url, CONFIG),
            "Error downloading audio"
          );
        } else if (toolName === "ytdlp_download_transcript") {
          const validated = DownloadTranscriptSchema.parse(args);
          return handleToolExecution(
            () => downloadTranscript(validated.url, validated.language || CONFIG.download.defaultSubtitleLanguage, CONFIG),
            "Error downloading transcript"
          );
        } else if (toolName === "ytdlp_get_video_metadata") {
          const validated = GetVideoMetadataSchema.parse(args);
          return handleToolExecution(
            () => getVideoMetadata(validated.url, validated.fields, CONFIG),
            "Error extracting video metadata"
          );
        } else if (toolName === "ytdlp_get_video_metadata_summary") {
          const validated = GetVideoMetadataSummarySchema.parse(args);
          return handleToolExecution(
            () => getVideoMetadataSummary(validated.url, CONFIG),
            "Error generating video metadata summary"
          );
        } else {
          return {
            content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
            isError: true
          };
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorMessages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
          return {
            content: [{ type: "text", text: `Invalid input: ${errorMessages}` }],
            isError: true
          };
        }
        throw error;
      }
    }
  );

  return server;
}

/**
 * Start HTTP server with Streamable HTTP transport
 */
async function startServer() {
  await initialize();

  const app = express();

  // Configure body parser with explicit size limit
  app.use(express.json({ limit: '4mb' }));

  // Configure CORS
  app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }));

  // API key middleware
  app.use((req: Request, res: Response, next) => {
    if (req.path === '/health') {
      return next();
    }

    if (!validateApiKey(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  // Health check endpoint with yt-dlp availability check
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      // Check if yt-dlp is available
      await _spawnPromise('yt-dlp', ['--version']);
      res.json({
        status: 'ok',
        version: VERSION,
        sessions: transports.size,
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        reason: 'yt-dlp not available',
        sessions: transports.size,
      });
    }
  });

  // MCP POST endpoint - Handle JSON-RPC messages
  app.post('/mcp', async (req: Request, res: Response) => {
    const requestId = req?.body?.id;

    try {
      // Extract session ID from header (MCP spec compliant)
      const sessionId = Array.isArray(req.headers['mcp-session-id'])
        ? req.headers['mcp-session-id'][0]
        : req.headers['mcp-session-id'];

      let entry = sessionId ? transports.get(sessionId) : undefined;

      // Handle stateless mode
      if (STATELESS) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // undefined = stateless
          enableJsonResponse: true,
        });

        const server = createMcpServer();
        await server.connect(transport);

        try {
          await transport.handleRequest(req as any, res as any, req.body);
        } catch (transportError) {
          console.error('Transport error:', transportError);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: ErrorCode.InternalError,
                message: 'Transport error',
                data: transportError instanceof Error ? transportError.message : String(transportError)
              },
              id: requestId
            });
          }
        }
        return;
      }

      // Stateful mode - check for existing session or create new one
      if (entry) {
        // Check rate limit for existing session
        if (!checkRateLimit(sessionId!)) {
          res.status(429).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Rate limit exceeded' },
            id: requestId
          });
          return;
        }

        // Reuse existing transport
        try {
          await entry.transport.handleRequest(req as any, res as any, req.body);
        } catch (transportError) {
          console.error('Transport error:', transportError);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: ErrorCode.InternalError,
                message: 'Transport error',
                data: transportError instanceof Error ? transportError.message : String(transportError)
              },
              id: requestId
            });
          }
        }
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request - create new session
        const eventStore = new SimpleEventStore();
        let transport: StreamableHTTPServerTransport;

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: false,
          eventStore,
          onsessioninitialized: (newSessionId: string) => {
            // Store session in callback to avoid race conditions
            console.log(`Session initialized: ${newSessionId}`);
            transports.set(newSessionId, {
              transport,
              server,
              created: Date.now(),
              requestCount: 1,
              lastRequest: Date.now(),
            });
          }
        });

        const server = createMcpServer();
        await server.connect(transport);

        try {
          await transport.handleRequest(req as any, res as any, req.body);
        } catch (transportError) {
          console.error('Transport error:', transportError);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: ErrorCode.InternalError,
                message: 'Transport error',
                data: transportError instanceof Error ? transportError.message : String(transportError)
              },
              id: requestId
            });
          }
        }
      } else {
        // Invalid request - no session ID or not initialization request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InvalidRequest,
            message: 'Bad Request: No valid session ID provided',
          },
          id: requestId
        });
      }
    } catch (error) {
      console.error('Error handling POST request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InternalError,
            message: 'Internal error',
            data: error instanceof Error ? error.message : String(error)
          },
          id: requestId
        });
      }
    }
  });

  // MCP GET endpoint - Handle SSE streams for resumability
  app.get('/mcp', async (req: Request, res: Response) => {
    const requestId = req?.body?.id;

    try {
      const sessionId = Array.isArray(req.headers['mcp-session-id'])
        ? req.headers['mcp-session-id'][0]
        : req.headers['mcp-session-id'];

      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InvalidRequest,
            message: 'Bad Request: No valid session ID provided',
          },
          id: requestId
        });
        return;
      }

      // Check for Last-Event-ID header for resumability
      const lastEventId = req.headers['last-event-id'] as string | undefined;
      if (lastEventId) {
        console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
      } else {
        console.log(`Establishing new SSE stream for session ${sessionId}`);
      }

      const entry = transports.get(sessionId)!;

      try {
        await entry.transport.handleRequest(req as any, res as any, req.body);
      } catch (transportError) {
        console.error('Transport error:', transportError);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: ErrorCode.InternalError,
              message: 'Transport error',
              data: transportError instanceof Error ? transportError.message : String(transportError)
            },
            id: requestId
          });
        }
      }
    } catch (error) {
      console.error('Error handling GET request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InternalError,
            message: 'Internal error',
            data: error instanceof Error ? error.message : String(error)
          },
          id: requestId
        });
      }
    }
  });

  // MCP DELETE endpoint - Handle session termination
  app.delete('/mcp', async (req: Request, res: Response) => {
    const requestId = req?.body?.id;

    try {
      const sessionId = Array.isArray(req.headers['mcp-session-id'])
        ? req.headers['mcp-session-id'][0]
        : req.headers['mcp-session-id'];

      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InvalidRequest,
            message: 'Bad Request: No valid session ID provided',
          },
          id: requestId
        });
        return;
      }

      console.log(`Received session termination request for session ${sessionId}`);

      const entry = transports.get(sessionId)!;

      // Clean up event store
      const eventStore = (entry.transport as any)._eventStore as SimpleEventStore | undefined;
      if (eventStore?.deleteSession) {
        await eventStore.deleteSession(sessionId);
      }

      try {
        await entry.transport.handleRequest(req as any, res as any, req.body);
      } catch (transportError) {
        console.error('Transport error:', transportError);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: ErrorCode.InternalError,
              message: 'Error handling session termination',
              data: transportError instanceof Error ? transportError.message : String(transportError)
            },
            id: requestId
          });
        }
      }

      // Remove from transports map
      transports.delete(sessionId);
    } catch (error) {
      console.error('Error handling DELETE request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InternalError,
            message: 'Error handling session termination',
            data: error instanceof Error ? error.message : String(error)
          },
          id: requestId
        });
      }
    }
  });

  // Start listening
  const httpServer = app.listen(PORT, HOST, () => {
    // Configure timeouts for long-running downloads
    httpServer.timeout = 10 * 60 * 1000; // 10 minutes
    httpServer.keepAliveTimeout = 65000; // Slightly longer than default
    httpServer.headersTimeout = 66000; // Slightly longer than keepAliveTimeout

    // Start cleanup interval after server is ready
    setInterval(() => {
      cleanupExpiredSessions().catch(err =>
        console.error('Error during session cleanup:', err)
      );
    }, 5 * 60 * 1000);

    console.log(`
╔════════════════════════════════════════════════╗
║  🎬 yt-dlp-mcp HTTP Server                    ║
╟────────────────────────────────────────────────╢
║  Version:   ${VERSION.padEnd(34)} ║
║  Protocol:  Streamable HTTP (MCP Spec)${' '.repeat(7)}║
║  Mode:      ${STATELESS ? 'Stateless' : 'Stateful (Session-based)'}${' '.repeat(STATELESS ? 16 : 3)}║
║  Endpoint:  http://${HOST}:${PORT}/mcp${' '.repeat(Math.max(0, 17 - HOST.length - PORT.toString().length))}║
║  Health:    http://${HOST}:${PORT}/health${' '.repeat(Math.max(0, 13 - HOST.length - PORT.toString().length))}║
╟────────────────────────────────────────────────╢
║  Security:                                     ║
║    • API Key:       ${API_KEY ? '✓ Enabled' : '✗ Disabled'}${' '.repeat(API_KEY ? 18 : 19)}║
║    • CORS:          ${CORS_ORIGIN.padEnd(25)} ║
${STATELESS ? '' : `║    • Rate Limit:    ${RATE_LIMIT}/min per session${' '.repeat(Math.max(0, 11 - RATE_LIMIT.toString().length))}║
║    • Session Timeout: ${(SESSION_TIMEOUT / 60000).toFixed(0)} minutes${' '.repeat(Math.max(0, 18 - (SESSION_TIMEOUT / 60000).toFixed(0).length))}║
`}╚════════════════════════════════════════════════╝
    `);

    if (!API_KEY) {
      console.warn('⚠️  Warning: No API key configured. Set YTDLP_API_KEY for production use.');
    }
  });

  // Graceful shutdown with timeout
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');

    // Close all transports with cleanup
    const closePromises = [];
    for (const [sessionId, entry] of transports.entries()) {
      console.log(`Closing session: ${sessionId}`);

      const eventStore = (entry.transport as any)._eventStore as SimpleEventStore | undefined;
      if (eventStore?.deleteSession) {
        closePromises.push(eventStore.deleteSession(sessionId));
      }

      entry.transport.close();
    }

    // Wait for cleanup to complete (with timeout)
    await Promise.race([
      Promise.all(closePromises),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);

    transports.clear();

    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds if server doesn't close
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  });
}

startServer().catch(console.error);
