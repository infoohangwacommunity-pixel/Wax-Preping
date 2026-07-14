// The event bus is the nervous system of WaxPrep.
// Modules do NOT call each other directly.
// They fire events and trust the bus to deliver them.
// This starts simple (in-memory async), can become Redis Streams later
// without changing any module code.

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type { AnyEvent, EventType } from "../types/events";

type EventHandler<T extends AnyEvent = AnyEvent> = (event: T) => Promise<void>;

class EventBus {
  private emitter: EventEmitter;
  private eventLog: AnyEvent[] = [];

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  async publish(event: Omit<AnyEvent, "id"> & { id?: string }): Promise<void> {
    const fullEvent = {
      ...event,
      id: event.id || uuidv4(),
    } as AnyEvent;

    this.eventLog.push(fullEvent);

    // Fire and forget — handlers run asynchronously
    // This means the publisher does NOT wait for handlers to complete
    setImmediate(() => {
      this.emitter.emit(fullEvent.type, fullEvent);
    });
  }

  subscribe<T extends AnyEvent>(
    eventType: EventType | EventType[],
    handler: EventHandler<T>
  ): () => void {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    const wrappedHandler = async (event: T) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[EventBus] Handler error for ${event.type}:`, err);
      }
    };

    types.forEach((type) => {
      this.emitter.on(type, wrappedHandler);
    });

    // Return an unsubscribe function
    return () => {
      types.forEach((type) => {
        this.emitter.off(type, wrappedHandler);
      });
    };
  }

  getEventLog(): AnyEvent[] {
    return [...this.eventLog];
  }

  getRecentEvents(studentId: string, limit = 20): AnyEvent[] {
    return this.eventLog
      .filter((e) => e.studentId === studentId)
      .slice(-limit);
  }
}

// Singleton — one bus for the whole application
export const eventBus = new EventBus();