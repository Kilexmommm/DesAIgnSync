import {
  HOST_API_PATHS,
  type ApiErrorResponse,
  type HealthResponse,
  type HostErrorBody,
  type HostErrorCode,
  type HostEvent,
  type HostInfoResponse,
  type LlmModelsResponse,
  type LlmProvidersResponse,
  type McpServerConfig,
  type McpServerRuntimeStatus,
  type McpServersResponse,
  type McpToolCallOutcome,
  type McpToolCallRequest,
  type PairResponse,
  type ProfilesResponse,
  type RemoveLlmProviderResponse,
  type RemoveMcpServerResponse,
  type RemoveProfileResponse,
  type ReviewRequest,
  type ReviewResult,
  type SaveLlmProviderRequest,
  type SaveProfileResponse,
  type SessionInfoResponse,
  type TestLlmProviderRequest,
  type TestLlmProviderResponse,
  type TestMcpServerRequest,
  type TestMcpServerResponse,
  type ValidationProfile
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

  async #request<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
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
        signal: AbortSignal.timeout(timeoutMs ?? this.#timeoutMs)
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

  /* --- Settings mutations (DS-028). The panel never sees an API key coming back. --- */

  saveServer(server: McpServerConfig, connect = false): Promise<{ status?: McpServerRuntimeStatus }> {
    return this.#request<{ status?: McpServerRuntimeStatus }>(HOST_API_PATHS.mcpServers, {
      method: 'POST',
      body: JSON.stringify({ server, connect })
    });
  }

  removeServer(serverId: string): Promise<RemoveMcpServerResponse> {
    return this.#request<RemoveMcpServerResponse>(HOST_API_PATHS.mcpServersRemove, {
      method: 'POST',
      body: JSON.stringify({ serverId })
    });
  }

  providers(): Promise<LlmProvidersResponse> {
    return this.#request<LlmProvidersResponse>(HOST_API_PATHS.llmProviders);
  }

  saveProvider(input: SaveLlmProviderRequest): Promise<{ provider?: LlmProvidersResponse['providers'][number] }> {
    return this.#request<{ provider?: LlmProvidersResponse['providers'][number] }>(HOST_API_PATHS.llmProviders, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  removeProvider(providerId: string): Promise<RemoveLlmProviderResponse> {
    return this.#request<RemoveLlmProviderResponse>(HOST_API_PATHS.llmProvidersRemove, {
      method: 'POST',
      body: JSON.stringify({ providerId })
    });
  }

  testProvider(payload: TestLlmProviderRequest): Promise<TestLlmProviderResponse> {
    return this.#request<TestLlmProviderResponse>(HOST_API_PATHS.llmProvidersTest, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  providerModels(payload: TestLlmProviderRequest): Promise<LlmModelsResponse> {
    return this.#request<LlmModelsResponse>(HOST_API_PATHS.llmProvidersModels, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  saveProfile(profile: ValidationProfile): Promise<SaveProfileResponse> {
    return this.#request<SaveProfileResponse>(HOST_API_PATHS.profilesSave, {
      method: 'POST',
      body: JSON.stringify({ profile })
    });
  }

  removeProfile(profileId: string): Promise<RemoveProfileResponse> {
    return this.#request<RemoveProfileResponse>(HOST_API_PATHS.profilesRemove, {
      method: 'POST',
      body: JSON.stringify({ profileId })
    });
  }

  profiles(): Promise<ProfilesResponse> {
    return this.#request<ProfilesResponse>(HOST_API_PATHS.profiles);
  }

  /** Full element review (DS-018). Slow by nature: Chrome MCP + Design System MCP + optional LLM. */
  review(payload: ReviewRequest): Promise<ReviewResult> {
    return this.#request<ReviewResult>(
      HOST_API_PATHS.inspectionReview,
      { method: 'POST', body: JSON.stringify(payload) },
      180_000
    );
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