import {
  HOST_API_PATHS,
  type ApiErrorResponse,
  type HealthResponse,
  type HostErrorBody,
  type HostErrorCode,
  type HostEvent,
  type HostInfoResponse,
  type McpServersResponse,
  type McpToolCallOutcome,
  type McpToolCallRequest,
  type PairResponse,
  type SessionInfoResponse,
  type TestMcpServerRequest,
  type TestMcpServerResponse
} from '@desaignsync/shared-types';

export interface LocalHostClientOptions {
  baseUrl: string;
  token?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HostRequestError extends Error {
  readonly code: HostErrorCode;
  readonly correlationId: string;
  readonly retryable: boolean;

  constructor(body: HostErrorBody) {
    super(body.message);
    this.name = 'HostRequestError';
    this.code = body.code;
    this.correlationId = body.correlationId;
    this.retryable = body.retryable;
  }
}

/**
 * Typed client for the loopback host API (spec v2.1 §18).
 * The Side Panel never executes processes and never sees API keys; it only holds the
 * ephemeral session token issued after pairing.
 */
export class LocalHostClient {
  readonly baseUrl: string;
  #token: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: LocalHostClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  get token(): string | undefined {
    return this.#token;
  }

  setToken(token: string | undefined): void {
    this.#token = token;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {})
    };
    if (this.#token) headers['authorization'] = `Bearer ${this.#token}`;

    let response: Response;
    try {
      response = await this.#fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new HostRequestError({
        code: 'HOST_NOT_READY',
        message:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The Local MCP Host did not answer in time.'
            : 'The Local MCP Host is not reachable on loopback.',
        retryable: true,
        correlationId: 'client-offline'
      });
    }

    const text = await response.text();
    const parsed = text.trim() === '' ? {} : safeJsonParse(text);
    if (!response.ok) {
      const errorBody = (parsed as ApiErrorResponse | undefined)?.error;
      throw new HostRequestError(
        errorBody ?? {
          code: 'INTERNAL',
          message: `Host responded with ${response.status}.`,
          retryable: false,
          correlationId: `http-${response.status}`
        }
      );
    }
    return parsed as T;
  }

  health(): Promise<HealthResponse> {
    return this.#request<HealthResponse>(HOST_API_PATHS.health);
  }

  pair(pairingCode: string, meta: { clientName?: string; extensionId?: string } = {}): Promise<PairResponse> {
    return this.#request<PairResponse>(HOST_API_PATHS.sessionPair, {
      method: 'POST',
      body: JSON.stringify({ pairingCode, ...meta })
    });
  }

  session(): Promise<SessionInfoResponse> {
    return this.#request<SessionInfoResponse>(HOST_API_PATHS.sessionInfo);
  }

  revokeSession(): Promise<{ revoked: boolean }> {
    return this.#request<{ revoked: boolean }>(HOST_API_PATHS.sessionInfo, { method: 'DELETE' });
  }

  info(): Promise<HostInfoResponse> {
    return this.#request<HostInfoResponse>(HOST_API_PATHS.info);
  }

  servers(): Promise<McpServersResponse> {
    return this.#request<McpServersResponse>(HOST_API_PATHS.mcpServers);
  }

  testServer(payload: TestMcpServerRequest): Promise<TestMcpServerResponse> {
    return this.#request<TestMcpServerResponse>(HOST_API_PATHS.mcpServersTest, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  callTool(payload: McpToolCallRequest): Promise<McpToolCallOutcome> {
    return this.#request<McpToolCallOutcome>(HOST_API_PATHS.mcpToolsCall, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /** Subscribes to host events over WS `/events`. Returns an unsubscribe function. */
  subscribeEvents(
    onEvent: (event: HostEvent) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (!this.#token) {
      throw new HostRequestError({
        code: 'UNAUTHORIZED',
        message: 'Pair with the host before subscribing to events.',
        retryable: false,
        correlationId: 'client-no-token'
      });
    }
    const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}${HOST_API_PATHS.events}?token=${encodeURIComponent(this.#token)}`;
    const socket = new WebSocket(wsUrl);
    socket.addEventListener('message', (event) => {
      const parsed = safeJsonParse(String(event.data));
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        onEvent(parsed as HostEvent);
      }
    });
    socket.addEventListener('error', () => {
      onError?.(new Error('Host event stream error.'));
    });
    return () => {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    };
  }
}

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};