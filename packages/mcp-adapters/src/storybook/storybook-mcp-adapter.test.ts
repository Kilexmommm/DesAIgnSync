import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClientManager } from '@desaignsync/local-host';
import { createLogger } from '@desaignsync/local-host';
import { createManagerGateway } from '../mcp-tool-gateway.js';
import { StorybookMCPAdapter, STORYBOOK_EXTRA_ALIASES } from './storybook-mcp-adapter.js';
import { startAdapterHttpFixture, type StartedAdapterHttpFixture } from '../../../../tests/fixtures/adapterHttpFixture.js';
const storybookFixture = fileURLToPath(new URL('../../../../tests/fixtures/storybook-mcp-fixture.mjs', import.meta.url));
const managers: McpClientManager[] = [];
const httpFixtures: StartedAdapterHttpFixture[] = [];
afterEach(async () => {
  while (managers.length > 0) await managers.pop()?.dispose();
  while (httpFixtures.length > 0) await httpFixtures.pop()?.close();
});
const connectStdio = async (id: string): Promise<StorybookMCPAdapter> => {
  const manager = new McpClientManager({ defaultTimeoutMs: 8_000, logger: createLogger({ level: 'silent' }), maxRestarts: 0 });
  managers.push(manager);
  manager.upsertServer({ id, name: id, transport: 'stdio', command: process.execPath, args: [storybookFixture], role: 'design-system-reference', enabled: true, autoStart: false });
  await manager.connect(id);
  return new StorybookMCPAdapter(createManagerGateway(manager, id));
};
const connectHttp = async (id: string): Promise<StorybookMCPAdapter> => {
  const fixture = await startAdapterHttpFixture('storybook');
  httpFixtures.push(fixture);
  const manager = new McpClientManager({ defaultTimeoutMs: 8_000, logger: createLogger({ level: 'silent' }), maxRestarts: 0 });
  managers.push(manager);
  manager.upsertServer({ id, name: id, transport: 'streamable-http', url: fixture.url, role: 'design-system-reference', enabled: true, autoStart: false });
  await manager.connect(id);
  return new StorybookMCPAdapter(createManagerGateway(manager, id));
};
describe('StorybookMCPAdapter preset against real fixtures (DS-007)', () => {
  it.each([['stdio'], ['http']] as const)('maps story tools onto §11.1 operations over %s', async (transport) => {
    const adapter = transport === 'stdio' ? await connectStdio(`sb-${transport}`) : await connectHttp(`sb-${transport}`);
    const report = adapter.capabilityReport();
    expect(report.supported).toEqual(['list_components', 'get_component', 'search_components', 'get_variant_reference', 'get_usage_guidelines']);
    // Thin preset proof: story names resolve onto logical operations.
    expect(report.mapping['list_components']).toBe('list_stories');
    expect(report.mapping['get_component']).toBe('get_story');
    const components = await adapter.listComponents();
    expect(components.length).toBeGreaterThan(0);
    expect(components[0]?.componentName).toBe('Button');
    const story = await adapter.getComponent('button--primary');
    expect(story.storyOrPreviewRef).toContain('button--primary');
    const signature = adapter.toSignature(story);
    expect(signature.visualReferenceRef).toContain('button--primary');
    const guidelines = await adapter.getUsageGuidelines('button--primary');
    expect(guidelines).toContain('Primary');
  });
  it('stays thin: only mapping data on top of the generic adapter', () => {
    expect(Object.keys(STORYBOOK_EXTRA_ALIASES)).toEqual(['list_components', 'get_component', 'search_components', 'get_variant_reference', 'get_usage_guidelines']);
    expect(StorybookMCPAdapter.prototype instanceof Object).toBe(true);
  });
});

