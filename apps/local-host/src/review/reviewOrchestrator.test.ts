import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElementTarget, McpServerConfig } from '@desaignsync/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import { startLlmFixture, type StartedLlmFixture } from '../../../../tests/fixtures/llmHttpFixture.js';
import { startLocalHost, type StartedHost } from '../host.js';

const chromeFixture = fileURLToPath(
  new URL('../../../../tests/fixtures/chrome-devtools-mcp-fixture.mjs', import.meta.url)
);
const designSystemFixture = fileURLToPath(
  new URL('../../../../tests/fixtures/design-system-mcp-fixture.mjs', import.meta.url)
);

const hosts: StartedHost[] = [];
const llmFixtures: StartedLlmFixture[] = [];

const target: ElementTarget = {
  schemaVersion: 1,
  selector: '#save',
  tagName: 'button',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  capturedAt: '2026-09-17T00:00:00.000Z'
};

const startTestHost = async (options: {
  withDesignSystem: boolean;
}): Promise<StartedHost> => {
  const llm = await startLlmFixture('ok');
  llmFixtures.push(llm);

  const servers: McpServerConfig[] = [
    {
      id: 'chrome-fixture',
      name: 'Chrome fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [chromeFixture],
      role: 'inspection',
      enabled: true,
      autoStart: false,
      timeoutMs: 8_000
    }
  ];
  if (options.withDesignSystem) {
    servers.push({
      id: 'ds-fixture',
      name: 'Design System fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [designSystemFixture],
      role: 'design-system-reference',
      enabled: true,
      autoStart: false,
      timeoutMs: 8_000
    });
  }

  const host = await startLocalHost({
    env: {
      DESAIGNSYNC_HOME: mkdtempSync(join(tmpdir(), 'desaignsync-review-')),
      DESAIGNSYNC_LOG_LEVEL: 'silent',
      // Hermetic secrets: the encrypted-file backend instead of the real OS keychain.
      DESAIGNSYNC_SECRET_BACKEND: 'file'
    },
    overrides: { port: 0 },
    connectAutoStart: false,
    servers
  });
  hosts.push(host);

  await host.mcp.connect('chrome-fixture');
  if (options.withDesignSystem) await host.mcp.connect('ds-fixture');
  await host.providers.save({
    id: 'llm-fixture',
    name: 'Fixture LLM',
    baseUrl: llm.url,
    apiKey: 'sk-fixture-key',
    modelIds: ['fixture-model-a'],
    selectedModel: 'fixture-model-a',
    visionMode: 'auto'
  });
  return host;
};

afterEach(async () => {
  while (hosts.length > 0) {
    const host = hosts.pop();
    if (host) await host.shutdown();
  }
  while (llmFixtures.length > 0) {
    const fixture = llmFixtures.pop();
    if (fixture) await fixture.close();
  }
});

describe('review orchestrator (DS-018 vertical slice, real fixtures only)', () => {
  it('runs Chrome -> Design System -> matching -> rules -> LLM end to end', async () => {
    const host = await startTestHost({ withDesignSystem: true });

    const result = await host.review.review({
      target,
      profileId: 'design-qa',
      llmProviderId: 'llm-fixture',
      inspectionMcpId: 'chrome-fixture',
      designSystemMcpId: 'ds-fixture'
    });

    expect(result.evidence.tagName).toBe('button');
    expect(result.evidence.normalizedClassTokens).toContain('primary');
    expect(result.evidence.snapshotExcerpt).toContain('AX tree');
    expect(result.match.selected?.componentName).toBe('Button');
    expect(result.match.selected?.variantName).toBe('Primary');
    expect(result.match.outcome).toBe('primary');
    expect(result.findings.find((finding) => finding.ruleId === 'color.background')?.status).toBe('PASS');
    expect(result.findings.find((finding) => finding.ruleId === 'accessibility.contrast')?.status).toBe('PASS');
    expect(result.summary.FAIL).toBe(0);
    expect(result.llm.status).toBe('ok');
    expect(result.llm.interpretation).toContain('Button');
    expect(result.versions.corePromptFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(result.versions.profile?.id).toBe('design-qa');
    expect(result.reproducibility.designSystemMcpId).toBe('ds-fixture');
    expect(result.reproducibility.model).toBe('fixture-model-a');
    expect(Date.parse(result.finishedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
  });

  it('keeps the deterministic report when the Design System MCP is unavailable', async () => {
    const host = await startTestHost({ withDesignSystem: false });

    const result = await host.review.review({
      target,
      inspectionMcpId: 'chrome-fixture',
      profileId: 'design-qa',
      options: { includeLlm: false }
    });

    expect(result.match.outcome).toBe('no-reliable-match');
    expect(result.match.selected).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('No Design System MCP server is connected');
    // Facts that do not depend on the Design System survive the failure.
    expect(result.findings.find((finding) => finding.ruleId === 'accessibility.contrast')?.status).toBe('PASS');
    expect(result.findings.find((finding) => finding.ruleId === 'color.background')?.status).toBe('NOT_EVALUATED');
    expect(result.summary.FAIL).toBe(0);
    expect(result.llm.status).toBe('skipped');
  });

  it('keeps the deterministic report when the LLM provider fails', async () => {
    const host = await startTestHost({ withDesignSystem: true });
    await host.providers.save({
      id: 'broken-llm',
      name: 'Broken provider',
      baseUrl: 'http://127.0.0.1:1/v1',
      modelIds: ['broken-model'],
      selectedModel: 'broken-model'
    });

    const result = await host.review.review({
      target,
      profileId: 'design-qa',
      llmProviderId: 'broken-llm',
      inspectionMcpId: 'chrome-fixture',
      designSystemMcpId: 'ds-fixture',
      options: { llmTimeoutMs: 500 }
    });

    expect(result.llm.status).toBe('failed');
    expect(result.llm.error?.code).toBe('LLM_BAD_RESPONSE');
    expect(result.warnings.join(' ')).toContain('LLM interpretation unavailable');
    expect(result.match.outcome).toBe('primary');
    expect(result.findings.find((finding) => finding.ruleId === 'color.background')?.status).toBe('PASS');
    expect(result.summary.FAIL).toBe(0);
  });

  it('can be re-run with another profile and records which one produced the report', async () => {
    const host = await startTestHost({ withDesignSystem: true });
    const request = {
      target,
      inspectionMcpId: 'chrome-fixture',
      designSystemMcpId: 'ds-fixture',
      options: { includeLlm: false }
    } as const;

    const designQa = await host.review.review({ ...request, profileId: 'design-qa' });
    const accessibility = await host.review.review({ ...request, profileId: 'accessibility' });

    expect(designQa.versions.profile?.id).toBe('design-qa');
    expect(accessibility.versions.profile?.id).toBe('accessibility');
    expect(designQa.findings.some((finding) => finding.ruleId === 'dimensions.height')).toBe(true);
    expect(accessibility.findings.some((finding) => finding.ruleId === 'dimensions.height')).toBe(false);
  });

  it('rejects an invalid element target at the HTTP boundary', async () => {
    const host = await startTestHost({ withDesignSystem: false });

    const pairResponse = await fetch(`${host.server.url}/session/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingCode: host.sessions.pairingCode })
    });
    const pair = (await pairResponse.json()) as { token: string };

    const response = await fetch(`${host.server.url}/inspection/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${pair.token}` },
      body: JSON.stringify({ target: { selector: '' } })
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
  });
});
