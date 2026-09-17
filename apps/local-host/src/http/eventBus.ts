import type { HostEvent } from '@desaignsync/shared-types';

/** Fan-out bus for host lifecycle, MCP and log events streamed over WS `/events`. */
export class EventBus {
  readonly #subscribers = new Set<(event: HostEvent) => void>();

  subscribe(handler: (event: HostEvent) => void): () => void {
    this.#subscribers.add(handler);
    return () => {
      this.#subscribers.delete(handler);
    };
  }

  publish(event: HostEvent): void {
    for (const handler of [...this.#subscribers]) {
      try {
        handler(event);
      } catch {
        // A broken subscriber must never break the host.
      }
    }
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }
}