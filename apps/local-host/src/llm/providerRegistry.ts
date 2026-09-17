import {
  DesaignSyncHostError,
  type LlmProviderConfig,
  type LlmProvidersResponse,
  type SaveLlmProviderRequest
} from '@desaignsync/shared-types';

import { LlmProviderAdapter } from './llmProviderAdapter.js';
import type { SecretStore } from '../security/secretStoreFactory.js';

/**
 * LLM provider registry (DS-008 API surface, spec §8/§18).
 * The API key is written to the SecretStore; the config only keeps a reference, so no
 * endpoint can ever return it (spec §19).
 */
export class LlmProviderRegistry {
  readonly #providers = new Map<string, LlmProviderConfig>();
  readonly #secrets: SecretStore;

  constructor(secrets: SecretStore) {
    this.#secrets = secrets;
  }

  async save(input: SaveLlmProviderRequest): Promise<LlmProviderConfig> {
    const name = input.name.trim();
    const baseUrl = input.baseUrl.trim().replace(/\/$/, '');
    if (name === '' || baseUrl === '') {
      throw new DesaignSyncHostError('CONFIG_INVALID', 'Provider name and base URL are required.');
    }
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new DesaignSyncHostError('CONFIG_INVALID', 'The provider base URL is not a valid http(s) URL.');
    }

    const id = input.id?.trim() !== undefined && input.id.trim() !== '' ? input.id.trim() : `llm-${Date.now().toString(36)}`;
    const existing = this.#providers.get(id);

    let apiKeySecretRef = existing?.apiKeySecretRef;
    if (input.apiKey !== undefined && input.apiKey !== '') {
      apiKeySecretRef = `llm.${id}.apiKey`;
      await this.#secrets.set(apiKeySecretRef, input.apiKey);
    }

    const config: LlmProviderConfig = {
      id,
      name,
      baseUrl,
      modelIds: input.modelIds?.map((model) => model.trim()).filter((model) => model !== '') ?? existing?.modelIds ?? [],
      visionMode: input.visionMode ?? existing?.visionMode ?? 'auto'
    };
    if (apiKeySecretRef !== undefined) config.apiKeySecretRef = apiKeySecretRef;
    const selectedModel = pick(input.selectedModel, existing?.selectedModel);
    if (selectedModel !== undefined) config.selectedModel = selectedModel;
    const headers = pick(input.headers, existing?.headers);
    if (headers !== undefined) config.headers = headers;
    const temperature = pick(input.temperature, existing?.temperature);
    if (temperature !== undefined) config.temperature = temperature;
    const timeoutMs = pick(input.timeoutMs, existing?.timeoutMs);
    if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;

    this.#providers.set(id, config);
    return config;
  }

  list(): LlmProviderConfig[] {
    return [...this.#providers.values()];
  }

  get(id: string): LlmProviderConfig | undefined {
    return this.#providers.get(id);
  }

  defaultId(): string | undefined {
    return this.list()[0]?.id;
  }

  adapter(id?: string): LlmProviderAdapter {
    const providerId = id ?? this.defaultId();
    if (providerId === undefined) {
      throw new DesaignSyncHostError('LLM_PROVIDER_NOT_CONFIGURED', 'No LLM provider is configured.');
    }
    const config = this.#providers.get(providerId);
    if (config === undefined) {
      throw new DesaignSyncHostError(
        'LLM_PROVIDER_NOT_CONFIGURED',
        `Unknown LLM provider "${providerId}".`,
        { details: { providerId } }
      );
    }
    return new LlmProviderAdapter(config, { secretResolver: (ref) => this.#secrets.get(ref) });
  }

  async remove(id: string): Promise<boolean> {
    const config = this.#providers.get(id);
    if (config === undefined) return false;
    if (config.apiKeySecretRef !== undefined) {
      await this.#secrets.delete(config.apiKeySecretRef).catch(() => false);
    }
    return this.#providers.delete(id);
  }

  /** Safe projection for the Side Panel: references only, never key material. */
  describe(): LlmProvidersResponse['providers'] {
    return this.list().map((config) => ({
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      hasApiKeyRef: config.apiKeySecretRef !== undefined,
      modelIds: [...config.modelIds],
      ...(config.selectedModel !== undefined ? { selectedModel: config.selectedModel } : {}),
      visionMode: config.visionMode,
      ...(config.isDefault !== undefined ? { isDefault: config.isDefault } : {})
    }));
  }
}

const pick = <T>(...values: Array<T | undefined>): T | undefined => values.find((value) => value !== undefined);
