/**
 * HTTP route handlers for MCP server
 */

import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { SessionManager } from "./session.mjs";
import { SimpleEventStore } from "../mcp/event-store.mjs";
import { createMcpServer } from "../mcp/server.mjs";
import { handleTransportError, sendInvalidRequestError, sendInternalError } from "./errors.mjs";
import { _spawnPromise } from "../modules/utils.js";
import { VERSION } from "./config.mjs";

/**
 * Health check endpoint
 */
export async function handleHealthCheck(_req: Request, res: Response, sessionManager?: SessionManager): Promise<void> {
  try {
    // Check if yt-dlp is available
    await _spawnPromise('yt-dlp', ['--version']);
    res.json({
      status: 'ok',
      version: VERSION,
      sessions: sessionManager?.size ?? 0,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      reason: 'yt-dlp not available',
    });
  }
}

/**
 * Handle MCP POST requests (JSON-RPC messages)
 */
export async function handleMcpPost(
  req: Request,
  res: Response,
  sessionManager: SessionManager
): Promise<void> {
  const requestId = req?.body?.id;

  try {
    const sessionId = Array.isArray(req.headers['mcp-session-id'])
      ? req.headers['mcp-session-id'][0]
      : req.headers['mcp-session-id'];

    let entry = sessionId ? sessionManager.get(sessionId) : undefined;

    if (entry) {
      // Update activity timestamp
      sessionManager.touch(sessionId!);

      // Reuse existing transport
      try {
        await entry.transport.handleRequest(req, res, req.body);
      } catch (transportError) {
        handleTransportError(transportError, requestId, res);
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
          console.log(`Session initialized: ${newSessionId}`);
          const now = Date.now();
          sessionManager.set(newSessionId, {
            transport,
            server,
            eventStore,
            created: now,
            lastActivity: now,
          });
        }
      });

      const server = createMcpServer();
      await server.connect(transport);

      try {
        await transport.handleRequest(req, res, req.body);
      } catch (transportError) {
        handleTransportError(transportError, requestId, res);
      }
    } else {
      sendInvalidRequestError(res, requestId, 'Bad Request: No valid session ID provided');
    }
  } catch (error) {
    sendInternalError(res, requestId, error);
  }
}

/**
 * Handle MCP GET requests (SSE streams for resumability)
 */
export async function handleMcpGet(
  req: Request,
  res: Response,
  sessionManager: SessionManager
): Promise<void> {
  const requestId = req?.body?.id;

  try {
    const sessionId = Array.isArray(req.headers['mcp-session-id'])
      ? req.headers['mcp-session-id'][0]
      : req.headers['mcp-session-id'];

    if (!sessionId || !sessionManager.get(sessionId)) {
      sendInvalidRequestError(res, requestId, 'Bad Request: No valid session ID provided');
      return;
    }

    // Update activity timestamp
    sessionManager.touch(sessionId);

    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) {
      console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
    } else {
      console.log(`Establishing new SSE stream for session ${sessionId}`);
    }

    const entry = sessionManager.get(sessionId)!;

    try {
      await entry.transport.handleRequest(req, res, req.body);
    } catch (transportError) {
      handleTransportError(transportError, requestId, res);
    }
  } catch (error) {
    sendInternalError(res, requestId, error);
  }
}

/**
 * Handle MCP DELETE requests (session termination)
 */
export async function handleMcpDelete(
  req: Request,
  res: Response,
  sessionManager: SessionManager
): Promise<void> {
  const requestId = req?.body?.id;

  try {
    const sessionId = Array.isArray(req.headers['mcp-session-id'])
      ? req.headers['mcp-session-id'][0]
      : req.headers['mcp-session-id'];

    if (!sessionId || !sessionManager.get(sessionId)) {
      sendInvalidRequestError(res, requestId, 'Bad Request: No valid session ID provided');
      return;
    }

    console.log(`Received session termination request for session ${sessionId}`);

    const entry = sessionManager.get(sessionId)!;

    // Clean up event store
    await entry.eventStore.deleteSession(sessionId);

    try {
      await entry.transport.handleRequest(req, res, req.body);
    } catch (transportError) {
      handleTransportError(transportError, requestId, res);
    }

    // Remove from session manager
    sessionManager.delete(sessionId);
  } catch (error) {
    sendInternalError(res, requestId, error);
  }
}
