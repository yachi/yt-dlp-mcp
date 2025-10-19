/**
 * Error handling utilities for HTTP server
 */

import type { Response } from "express";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export function handleTransportError(error: unknown, requestId: unknown, res: Response): void {
  console.error('Transport error:', error);
  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: ErrorCode.InternalError,
        message: 'Transport error',
        data: error instanceof Error ? error.message : String(error)
      },
      id: requestId
    });
  }
}

export function sendInvalidRequestError(res: Response, requestId: unknown, message: string): void {
  res.status(400).json({
    jsonrpc: '2.0',
    error: {
      code: ErrorCode.InvalidRequest,
      message,
    },
    id: requestId
  });
}

export function sendInternalError(res: Response, requestId: unknown, error: unknown): void {
  console.error('Internal error:', error);
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
