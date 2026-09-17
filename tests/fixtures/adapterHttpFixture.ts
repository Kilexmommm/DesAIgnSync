import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
/** Adapter HTTP fixtures (DS-005/DS-006/DS-007): same shapes as the stdio fixtures. */
export type AdapterHttpFixtureKind = 'chrome' | 'design-system' | 'storybook';
export interface StartedAdapterHttpFixture {
  url: string; kind: AdapterHttpFixtureKind; receivedSessionIds: string[]; close(): Promise<void>;
}
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CHROME_TABS = [
  { id: 'tab-1', title: 'Fixture Home', url: 'https://example.test/' },
  { id: 'tab-2', title: 'Fixture Checkout', url: 'https://example.test/checkout' }
];
const DS_COMPONENTS = [
  { id: 'button', componentName: 'Button', description: 'Primary action trigger.', roles: ['button'],
    usageGuidelines: 'Use Button for primary actions.', referenceStyles: { backgroundColor: '#0057b8', borderRadius: 8, height: 40 } },
  { id: 'input', componentName: 'Input', description: 'Single-line text field.', roles: ['textbox'], referenceStyles: { borderRadius: 6, height: 36 } }
];
type ToolDef = { name: string; description: string; inputSchema: { type: string } };
const TOOLS: Record<AdapterHttpFixtureKind, ToolDef[]> = {
  chrome: [
    { name: 'list_tabs', description: 'List tabs.', inputSchema: { type: 'object' } },
    { name: 'activate_tab', description: 'Select tab.', inputSchema: { type: 'object' } },
    { name: 'snapshot', description: 'Snapshot.', inputSchema: { type: 'object' } },
    { name: 'computed_styles', description: 'CSS.', inputSchema: { type: 'object' } },
    { name: 'run_js', description: 'Evaluate.', inputSchema: { type: 'object' } },
    { name: 'capture_screenshot', description: 'Screenshot.', inputSchema: { type: 'object' } }
  ],
  'design-system': [
    { name: 'list_components', description: 'Inventory.', inputSchema: { type: 'object' } },
    { name: 'get_component', description: 'Details.', inputSchema: { type: 'object' } },
    { name: 'search_components', description: 'Search.', inputSchema: { type: 'object' } },
    { name: 'get_variant_reference', description: 'Variant.', inputSchema: { type: 'object' } },
    { name: 'get_usage_guidelines', description: 'Guidelines.', inputSchema: { type: 'object' } }
  ],
  storybook: [
    { name: 'list_stories', description: 'Index.', inputSchema: { type: 'object' } },
    { name: 'get_story', description: 'Story.', inputSchema: { type: 'object' } },
    { name: 'search_stories', description: 'Search.', inputSchema: { type: 'object' } },
    { name: 'get_story_reference', description: 'Ref.', inputSchema: { type: 'object' } },
    { name: 'get_story_docs', description: 'Docs.', inputSchema: { type: 'object' } }
  ]
};
const textResult = (payload: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload });

const answerChromeTool = (name: unknown, args: Record<string, unknown>): Record<string, unknown> => {
  switch (name) {
    case 'list_tabs': return textResult({ tabs: CHROME_TABS });
    case 'activate_tab': return { content: [{ type: 'text', text: `active:${String(args['tabId'] ?? '')}` }] };
    case 'snapshot': return { content: [{ type: 'text', text: 'AX tree:\n- button "Save" [uid=1]' }], structuredContent: { tabId: args['tabId'] ?? 'tab-1', snapshot: 'AX tree' } };
    case 'computed_styles': return textResult({ nodeId: args['nodeId'] ?? null, styles: { backgroundColor: '#0057b8', fontSize: 14 } });
    case 'run_js': return textResult({ result: 'Fixture Home' });
    case 'capture_screenshot': return { content: [{ type: 'image', mimeType: 'image/png', data: PNG_1PX }] };
    default: return { content: [{ type: 'text', text: 'unknown' }], isError: true };
  }
};
const answerDsTool = (storybook: boolean, name: unknown, args: Record<string, unknown>): Record<string, unknown> => {
  if (name === (storybook ? 'list_stories' : 'list_components')) {
    return textResult(storybook ? { stories: [{ id: 'button--primary', componentName: 'Button', name: 'Primary' }] } : { components: DS_COMPONENTS });
  }
  if (name === (storybook ? 'get_story' : 'get_component')) {
    const id = args['storyId'] ?? args['componentId'] ?? args['id'];
    const payload = storybook
      ? { id, componentName: 'Button', variantName: 'Primary', referenceStyles: { backgroundColor: '#0057b8' }, storyOrPreviewRef: `storybook://${String(id)}` }
      : (DS_COMPONENTS.find((c) => c.id === id) ?? { id, componentName: 'Unknown' });
    return textResult(payload);
  }
  if (name === (storybook ? 'search_stories' : 'search_components')) return textResult({ components: DS_COMPONENTS.slice(0, 1) });
  if (name === (storybook ? 'get_story_reference' : 'get_variant_reference')) {
    return textResult({ id: 'button-primary', componentName: 'Button', variantName: 'Primary' });
  }
  if (name === (storybook ? 'get_story_docs' : 'get_usage_guidelines')) {
    return textResult({ usageGuidelines: storybook ? 'Use Button / Primary for primary actions.' : 'Use Button for primary actions.' });
  }
  return { content: [{ type: 'text', text: 'unknown' }], isError: true };
};
const answer = (kind: AdapterHttpFixtureKind, request: Record<string, unknown>): Record<string, unknown> => {
  switch (request['method']) {
    case 'initialize': return { protocolVersion: (request['params'] as Record<string, unknown> | undefined)?.['protocolVersion'] ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } }, serverInfo: { name: `desaignsync-fixture-${kind}-http`, version: '0.1.0' } };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS[kind] };
    case 'tools/call': {
      const params = (request['params'] ?? {}) as Record<string, unknown>;
      return kind === 'chrome'
        ? answerChromeTool(params['name'], (params['arguments'] ?? {}) as Record<string, unknown>)
        : answerDsTool(kind === 'storybook', params['name'], (params['arguments'] ?? {}) as Record<string, unknown>);
    }
    default: return { error: { code: -32601, message: `Method not found: ${String(request['method'])}` } };
  }
};
export const startAdapterHttpFixture = (kind: AdapterHttpFixtureKind): Promise<StartedAdapterHttpFixture> =>
  new Promise((resolve, reject) => {
    const receivedSessionIds: string[] = [];
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        let parsed: { id?: unknown; method?: unknown };
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end('not json'); return; }
        const sessionId = req.headers['mcp-session-id'];
        if (typeof sessionId === 'string') receivedSessionIds.push(sessionId);
        if (parsed.id === undefined) { res.writeHead(202).end(); return; }
        const payload = answer(kind, parsed);
        const body = 'error' in payload ? { jsonrpc: '2.0', id: parsed.id, error: payload['error'] } : { jsonrpc: '2.0', id: parsed.id, result: payload };
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session-1' });
        res.end(JSON.stringify(body));
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') { reject(new Error('Adapter HTTP fixture did not bind.')); return; }
      resolve({ url: `http://127.0.0.1:${address.port}/mcp`, kind, receivedSessionIds,
        close: () => new Promise<void>((done) => { server.close(() => done()); }) });
    });
  });
