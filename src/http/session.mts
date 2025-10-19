/**
 * Session management for MCP HTTP transport
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SimpleEventStore } from "../mcp/event-store.mjs";
import { SESSION_TIMEOUT } from "./config.mjs";

export interface TransportEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  created: number;
}

export class SessionManager {
  private transports = new Map<string, TransportEntry>();

  get(sessionId: string): TransportEntry | undefined {
    return this.transports.get(sessionId);
  }

  set(sessionId: string, entry: TransportEntry): void {
    this.transports.set(sessionId, entry);
  }

  delete(sessionId: string): void {
    this.transports.delete(sessionId);
  }

  get size(): number {
    return this.transports.size;
  }

  /**
   * Clean up expired sessions to prevent memory leaks
   */
  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [sessionId, entry] of this.transports.entries()) {
      if (now - entry.created > SESSION_TIMEOUT) {
        console.log(`Cleaning up expired session: ${sessionId}`);

        // Clean up event store
        const eventStore = (entry.transport as any)._eventStore as SimpleEventStore | undefined;
        if (eventStore?.deleteSession) {
          await eventStore.deleteSession(sessionId);
        }

        entry.transport.close();
        this.transports.delete(sessionId);
      }
    }
  }

  /**
   * Close all sessions gracefully
   */
  async closeAll(): Promise<void> {
    const closePromises = [];
    for (const [sessionId, entry] of this.transports.entries()) {
      console.log(`Closing session: ${sessionId}`);

      const eventStore = (entry.transport as any)._eventStore as SimpleEventStore | undefined;
      if (eventStore?.deleteSession) {
        closePromises.push(eventStore.deleteSession(sessionId));
      }

      entry.transport.close();
    }

    await Promise.race([
      Promise.all(closePromises),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);

    this.transports.clear();
  }

  entries(): IterableIterator<[string, TransportEntry]> {
    return this.transports.entries();
  }
}
