import {
  DesaignSyncHostError,
  type HostErrorBody,
  type LlmProviderConfig
} from '@desaignsync/shared-types';

import { redactUrl } from '../security/redaction.js';

/**
 * OpenAI-compatible provider adapter (DS-008, spec v2.1 §8).
 * The user owns Base URL, API key (stored as a secret reference) and model selection.
 * `fetchModels` is optional by design: many compatible endpoints do not implement /models,
 * so manual model IDs are always supported (AC-11).
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Requests JSON-mode `response_format` when the endpoint supports it. */
  jsonMode?: boolean;
}

export interface LlmCompletion {
  text: string;
  model: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LlmRuntimeOptions {
  secretResolver: (ref: string) => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface LlmOperationResult<T> {
  ok: boolean;
  value?: T;
  latencyMs?: number;
  error?: HostErrorBody;
}

const toError = (
  code: HostErrorBody['code'],
  message: string,
  retryable = false
): HostErrorBody => ({
  code,
  message,
  retryable,
  correlationId: `llm-${Date.now().toString(36)}`
});

export const toHostErrorBody = (error: unknown): HostErrorBody => {
  if (error instanceof DesaignSyncHostError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      correlationId: `llm-${Date.now().toString(36)}`,
      ...(error.details ? { details: error.details } : {})
    };
  }
  return toError('LLM_BAD_RESPONSE', error instanceof Error ? error.message : 'Unexpected LLM failure.');
};

export class LlmProviderAdapter {
  readonly config: LlmProviderConfig;
  readonly #options: LlmRuntimeOptions;
  readonly #fetch: typeof fetch;

  constructor(config: LlmProviderConfig, options: LlmRuntimeOptions) {
    this.config = config;
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch.bind(globalThis);
  }

  get name(): string {
    return this.config.name;
  }

  get baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  get selectedModel(): string | undefined {
    return this.config.selectedModel ?? this.config.modelIds[0];
  }

  /** `auto` defers to the endpoint; `yes`/`no` follow the explicit user setting. */
  get visionEnabled(): boolean {
    if (this.config.visionMode === 'yes') return true;
    if (this.config.visionMode === 'no') return false;
    return true;
  }

  async #apiKey(): Promise<string | undefined> {
    const ref = this.config.apiKeySecretRef;
    if (!ref) return undefined;
    const value = await this.#options.secretResolver(ref);
    if (value === undefined) {
      throw new DesaignSyncHostError(
        'SECRET_STORE_UNAVAILABLE',
        `No secret stored for reference "${ref}"; save the API key first.`
      );
    }
    return value;
  }

  #headers(apiKey: string | undefined): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(this.config.headers ?? {})
    };
  }

  async #requestJson<T>(
    path: string,
    init: { method: 'GET' } | { method: 'POST'; body: unknown },
    timeoutMs: number
  ): Promise<T> {
    const apiKey = await this.#apiKey();
    let response: Response;
    try {
      response = await this.#fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: this.#headers(apiKey),
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new DesaignSyncHostError(
        timedOut ? 'LLM_TIMEOUT' : 'LLM_BAD_RESPONSE',
        timedOut
          ? `The LLM endpoint did not answer within ${timeoutMs} ms.`
          : 'The LLM endpoint could not be reached.',
        { retryable: timedOut }
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new DesaignSyncHostError('LLM_AUTH_FAILED', 'The LLM endpoint rejected the credentials.', {
        details: { status: response.status }
      });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new DesaignSyncHostError('LLM_BAD_RESPONSE', `The LLM endpoint responded with ${response.status}.`, {
        details: { status: response.status }
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DesaignSyncHostError('LLM_BAD_RESPONSE', 'The LLM endpoint returned a non-JSON payload.');
    }
  }

  /** Best effort: absent /models is a normal outcome for many OpenAI-compatible servers. */
  async fetchModels(timeoutMs?: number): Promise<LlmOperationResult<string[]>> {
    const startedAt = Date.now();
    try {
      const payload = await this.#requestJson<{ data?: Array<{ id?: unknown }> }>(
        '/models',
        { method: 'GET' },
        timeoutMs ?? 10_000
      );
      const models = (payload.data ?? [])
        .map((entry) => entry?.id)
        .filter((id): id is string => typeof id === 'string');
      return { ok: true, value: models, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, error: toHostErrorBody(error), latencyMs: Date.now() - startedAt };
    }
  }

  /** Minimal auth+model probe. Never sends page data: the payload is the literal word "ping". */
  async testConnection(timeoutMs?: number): Promise<LlmOperationResult<{ model: string }>> {
    const startedAt = Date.now();
    const model = this.selectedModel;
    if (!model) {
      return {
        ok: false,
        error: toError('LLM_PROVIDER_NOT_CONFIGURED', 'No model selected for this provider.')
      };
    }
    try {
      await this.#requestJson<unknown>(
        '/chat/completions',
        {
          method: 'POST',
          body: { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }
        },
        timeoutMs ?? this.config.timeoutMs ?? 15_000
      );
      return { ok: true, value: { model }, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, error: toHostErrorBody(error), latencyMs: Date.now() - startedAt };
    }
  }

  async complete(request: LlmCompleteRequest, timeoutMs?: number): Promise<LlmCompletion> {
    const model = this.selectedModel;
    if (!model) {
      throw new DesaignSyncHostError('LLM_PROVIDER_NOT_CONFIGURED', 'No model selected for this provider.');
    }
    const messages: LlmMessage[] = [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...request.messages
    ];
    const payload: Record<string, unknown> = { model, messages, max_tokens: request.maxTokens ?? 1024 };
    const temperature = request.temperature ?? this.config.temperature;
    if (temperature !== undefined) payload['temperature'] = temperature;
    if (request.jsonMode) payload['response_format'] = { type: 'json_object' };

    const response = await this.#requestJson<{
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    }>('/chat/completions', { method: 'POST', body: payload }, timeoutMs ?? this.config.timeoutMs ?? 60_000);

    const choice = response.choices?.[0];
    const rawContent = choice?.message?.content;
    const text =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .map((part) =>
                typeof part === 'object' && part !== null && 'text' in part
                  ? String((part as { text: unknown }).text)
                  : ''
              )
              .join('')
          : '';
    const usage = response.usage;
    return {
      text,
      model,
      ...(typeof choice?.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
      ...(usage
        ? {
            usage: {
              ...(typeof usage.prompt_tokens === 'number' ? { promptTokens: usage.prompt_tokens } : {}),
              ...(typeof usage.completion_tokens === 'number'
                ? { completionTokens: usage.completion_tokens }
                : {})
            }
          }
        : {})
    };
  }

  /** Safe description for logs/UI: never includes the API key. */
  describe(): Record<string, unknown> {
    return {
      id: this.config.id,
      name: this.config.name,
      baseUrl: redactUrl(this.config.baseUrl),
      selectedModel: this.selectedModel,
      visionMode: this.config.visionMode,
      hasApiKeyRef: this.config.apiKeySecretRef !== undefined
    };
  }
}