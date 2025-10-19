/**
 * Tests for HTTP routes
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';

// Mock dependencies
jest.mock('../../modules/utils.js', () => ({
  _spawnPromise: jest.fn<() => Promise<string>>().mockResolvedValue('yt-dlp 2024.1.1'),
}));

describe('HTTP Routes', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn() as any;
    statusMock = jest.fn().mockReturnValue({ json: jsonMock }) as any;

    mockRequest = {
      headers: {},
      body: {},
      path: '/test',
    } as Partial<Request>;

    mockResponse = {
      json: jsonMock,
      status: statusMock,
    } as Partial<Response>;
  });

  describe('Health Check', () => {
    it('should return ok status when yt-dlp is available', async () => {
      const { handleHealthCheck } = await import('../../http/routes.mjs');

      await handleHealthCheck(
        mockRequest as Request,
        mockResponse as Response,
        undefined
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          version: expect.any(String),
          sessions: 0,
        })
      );
    });

    it('should return session count when sessionManager is provided', async () => {
      const { handleHealthCheck } = await import('../../http/routes.mjs');
      const { SessionManager } = await import('../../http/session.mjs');

      const sessionManager = new SessionManager();

      await handleHealthCheck(
        mockRequest as Request,
        mockResponse as Response,
        sessionManager
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          sessions: 0,
        })
      );
    });
  });

  describe('API Key Middleware', () => {
    it('should allow requests to /health without API key', () => {
      const { apiKeyMiddleware } = require('../../http/middleware.mts');
      const nextMock = jest.fn();

      const healthRequest = {
        ...mockRequest,
        path: '/health',
      } as Request;

      apiKeyMiddleware(
        healthRequest,
        mockResponse as Response,
        nextMock
      );

      expect(nextMock).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should allow requests when no API key is configured', () => {
      // Save original env
      const originalApiKey = process.env.YTDLP_API_KEY;
      delete process.env.YTDLP_API_KEY;

      const { apiKeyMiddleware } = require('../../http/middleware.mts');
      const nextMock = jest.fn();

      const mcpRequest = {
        ...mockRequest,
        path: '/mcp',
      } as Request;

      apiKeyMiddleware(
        mcpRequest,
        mockResponse as Response,
        nextMock
      );

      expect(nextMock).toHaveBeenCalled();

      // Restore env
      if (originalApiKey) {
        process.env.YTDLP_API_KEY = originalApiKey;
      }
    });
  });

  describe('Session Manager', () => {
    it('should create and manage sessions', async () => {
      const { SessionManager } = await import('../../http/session.mjs');
      const sessionManager = new SessionManager();

      expect(sessionManager.size).toBe(0);
    });

    it('should touch session to update lastActivity', async () => {
      const { SessionManager } = await import('../../http/session.mjs');
      const sessionManager = new SessionManager();

      const mockEntry = {
        transport: {} as any,
        server: {} as any,
        eventStore: {} as any,
        created: Date.now(),
        lastActivity: Date.now() - 1000,
      };

      sessionManager.set('test-session', mockEntry);

      const beforeTouch = sessionManager.get('test-session')?.lastActivity;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      sessionManager.touch('test-session');

      const afterTouch = sessionManager.get('test-session')?.lastActivity;

      expect(afterTouch).toBeGreaterThan(beforeTouch!);
    });
  });
});
