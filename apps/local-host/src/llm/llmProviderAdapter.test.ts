import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LlmProviderConfig } from '@desaignsync/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import { LlmProviderAdapter } from './llmProviderAdapter.js';
import { startLlmFixture, type StartedLlmFixture } from '../../../../tests/fixtures/llmHttpFixture.js';

const fixtures: StartedLlmFixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture) await fixture.close();
  }
});

const createAdapter = async (
  mode: 'ok' | 'no-models' | 'auth-error',
  overrides: Partial<LlmProviderConfig> = {}
): Promise<{ adapter: LlmProviderAdapter; fixture: StartedLlmFixture }> => {
  const fixture = await startLlmFixture(mode);
  fixtures.push(fixture);
  const config: LlmProviderConfig = {
    id: 'llm-fixture',
    name: 'Fixture OpenAI-compatible',
    baseUrl: fixture.url,
    apiKeySecretRef: 'fixture.key',
    modelIds: ['fixture-model-a', 'fixture-vision-model'],
    selectedModel: 'fixture-model-a',
    visionMode: 'auto',
    ...overrides
  };
  const secrets = new Map<string, string>([['fixture.key', 'sk-fixture-abcdef']]);
  const adapter = new LlmProviderAdapter(config, {
    secretResolver: async (ref) => secrets.get(ref)
  });
  return { adapter, fixture };
};

describe('LlmProviderAdapter against a real OpenAI-compatible fixture (DS-008)', () => {
  it('fetches models when the endpoint implements /models', async () => {
    const { adapter } = await createAdapter('ok');
    const result = await adapter.fetchModels();
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(['fixture-model-a', 'fixture-vision-model']);
  });

  it('treats a missing /models as a normal outcome (manual model IDs stay valid)', async () => {
    const { adapter } = await createAdapter('no-models');
    const result = await adapter.fetchModels();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('LLM_BAD_RESPONSE');
    expect(adapter.selectedModel).toBe('fixture-model-a');
    expect(await adapter.testConnection()).toMatchObject({ ok: true, value: { model: 'fixture-model-a' } });
  });

  it('maps rejected credentials to LLM_AUTH_FAILED', async () => {
    const { adapter } = await createAdapter('auth-error');
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('LLM_AUTH_FAILED');
  });

  it('sends a minimal probe and never page data, then completes with parsed usage', async () => {
    const { adapter, fixture } = await createAdapter('ok');
    const test = await adapter.testConnection();
    expect(test.ok).toBe(true);
    expect(fixture.lastChatPayload()).toMatchObject({ model: 'fixture-model-a', max_tokens: 1 });

    const completion = await adapter.complete({
      system: 'You are a compliance engine.',
      messages: [{ role: 'user', content: 'Return pong.' }],
      maxTokens: 16,
      temperature: 0.1
    });
    expect(completion.text).toBe('pong');
    expect(completion.model).toBe('fixture-model-a');
    expect(completion.finishReason).toBe('stop');
    expect(completion.usage).toEqual({ promptTokens: 3, completionTokens: 1 });
  });

  it('fails clearly when no model is configured', async () => {
    const { adapter } = await createAdapter('ok', { modelIds: [], selectedModel: undefined });
    await expect(adapter.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /No model selected/
    );
  });

  it('resolves the API key through the secret store, never from config or logs', async () => {
    const { adapter, fixture } = await createAdapter('ok');
    const seenHeaders: Array<string | undefined> = [];
    const probeAdapter = new LlmProviderAdapter(adapter.config, {
      secretResolver: async () => 'sk-resolved-live-key',
      fetchImpl: (async (input: unknown, init?: { headers?: Record<string, string> }) => {
        seenHeaders.push(init?.headers?.['authorization']);
        return fetch(input as string, init);
      }) as typeof fetch
    });
    await probeAdapter.testConnection();
    expect(seenHeaders[0]).toBe('Bearer sk-resolved-live-key');
    expect(JSON.stringify(adapter.describe())).not.toContain('sk-');
    expect(fixture.url).toContain('/v1');
  });
});