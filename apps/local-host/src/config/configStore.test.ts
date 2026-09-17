import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../logging/logger.js';
import { ConfigStore } from './configStore.js';

const createStore = (): { store: ConfigStore; path: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'desaignsync-config-store-'));
  const path = join(dir, 'config.json');
  return { store: new ConfigStore({ configPath: path, logger: createLogger({ level: 'silent' }) }), path };
};

describe('ConfigStore (DS-028)', () => {
  it('treats a missing file as a valid first run', () => {
    const { store } = createStore();
    expect(store.read()).toEqual({});
  });

  it('persists sections with a read-modify-write so other sections survive', () => {
    const { store, path } = createStore();
    store.saveLlmProviders([
      {
        id: 'llm-1',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiKeySecretRef: 'llm.llm-1.apiKey',
        modelIds: ['m'],
        visionMode: 'auto'
      }
    ]);
    store.saveMcpServers([
      {
        id: 'chrome-devtools',
        name: 'Chrome DevTools',
        transport: 'stdio',
        command: 'npx',
        role: 'inspection',
        enabled: true,
        autoStart: false
      }
    ]);

    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(raw['llmProviders']).toHaveLength(1);
    expect(raw['mcpServers']).toHaveLength(1);
    expect(raw['version']).toBe(1);

    const reloaded = new ConfigStore({ configPath: path, logger: createLogger({ level: 'silent' }) });
    expect(reloaded.read().llmProviders?.[0]?.id).toBe('llm-1');
  });

  it('refuses to persist secret-looking fields', () => {
    const { store } = createStore();
    expect(() =>
      store.update({
        llmProviders: [
          {
            id: 'x',
            name: 'x',
            baseUrl: 'http://127.0.0.1:1234/v1',
            modelIds: [],
            visionMode: 'auto',
            apiKey: 'sk-live-should-never-be-written'
          } as never
        ]
      })
    ).toThrow(/Refusing to persist/);
  });

  it('persists only custom profiles and keeps the built-ins out of the file', () => {
    const { store, path } = createStore();
    const matching = {
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
    store.saveProfiles([
      {
        id: 'design-qa',
        name: 'Design QA',
        tier: 'advanced',
        checks: {},
        matching,
        advancedInstructions: '',
        isBuiltIn: true
      },
      { id: 'mi-perfil', name: 'Mi perfil', tier: 'expert', checks: {}, matching, advancedInstructions: 'Sé estricto.' }
    ]);

    const raw = JSON.parse(readFileSync(path, 'utf8')) as { profiles: Array<{ id: string }> };
    expect(raw.profiles.map((profile) => profile.id)).toEqual(['mi-perfil']);
  });
});
