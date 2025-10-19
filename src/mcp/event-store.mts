/**
 * In-memory event store for MCP session resumability
 *
 * This implementation includes memory leak protection by limiting
 * the number of events stored per session.
 */

import type { EventStore, EventId, StreamId } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const MAX_EVENTS_PER_SESSION = 1000;

export class SimpleEventStore implements EventStore {
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
    const sessionEvents = this.events.get(streamId)!;

    sessionEvents.push({ eventId, message });

    // Trim old events to prevent memory leak
    if (sessionEvents.length > MAX_EVENTS_PER_SESSION) {
      sessionEvents.splice(0, sessionEvents.length - MAX_EVENTS_PER_SESSION);
    }

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
