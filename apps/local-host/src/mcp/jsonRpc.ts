/**
 * Minimal, dependency-free JSON-RPC 2.0 peer used for MCP communication.
 * Keeping this layer explicit avoids coupling the core to a specific MCP SDK version.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603
} as const;

export const isJsonRpcResponse = (message: unknown): message is JsonRpcResponse => {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate['jsonrpc'] === '2.0' &&
    'id' in candidate &&
    ('result' in candidate || 'error' in candidate)
  );
};

export const isJsonRpcRequest = (message: unknown): message is JsonRpcRequest => {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate['jsonrpc'] === '2.0' &&
    typeof candidate['method'] === 'string' &&
    'id' in candidate &&
    candidate['id'] !== null
  );
};

export const isJsonRpcNotification = (message: unknown): message is JsonRpcNotification => {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate['jsonrpc'] === '2.0' && typeof candidate['method'] === 'string' && !('id' in candidate)
  );
};

export class JsonRpcRemoteError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcErrorObject) {
    super(error.message);
    this.name = 'JsonRpcRemoteError';
    this.code = error.code;
    this.data = error.data;
  }
}

export class JsonRpcTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`MCP request "${method}" timed out after ${timeoutMs} ms.`);
    this.name = 'JsonRpcTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class JsonRpcTransportClosedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'JsonRpcTransportClosedError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface JsonRpcPeerOptions {
  send: (message: JsonRpcMessage) => Promise<void>;
  defaultTimeoutMs: number;
  onNotification?: (notification: JsonRpcNotification) => void;
  onServerRequest?: (request: JsonRpcRequest) => Promise<unknown> | unknown;
  idPrefix?: string;
}

/** Correlates requests with responses and enforces per-request timeouts. */
export class JsonRpcPeer {
  readonly #options: JsonRpcPeerOptions;
  readonly #pending = new Map<string | number, PendingRequest>();
  #sequence = 0;
  #closed: Error | undefined;

  constructor(options: JsonRpcPeerOptions) {
    this.#options = options;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.#closed) {
      throw new JsonRpcTransportClosedError(this.#closed.message);
    }
    this.#sequence += 1;
    const id = `${this.#options.idPrefix ?? 'ds'}-${this.#sequence}`;
    const timeout = timeoutMs ?? this.#options.defaultTimeoutMs;

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new JsonRpcTimeoutError(method, timeout));
      }, timeout);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer, method });
    });

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    };

    try {
      await this.#options.send(request);
    } catch (error) {
      const pending = this.#pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(id);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }

    return promise;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.#closed) {
      throw new JsonRpcTransportClosedError(this.#closed.message);
    }
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params })
    };
    await this.#options.send(notification);
  }

  /** Feeds an inbound message from the transport into the peer. */
  accept(message: unknown): void {
    if (isJsonRpcResponse(message)) {
      const key = message.id ?? '';
      const pending = this.#pending.get(key as string | number);
      if (!pending) return;
      this.#pending.delete(key as string | number);
      clearTimeout(pending.timer);
      if ('error' in message) {
        pending.reject(new JsonRpcRemoteError(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (isJsonRpcRequest(message)) {
      void this.#handleServerRequest(message);
      return;
    }
    if (isJsonRpcNotification(message)) {
      this.#options.onNotification?.(message);
    }
  }

  async #handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.#options.onServerRequest;
    if (!handler) {
      await this.#safeSend({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: JSON_RPC_ERRORS.methodNotFound,
          message: `Unsupported server request: ${request.method}`
        }
      });
      return;
    }
    try {
      const result = await handler(request);
      await this.#safeSend({ jsonrpc: '2.0', id: request.id, result: result ?? {} });
    } catch (error) {
      await this.#safeSend({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: JSON_RPC_ERRORS.internalError,
          message: error instanceof Error ? error.message : 'Handler failed'
        }
      });
    }
  }

  async #safeSend(message: JsonRpcMessage): Promise<void> {
    try {
      await this.#options.send(message);
    } catch {
      // Transport already gone: nothing else to do.
    }
  }

  /** Fails all in-flight requests (transport closed / crashed). */
  fail(reason: Error): void {
    this.#closed = reason;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
  }
}