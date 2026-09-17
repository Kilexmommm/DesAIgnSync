#!/usr/bin/env node
/** Fixture generic Design System MCP over stdio (DS-006). */
const COMPONENTS = [
  { id: 'button', componentName: 'Button', description: 'Primary action trigger.', roles: ['button'],
    props: { variant: { type: 'string' } }, usageGuidelines: 'Use Button for primary actions.',
    referenceStyles: { backgroundColor: '#0057b8', borderRadius: 8, height: 40, fontSize: 14, fontWeight: 600 } },
  { id: 'input', componentName: 'Input', description: 'Single-line text field.', roles: ['textbox'],
    props: { type: { type: 'string' } }, referenceStyles: { borderRadius: 6, height: 36 } }
];
const VARIANTS = { button: { Primary: { backgroundColor: '#0057b8', borderRadius: 8, height: 40 } } };
const tools = [
  { name: 'list_components', description: 'Inventory.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_component', description: 'Details.', inputSchema: { type: 'object', properties: { componentId: { type: 'string' } } } },
  { name: 'search_components', description: 'Search.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'get_variant_reference', description: 'Variant ref.', inputSchema: { type: 'object', properties: { componentId: { type: 'string' }, variant: { type: 'string' } } } },
  { name: 'get_usage_guidelines', description: 'Guidelines.', inputSchema: { type: 'object', properties: { componentId: { type: 'string' } } } }
];
const send = (m) => { process.stdout.write(`${JSON.stringify(m)}\n`); };
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const respondError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const findComponent = (id) => COMPONENTS.find((e) => e.id === id);
const handleRequest = async (request) => {
  switch (request.method) {
    case 'initialize':
      return respond(request.id, { protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'desaignsync-fixture-design-system', version: '0.1.0' } });
    case 'ping':
      return respond(request.id, {});
    case 'tools/list':
      return respond(request.id, { tools });
    case 'tools/call': {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      if (!tools.some((t) => t.name === name)) return respondError(request.id, -32602, `Unknown tool: ${String(name)}`);
      if (name === 'list_components') return respond(request.id, {
        content: [{ type: 'text', text: JSON.stringify({ components: COMPONENTS }) }], structuredContent: { components: COMPONENTS } });
      if (name === 'get_component') {
        const c = findComponent(args.componentId);
        if (!c) return respondError(request.id, -32602, `Unknown component: ${String(args.componentId)}`);
        return respond(request.id, { content: [{ type: 'text', text: JSON.stringify({ component: c }) }], structuredContent: { component: c } });
      }
      if (name === 'search_components') {
        const q = String(args.query ?? '').toLowerCase();
        const matches = COMPONENTS.filter((e) => `${e.componentName} ${e.description ?? ''}`.toLowerCase().includes(q));
        return respond(request.id, { content: [{ type: 'text', text: JSON.stringify({ components: matches }) }], structuredContent: { components: matches } });
      }
      if (name === 'get_variant_reference') {
        const c = findComponent(args.componentId);
        if (!c) return respondError(request.id, -32602, `Unknown component: ${String(args.componentId)}`);
        const variant = typeof args.variant === 'string' ? args.variant : 'Primary';
        const ref = { id: `${c.id}-${variant.toLowerCase()}`, componentName: c.componentName, variantName: variant,
          roles: c.roles, props: c.props, referenceStyles: VARIANTS[c.id]?.[variant] ?? c.referenceStyles,
          storyOrPreviewRef: `storybook://${c.id}--${variant.toLowerCase()}` };
        return respond(request.id, { content: [{ type: 'text', text: JSON.stringify(ref) }], structuredContent: ref });
      }
      const c = findComponent(args.componentId);
      if (!c) return respondError(request.id, -32602, `Unknown component: ${String(args.componentId)}`);
      return respond(request.id, { content: [{ type: 'text', text: JSON.stringify({ usageGuidelines: c.usageGuidelines ?? '' }) }],
        structuredContent: { usageGuidelines: c.usageGuidelines ?? '' } });
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
