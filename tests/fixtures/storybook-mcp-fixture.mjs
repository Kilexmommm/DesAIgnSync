#!/usr/bin/env node
/** Fixture Storybook MCP over stdio (DS-007): story-shaped names only. */
const STORIES = [
  { id: 'button--primary', componentName: 'Button', name: 'Primary', title: 'Button / Primary',
    description: 'Primary button story.', args: { variant: 'primary' },
    usageGuidelines: 'Use Primary for the main action.',
    referenceStyles: { backgroundColor: '#0057b8', borderRadius: 8 } },
  { id: 'button--secondary', componentName: 'Button', name: 'Secondary', title: 'Button / Secondary',
    args: { variant: 'secondary' }, referenceStyles: { backgroundColor: 'transparent', borderRadius: 8 } }
];
const tools = [
  { name: 'list_stories', description: 'Story index.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_story', description: 'One story.', inputSchema: { type: 'object', properties: { storyId: { type: 'string' } } } },
  { name: 'search_stories', description: 'Search stories.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'get_story_reference', description: 'Variant ref.', inputSchema: { type: 'object', properties: { storyId: { type: 'string' } } } },
  { name: 'get_story_docs', description: 'Docs.', inputSchema: { type: 'object', properties: { storyId: { type: 'string' } } } }
];
const send = (m) => { process.stdout.write(`${JSON.stringify(m)}\n`); };
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const respondError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const findStory = (id) => STORIES.find((s) => s.id === id);
const toComponent = (s) => ({ id: s.id, componentName: s.componentName, variantName: s.name, description: s.description,
  usageGuidelines: s.usageGuidelines, props: s.args, referenceStyles: s.referenceStyles, storyOrPreviewRef: `storybook://${s.id}` });
const handleRequest = async (request) => {
  switch (request.method) {
    case 'initialize':
      return respond(request.id, { protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'desaignsync-fixture-storybook', version: '0.1.0' } });
    case 'ping':
      return respond(request.id, {});
    case 'tools/list':
      return respond(request.id, { tools });
    case 'tools/call': {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      if (!tools.some((t) => t.name === name)) return respondError(request.id, -32602, `Unknown tool: ${String(name)}`);
      if (name === 'list_stories') return respond(request.id, {
        content: [{ type: 'text', text: JSON.stringify({ stories: STORIES }) }], structuredContent: { stories: STORIES } });
      if (name === 'get_story' || name === 'get_story_reference') {
        const id = args.storyId ?? args.componentId ?? args.id;
        const s = findStory(id);
        if (!s) return respondError(request.id, -32602, `Unknown story: ${String(id)}`);
        const c = toComponent(s);
        return respond(request.id, { content: [{ type: 'text', text: JSON.stringify(c) }], structuredContent: c });
      }
      if (name === 'search_stories') {
        const q = String(args.query ?? args.text ?? '').toLowerCase();
        const matches = STORIES.filter((s) => `${s.componentName} ${s.name}`.toLowerCase().includes(q)).map(toComponent);
        return respond(request.id, { content: [{ type: 'text', text: JSON.stringify({ components: matches }) }], structuredContent: { components: matches } });
      }
      const s = findStory(args.storyId ?? args.componentId ?? args.id);
      if (!s) return respondError(request.id, -32602, `Unknown story: ${String(args.storyId)}`);
      return respond(request.id, { content: [{ type: 'text', text: JSON.stringify({ usageGuidelines: s.usageGuidelines ?? '' }) }],
        structuredContent: { usageGuidelines: s.usageGuidelines ?? '' } });
    }
    default:
      return respondError(request.id, -32601, `Method not found: ${request.method}`);
  }
};
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    newlineIndex = buffer.indexOf('\n');
    if (line === '') continue;
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (message.method === 'notifications/initialized') continue;
    if (message.id === undefined) continue;
    void handleRequest(message);
  }
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
