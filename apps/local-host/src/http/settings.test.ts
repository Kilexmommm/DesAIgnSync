import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startLlmFixture, type StartedLlmFixture } from '../../../../tests/fixtures/llmHttpFixture.js';
import { startLocalHost, type StartedHost } from '../host.js';

const hosts: StartedHost[] = [];
const fixtures: StartedLlmFixture[] = [];

afterEach(async () => {
  while (hosts.length > 0) {
    const host = hosts.pop();
    if (host) await host.shutdown();
  }
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture) await fixture.close();
  }
});

const startHost = async (): Promise<{ host: StartedHost; home: string }> => {
  const home = mkdtempSync(join(tmpdir(), 'desaignsync-settings-'));
  const host = await startLocalHost({
    env: { DESAIGNSYNC_HOME: home, DESAIGNSYNC_LOG_LEVEL: 'silent', DESAIGNSYNC_SECRET_BACKEND: 'file' },
    overrides: { port: 0 },
    connectAutoStart: false
  });
  hosts.push(host);
  return { host, home };
};

type AuthedRequest = (path: string, init?: RequestInit) => Promise<Response>;

const withAuth = async (host: StartedHost): Promise<AuthedRequest> => {
  const paired = await fetch(`${host.server.url}/session/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingCode: host.sessions.pairingCode })
  });
  const { token } = (await paired.json()) as { token: string };
  return (path, init = {}) =>
    fetch(`${host.server.url}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...((init.headers as Record<string, string> | undefined) ?? {})
      }
    });
};

const defaultMatching = {
  weights: {
    semantic: 0.25,
    structure: 0.15,
    attributes: 0,
    classes: 0.1,
    css: 0.2,
    geometry: 0.1,
    vision: 0.05,
    docs: 0.05,
    llm: 0.1
  },
  minConfidence: 0.65,
  maxCandidates: 3
};

describe('settings API + persistence (DS-028)', () => {
  it('saves an LLM provider, keeps the API key out of the config file and lists models', async () => {
    const fixture = await startLlmFixture('ok');
    fixtures.push(fixture);
    const { host, home } = await startHost();
    const request = await withAuth(host);

    const saved = await request('/llm/providers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Fixture provider',
        baseUrl: fixture.url,
        apiKey: 'sk-fixture-secret-value',
        modelIds: ['fixture-model-a'],
        selectedModel: 'fixture-model-a',
        visionMode: 'auto'
      })
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { provider: { id: string; hasApiKeyRef: boolean } };
    expect(savedBody.provider.hasApiKeyRef).toBe(true);

    const configRaw = readFileSync(join(home, 'config.json'), 'utf8');
    expect(configRaw).toContain('apiKeySecretRef');
    expect(configRaw).not.toContain('sk-fixture-secret-value');
    expect(await host.secrets.get(`llm.${savedBody.provider.id}.apiKey`)).toBe('sk-fixture-secret-value');

    const models = await request('/llm/providers/models', {
      method: 'POST',
      body: JSON.stringify({ providerId: savedBody.provider.id })
    });
    const modelsBody = (await models.json()) as { ok: boolean; models: string[] };
    expect(modelsBody.ok).toBe(true);
    expect(modelsBody.models).toContain('fixture-model-a');

    const test = await request('/llm/providers/test', {
      method: 'POST',
      body: JSON.stringify({ providerId: savedBody.provider.id })
    });
    expect(((await test.json()) as { ok: boolean }).ok).toBe(true);

    const removed = await request('/llm/providers/remove', {
      method: 'POST',
      body: JSON.stringify({ providerId: savedBody.provider.id })
    });
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);
    expect(await host.secrets.get(`llm.${savedBody.provider.id}.apiKey`)).toBeUndefined();
    const providersNow = await request('/llm/providers');
    expect(((await providersNow.json()) as { providers: unknown[] }).providers).toHaveLength(0);
  });

  it('allows adding a model manually even when /models is missing (AC-11)', async () => {
    const fixture = await startLlmFixture('no-models');
    fixtures.push(fixture);
    const { host } = await startHost();
    const request = await withAuth(host);

    const saved = await request('/llm/providers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'No models endpoint',
        baseUrl: fixture.url,
        modelIds: ['manual-model'],
        selectedModel: 'manual-model'
      })
    });
    const providerId = ((await saved.json()) as { provider: { id: string } }).provider.id;

    const models = await request('/llm/providers/models', {
      method: 'POST',
      body: JSON.stringify({ providerId })
    });
    expect(((await models.json()) as { ok: boolean }).ok).toBe(false);

    const test = await request('/llm/providers/test', {
      method: 'POST',
      body: JSON.stringify({ providerId })
    });
    expect(((await test.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('persists MCP servers and lets the user remove them', async () => {
    const { host, home } = await startHost();
    const request = await withAuth(host);

    const saved = await request('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({
        server: {
          id: 'custom-ds',
          name: 'Custom Design System',
          transport: 'streamable-http',
          url: 'http://127.0.0.1:6006/mcp',
          role: 'design-system-reference',
          enabled: true,
          autoStart: false
        },
        connect: false
      })
    });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(home, 'config.json'), 'utf8')).toContain('custom-ds');

    const removed = await request('/mcp/servers/remove', {
      method: 'POST',
      body: JSON.stringify({ serverId: 'custom-ds' })
    });
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);

    const servers = await request('/mcp/servers');
    const ids = ((await servers.json()) as { servers: Array<{ serverId: string }> }).servers.map(
      (server) => server.serverId
    );
    expect(ids).not.toContain('custom-ds');
  });

  it('refuses to remove a built-in profile but accepts a custom one', async () => {
    const { host } = await startHost();
    const request = await withAuth(host);

    const builtIn = await request('/profiles/remove', {
      method: 'POST',
      body: JSON.stringify({ profileId: 'design-qa' })
    });
    const builtInBody = (await builtIn.json()) as { removed: boolean; reason?: string };
    expect(builtInBody.removed).toBe(false);
    expect(builtInBody.reason).toContain('Built-in');

    const saved = await request('/profiles/save', {
      method: 'POST',
      body: JSON.stringify({
        profile: {
          id: 'mi-perfil',
          name: 'Mi perfil',
          tier: 'expert',
          checks: {},
          matching: defaultMatching,
          advancedInstructions: 'Sé estricto con los formularios.'
        }
      })
    });
    expect(saved.status).toBe(200);

    const list = await request('/profiles');
    expect(((await list.json()) as { profiles: Array<{ id: string }> }).profiles.map((p) => p.id)).toContain(
      'mi-perfil'
    );

    const removed = await request('/profiles/remove', {
      method: 'POST',
      body: JSON.stringify({ profileId: 'mi-perfil' })
    });
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);
  });

  it('rejects an invalid profile with structured issues instead of persisting it', async () => {
    const { host } = await startHost();
    const request = await withAuth(host);

    const response = await request('/profiles/save', {
      method: 'POST',
      body: JSON.stringify({
        profile: {
          id: 'broken',
          name: 'Broken',
          tier: 'expert',
          checks: {},
          matching: { ...defaultMatching, minConfidence: 3 },
          advancedInstructions: ''
        }
      })
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFIG_INVALID');
    expect(body.error.message).toContain('minimum confidence');
  });
});
