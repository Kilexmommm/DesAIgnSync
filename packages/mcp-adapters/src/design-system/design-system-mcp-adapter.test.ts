import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClientManager } from '@desaignsync/local-host';
import { createLogger } from '@desaignsync/local-host';
import { DesignSystemMCPAdapter } from './design-system-mcp-adapter.js';
import { createManagerGateway } from '../mcp-tool-gateway.js';
import { startAdapterHttpFixture, type StartedAdapterHttpFixture } from '../../../../tests/fixtures/adapterHttpFixture.js';
const dsFixture = fileURLToPath(new URL('../../../../tests/fixtures/design-system-mcp-fixture.mjs', import.meta.url));
const managers: McpClientManager[] = [];
const httpFixtures: StartedAdapterHttpFixture[] = [];
afterEach(async () => {
  while (managers.length > 0) await managers.pop()?.dispose();
  while (httpFixtures.length > 0) await httpFixtures.pop()?.close();
});
const connectStdio = async (id: string): Promise<DesignSystemMCPAdapter> => {
  const manager = new McpClientManager({ defaultTimeoutMs: 8_000, logger: createLogger({ level: 'silent' }), maxRestarts: 0 });
  managers.push(manager);
  manager.upsertServer({ id, name: id, transport: 'stdio', command: process.execPath, args: [dsFixture], role: 'design-system-reference', enabled: true, autoStart: false });
  await manager.connect(id);
  return new DesignSystemMCPAdapter(createManagerGateway(manager, id));
};
const connectHttp = async (id: string): Promise<DesignSystemMCPAdapter> => {
  const fixture = await startAdapterHttpFixture('design-system');
  httpFixtures.push(fixture);
  const manager = new McpClientManager({ defaultTimeoutMs: 8_000, logger: createLogger({ level: 'silent' }), maxRestarts: 0 });
  managers.push(manager);
  manager.upsertServer({ id, name: id, transport: 'streamable-http', url: fixture.url, role: 'design-system-reference', enabled: true, autoStart: false });
  await manager.connect(id);
  return new DesignSystemMCPAdapter(createManagerGateway(manager, id));
};
describe('DesignSystemMCPAdapter against real fixtures (DS-006)', () => {
  it.each([['stdio'], ['http']] as const)('covers the five §11.1 operations over %s', async (transport) => {
    const adapter = transport === 'stdio' ? await connectStdio(`ds-${transport}`) : await connectHttp(`ds-${transport}`);
    const report = adapter.capabilityReport();
    expect(report.supported).toEqual(['list_components', 'get_component', 'search_components', 'get_variant_reference', 'get_usage_guidelines']);
    expect(report.unavailable).toEqual([]);
    const components = await adapter.listComponents();
    expect(components.map((c) => c.id)).toEqual(expect.arrayContaining(['button', 'input']));
    expect(components[0]?.sourceMcp).toBe(`ds-${transport}`);
    const button = await adapter.getComponent('button');
    expect(button.componentName).toBe('Button');
    expect(button.referenceStyles?.backgroundColor).toBe('#0057b8');
    const searched = await adapter.searchComponents('button');
    expect(searched.length).toBeGreaterThan(0);
    const variant = await adapter.getVariantReference('button', 'Primary');
    expect(variant.variantName).toBeDefined();
    const guidelines = await adapter.getUsageGuidelines('button');
    expect(guidelines).toContain('primary action');
    const signature = adapter.toSignature(button);
    expect(signature.component).toBe('Button');
    expect(signature.providedFields).toEqual(expect.arrayContaining(['id', 'componentName', 'referenceStyles']));
    expect(signature.kind).toBe('observed');
  });
  it('reports partial capabilities instead of fabricating data', async () => {
    const adapter = new DesignSystemMCPAdapter({
      serverId: 'ds-partial',
      listTools: () => [{ name: 'list_components' }],
      listToolNames: () => ['list_components'],
      findTool: (name: string) => (name === 'list_components' ? { name } : undefined),
      callTool: async (toolName: string) => ({
        serverId: 'ds-partial', toolName, ok: true, isError: false,
        content: [{ type: 'text', text: JSON.stringify({ components: [] }) }], durationMs: 1
      })
    });
    const report = adapter.capabilityReport();
    expect(report.supported).toEqual(['list_components']);
    expect(report.unavailable).toEqual(expect.arrayContaining(['get_component', 'search_components']));
    await expect(adapter.getComponent('button')).rejects.toMatchObject({ code: 'DESIGN_SYSTEM_CAPABILITY_MISSING' });
  });
});

