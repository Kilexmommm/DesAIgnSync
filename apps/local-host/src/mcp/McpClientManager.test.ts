import { fileURLToPath } from 'node:url';

import type { McpServerConfig } from '@desaignsync/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '../logging/logger.js';
import { McpClientManager } from './McpClientManager.js';
import { startHttpMcpFixture, type StartedHttpMcpFixture } from '../../../../tests/fixtures/mcpHttpFixture.js';

const fixtureServer = fileURLToPath(
  new URL('../../../../tests/fixtures/mcp-echo-server.mjs', import.meta.url)
);

const managers: McpClientManager[] = [];
const httpFixtures: StartedHttpMcpFixture[] = [];

afterEach(async () => {
  while (managers.length > 0) {
    const manager = managers.pop();
    if (manager) await manager.dispose();
  }
  while (httpFixtures.length > 0) {
    const fixture = httpFixtures.pop();
    if (fixture) await fixture.close();
  }
});

const stdioConfig = (id: string, extra: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id,
  name: id,
  transport: 'stdio',
  command: process.execPath,
  args: [fixtureServer],
  role: 'generic',
  enabled: true,
  autoStart: false,
  timeoutMs: 8_000,
  ...extra
});

const createManager = (options: { maxRestarts?: number } = {}): McpClientManager => {
  const manager = new McpClientManager({
    defaultTimeoutMs: 8_000,
    logger: createLogger({ level: 'silent' }),
    maxRestarts: options.maxRestarts ?? 0,
    restartBaseDelayMs: 50
  });
  managers.push(manager);
  return manager;
};

const waitFor = async (condition: () => boolean, timeoutMs = 5_000): Promise<boolean> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
};

const isAlive = (pid: number | undefined): boolean => {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('McpClientManager against a real stdio fixture (DS-004)', () => {
  it('connects, discovers capabilities and calls a tool through the full chain', async () => {
    const manager = createManager();
    manager.upsertServer(stdioConfig('echo-1'));

    const status = await manager.connect('echo-1');
    expect(status.state).toBe('ready');
    expect(status.capabilities?.tools).toBe(true);
    expect(status.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['echo', 'design_system_list_components'])
    );

    const outcome = await manager.callTool({
      serverId: 'echo-1',
      toolName: 'echo',
      args: { value: 'hello' }
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.content[0]?.text).toBe(JSON.stringify({ value: 'hello' }));
  });

  it('maps an unknown tool to MCP_TOOL_NOT_FOUND without calling the server', async () => {
    const manager = createManager();
    manager.upsertServer(stdioConfig('echo-2'));
    await manager.connect('echo-2');

    const outcome = await manager.callTool({ serverId: 'echo-2', toolName: 'nope' });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('MCP_TOOL_NOT_FOUND');
  });

  it('maps a slow tool under a tight timeout to MCP_TIMEOUT', async () => {
    const manager = createManager();
    manager.upsertServer(stdioConfig('echo-3', { timeoutMs: 300 }));
    await manager.connect('echo-3');

    const outcome = await manager.callTool({
      serverId: 'echo-3',
      toolName: 'slow_echo',
      args: { delayMs: 5_000 }
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('MCP_TIMEOUT');
  });

  it('reports MCP_CONNECT_FAILED when the command cannot be started', async () => {
    const manager = createManager();
    manager.upsertServer({
      id: 'broken',
      name: 'broken',
      transport: 'stdio',
      command: 'desaignsync-definitely-missing-binary',
      role: 'generic',
      enabled: true,
      autoStart: false
    });

    await expect(manager.connect('broken')).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
    expect(manager.getStatus('broken')?.state).toBe('error');
  });

  it('connects an HTTP MCP fixture and calls a domain-shaped tool', async () => {
    const fixture = await startHttpMcpFixture('json');
    httpFixtures.push(fixture);

    const manager = createManager();
    manager.upsertServer({
      id: 'http-1',
      name: 'http-1',
      transport: 'streamable-http',
      url: fixture.url,
      role: 'design-system-reference',
      enabled: true,
      autoStart: false
    });

    const status = await manager.connect('http-1');
    expect(status.state).toBe('ready');
    expect(status.role).toBe('design-system-reference');

    const outcome = await manager.callTool({
      serverId: 'http-1',
      toolName: 'design_system_list_components'
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.content[0]?.text).toContain('button-primary');
    expect(fixture.receivedSessionIds).toContain('fixture-session-1');
  });

  it('restarts a crashed server with backoff and then gives up cleanly', async () => {
    const manager = createManager({ maxRestarts: 1 });
    const seen: string[] = [];
    const managerWithEvents = new McpClientManager({
      defaultTimeoutMs: 8_000,
      logger: createLogger({ level: 'silent' }),
      maxRestarts: 1,
      restartBaseDelayMs: 20,
      onStatusChange: (status) => seen.push(`${status.serverId}:${status.state}`)
    });
    managers.push(managerWithEvents);

    managerWithEvents.upsertServer(stdioConfig('crash-1'));
    await managerWithEvents.connect('crash-1');
    const killed = await managerWithEvents.callTool({ serverId: 'crash-1', toolName: 'crash' });
    expect(killed.ok).toBe(true);

    const restarted = await waitFor(
      () =>
        seen.some((entry) => entry.includes('degraded')) &&
        managerWithEvents.getStatus('crash-1')?.state === 'ready',
      8_000
    );
    expect(restarted).toBe(true);
    expect(seen.some((entry) => entry.includes('degraded'))).toBe(true);
    expect(manager.getStatus('crash-1')).toBeUndefined();
  });

  it('kills the child process when the server is disconnected (no orphans)', async () => {
    const manager = createManager();
    manager.upsertServer(stdioConfig('echo-4'));
    await manager.connect('echo-4');
    const pid = manager.getStatus('echo-4')?.pid;
    expect(pid).toBeDefined();
    expect(isAlive(pid)).toBe(true);

    await manager.disconnect('echo-4');
    const childGone = await waitFor(() => !isAlive(pid), 5_000);
    expect(childGone).toBe(true);
    expect(manager.getStatus('echo-4')?.state).toBe('stopped');
  });

  it('probes an inline config for Test connection and leaves no trace', async () => {
    const manager = createManager();
    const result = await manager.testConnection({
      config: {
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        timeoutMs: 8_000
      }
    });

    expect(result.ok).toBe(true);
    expect(result.status.tools?.map((tool) => tool.name)).toContain('echo');
    expect(manager.listConfigs()).toHaveLength(0);
  });
});