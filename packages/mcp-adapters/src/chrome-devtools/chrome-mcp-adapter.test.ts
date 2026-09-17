import { fileURLToPath } from 'node:url';
import type { JsonObject, McpToolCallOutcome } from '@desaignsync/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClientManager } from '@desaignsync/local-host';
import { createLogger } from '@desaignsync/local-host';
import { ChromeMCPAdapter } from './chrome-mcp-adapter.js';
import { createManagerGateway } from '../mcp-tool-gateway.js';

import { startAdapterHttpFixture, type StartedAdapterHttpFixture } from '../../../../tests/fixtures/adapterHttpFixture.js';
const chromeFixture = fileURLToPath(new URL('../../../../tests/fixtures/chrome-devtools-mcp-fixture.mjs', import.meta.url));
const managers: McpClientManager[] = [];
const httpFixtures: StartedAdapterHttpFixture[] = [];
afterEach(async () => {
  while (managers.length > 0) await managers.pop()?.dispose();
  while (httpFixtures.length > 0) await httpFixtures.pop()?.close();
});
const connectStdio = async (id: string): Promise<ChromeMCPAdapter> => {
  const manager = new McpClientManager({ defaultTimeoutMs: 8_000, logger: createLogger({ level: 'silent' }), maxRestarts: 0 });
  managers.push(manager);
  manager.upsertServer({ id, name: id, transport: 'stdio', command: process.execPath, args: [chromeFixture], role: 'inspection', enabled: true, autoStart: false });
  await manager.connect(id);
  return new ChromeMCPAdapter(createManagerGateway(manager, id));
};
const connectHttp = async (id: string): Promise<ChromeMCPAdapter> => {
  const fixture = await startAdapterHttpFixture('chrome');
  httpFixtures.push(fixture);
  const manager = new McpClientManager({ defaultTimeoutMs: 8_000, logger: createLogger({ level: 'silent' }), maxRestarts: 0 });
  managers.push(manager);
  manager.upsertServer({ id, name: id, transport: 'streamable-http', url: fixture.url, role: 'inspection', enabled: true, autoStart: false });
  await manager.connect(id);
  return new ChromeMCPAdapter(createManagerGateway(manager, id));
};
describe('ChromeMCPAdapter against real fixtures (DS-005)', () => {
  it.each([['stdio'], ['http']] as const)('runs the full inspection flow over %s', async (transport) => {
    const adapter = transport === 'stdio' ? await connectStdio(`chrome-${transport}`) : await connectHttp(`chrome-${transport}`);
    const report = adapter.capabilityReport();
    expect(report.supported).toEqual(expect.arrayContaining(['list_pages', 'select_page', 'take_snapshot', 'get_css_styles', 'evaluate_script', 'take_screenshot']));
    expect(report.unavailable).toEqual([]);
    expect(report.mapping['list_pages']).toBe('list_tabs');
    const pages = await adapter.listPages();
    expect(pages.map((p) => p.id)).toEqual(['tab-1', 'tab-2']);
    expect(pages[0]?.url).toBe('https://example.test/');
    const selected = await adapter.selectPage('tab-1');
    expect(selected).toMatchObject({ pageId: 'tab-1', toolName: 'activate_tab' });
    const snapshot = await adapter.takeSnapshot('tab-1');
    expect(snapshot.toolName).toBe('snapshot');
    expect(snapshot.text).toContain('Save');
    const css = await adapter.getCssStyles('node-1');
    expect(css.toolName).toBe('computed_styles');
    expect(css.styles['backgroundColor']).toBe('#0057b8');
    const evaluated = await adapter.evaluateScript('document.title');
    expect(evaluated.toolName).toBe('run_js');
    expect(evaluated.text).toContain('Fixture Home');
    const screenshot = await adapter.takeScreenshot({ fullPage: true });
    expect(screenshot.toolName).toBe('capture_screenshot');
    expect(screenshot.mimeType).toBe('image/png');
    expect(typeof screenshot.dataBase64).toBe('string');
  });
  it('degrades without inventing evidence when tools are missing', async () => {
    const calls: string[] = [];
    const adapter = new ChromeMCPAdapter({
      serverId: 'chrome-partial',
      listTools: () => [{ name: 'list_tabs' }],
      listToolNames: () => ['list_tabs'],
      findTool: (name: string) => (name === 'list_tabs' ? { name } : undefined),
      callTool: async (toolName: string, args?: JsonObject): Promise<McpToolCallOutcome> => {
        calls.push(toolName);
        return { serverId: 'chrome-partial', toolName, ok: true, isError: false,
          content: [{ type: 'text', text: JSON.stringify({ tabs: [{ id: 't' }], args }) }], durationMs: 1 };
      }
    });
    const report = adapter.capabilityReport();
    expect(report.supported).toEqual(['list_pages']);
    expect(report.unavailable).toEqual(expect.arrayContaining(['take_snapshot', 'take_screenshot']));
    await expect(adapter.takeSnapshot()).rejects.toMatchObject({ code: 'CHROME_MCP_UNAVAILABLE' });
    await expect(adapter.takeScreenshot()).rejects.toMatchObject({ code: 'CHROME_MCP_UNAVAILABLE' });
    expect(calls).toEqual([]);
  });
  it('honours explicit overrides and case/separator variants', async () => {
    const seen: Array<{ tool: string; args?: JsonObject }> = [];
    const adapter = new ChromeMCPAdapter(
      {
        serverId: 'chrome-custom',
        listTools: () => [{ name: 'List-Pages' }, { name: 'SNAPSHOT' }],
        listToolNames: () => ['List-Pages', 'SNAPSHOT'],
        findTool: (name: string) => ({ name }),
        callTool: async (toolName: string, args?: JsonObject): Promise<McpToolCallOutcome> => {
          seen.push({ tool: toolName, args });
          return { serverId: 'chrome-custom', toolName, ok: true, isError: false,
            content: [{ type: 'text', text: JSON.stringify({ pages: [{ id: 'p1', title: 'T', url: 'https://x.test' }] }) }], durationMs: 1 };
        }
      },
      { list_pages: 'List-Pages' }
    );
    expect(adapter.capabilityReport().mapping['list_pages']).toBe('List-Pages');
    expect(adapter.capabilityReport().mapping['take_snapshot']).toBe('SNAPSHOT');
    await adapter.listPages();
    expect(seen[0]?.tool).toBe('List-Pages');
  });
});
