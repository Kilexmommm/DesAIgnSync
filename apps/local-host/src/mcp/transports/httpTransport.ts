import { DesaignSyncHostError } from '@desaignsync/shared-types';

import type { JsonRpcMessage } from '../jsonRpc.js';
import { redactUrl } from '../../security/redaction.js';
import { TransportClosedError, type McpTransport, type TransportCloseReason } from '../transport.js';

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Streamable HTTP transport (MCP 2025-06-18). Works with servers such as the
 * Storybook MCP endpoint (`http://localhost:6006/mcp`) without assuming a vendor.
 */
export class StreamableHttpMcpTransport implements McpTransport {
  readonly kind = 'streamable-http' as const;
  readonly summary: string;

  #sessionId: string | undefined;
  #closed = false;
  #messageHandlers: Array<(message: unknown) => void> = [];
  #closeHandlers: Array<(reason: TransportCloseReason) => void> = [];
  readonly #options: HttpTransportOptions;
  readonly #fetch: typeof fetch;

  constructor(options: HttpTransportOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
    this.summary = redactUrl(options.url);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#messageHandlers.push(handler);
  }

  onClose(handler: (reason: TransportCloseReason) => void): void {
    this.#closeHandlers.push(handler);
  }

  async start(): Promise<void> {
    try {
      const parsed = new URL(this.#options.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new DesaignSyncHostError(
        'MCP_CONNECT_FAILED',
        `Invalid MCP HTTP URL: ${redactUrl(this.#options.url)}`
      );
    }
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.#sessionId ? { 'mcp-session-id': this.#sessionId } : {}),
      ...(this.#options.headers ?? {}),
      ...extra
    };
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.#closed) {
      throw new TransportClosedError('MCP HTTP transport is closed.');
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#options.url, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 20_000)
      });
    } catch (error) {
      throw new TransportClosedError(
        error instanceof Error ? error.message : 'MCP HTTP request failed.'
      );
    }

    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.#sessionId = sessionId;

    if (!response.ok) {
      const statusText = `${response.status} ${response.statusText}`.trim();
      throw new TransportClosedError(`MCP HTTP server responded with ${statusText}.`, response.status);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      await this.#consumeEventStream(response);
      return;
    }
    const text = await response.text();
    if (text.trim() === '') return;
    try {
      this.#dispatch(JSON.parse(text));
    } catch {
      // Non JSON-RPC body: ignore, the peer timeout will surface the problem.
    }
  }

  async #consumeEventStream(response: Response): Promise<void> {
    const body = response.body;
    if (!body) return;
    const decoder = new TextDecoder();
    let buffer = '';
    const reader = body.getReader();
    try {
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) {
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '' || payload === '[DONE]') continue;
            try {
              this.#dispatch(JSON.parse(payload));
            } catch {
              // Ignore malformed SSE payloads.
            }
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Stream already finished.
      }
    }
  }

  #dispatch(message: unknown): void {
    for (const handler of this.#messageHandlers) handler(message);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#sessionId) {
      try {
        await this.#fetch(this.#options.url, {
          method: 'DELETE',
          headers: this.#headers(),
          signal: AbortSignal.timeout(2_000)
        });
      } catch {
        // Best effort: the server may not support session termination.
      }
    }
    const handlers = this.#closeHandlers;
    this.#closeHandlers = [];
    for (const handler of handlers) handler({});
  }
}