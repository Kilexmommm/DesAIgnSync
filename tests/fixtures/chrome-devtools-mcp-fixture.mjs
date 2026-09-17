#!/usr/bin/env node
/**
 * Fixture Chrome DevTools MCP over stdio (newline-delimited JSON-RPC 2.0).
 *
 * Real server process used by the ChromeMCPAdapter contract tests (DS-005).
 * It deliberately exposes NON-canonical tool names (list_tabs, activate_tab,
 * snapshot, computed_styles, run_js, capture_screenshot) so the tests prove the
 * adapter resolves logical operations tolerantly instead of hard-coding names.
 */

const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const tools = [
  { name: 'list_tabs', description: 'List open tabs/pages.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'activate_tab',
    description: 'Bring one tab to the foreground.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'] }
  },
  {
    name: 'snapshot',
    description: 'Accessibility snapshot of the active tab.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'string' } } }
  },
  {
    name: 'computed_styles',
    description: 'Computed CSS for one node.',
    inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }
  },
  {
    name: 'run_js',
    description: 'Evaluate a read-oriented JS snippet.',
    inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] }
  },
  {
    name: 'capture_screenshot',
    description: 'Screenshot of the viewport or one node.',
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string' }, fullPage: { type: 'boolean' } }
    }
  }
];

const TABS = [
  { id: 'tab-1', title: 'Fixture Home', url: 'https://example.test/' },
  { id: 'tab-2', title: 'Fixture Checkout', url: 'https://example.test/checkout' }
];

/**
 * Descriptor returned when a read-only evidence collector snippet is evaluated (DS-018).
 * Shaped exactly like `CollectedElementDescriptor` so the whole review chain can run
 * against fixtures without mocking anything.
 */
const ELEMENT_DESCRIPTOR = {
  tagName: 'button',
  role: 'button',
  accessibleName: 'Guardar',
  textHint: 'Guardar',
  attributes: { type: 'button' },
  classNames: ['btn', 'btn-primary'],
  ariaState: {},
  labelTexts: [],
  childSummary: [],
  computedStyles: {
    color: '#ffffff',
    backgroundColor: '#0057b8',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '20px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    height: '40px',
    width: '120px',
    padding: '12px 16px 12px 16px',
    margin: '0px 0px 0px 0px',
    display: 'inline-flex'
  },
  geometry: { x: 0, y: 0, width: 120, height: 40 },
  viewport: { width: 1280, height: 800 },
  disabled: false
};

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const respondError = (id, code, message, data) =>
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });

const handleRequest = async (request) => {
  switch (request.method) {
    case 'initialize':
      return respond(request.id, {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'desaignsync-fixture-chrome-devtools', version: '0.1.0' }
      });
    case 'ping':
      return respond(request.id, {});
    case 'tools/list':
      return respond(request.id, { tools });
    case 'tools/call': {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      if (!tools.some((tool) => tool.name === name)) {
        return respondError(request.id, -32602, `Unknown tool: ${String(name)}`);
      }
      if (name === 'list_tabs') {
        return respond(request.id, {
          content: [{ type: 'text', text: JSON.stringify({ tabs: TABS }) }],
          structuredContent: { tabs: TABS }
        });
      }
      if (name === 'activate_tab') {
        return respond(request.id, {
          content: [{ type: 'text', text: JSON.stringify({ activeTabId: args.tabId ?? null }) }],
          structuredContent: { activeTabId: args.tabId ?? null }
        });
      }
      if (name === 'snapshot') {
        const tabId = args.tabId ?? 'tab-1';
        const snapshot =
          `AX tree for ${tabId}:\n` +
          `- heading "Fixture Home"\n` +
          `- button "Save" [uid=1]\n` +
          `- textbox "Email" [uid=2]`;
        return respond(request.id, {
          content: [{ type: 'text', text: snapshot }],
          structuredContent: { tabId, snapshot }
        });
      }
      if (name === 'computed_styles') {
        const styles = {
          color: '#111111',
          backgroundColor: '#0057b8',
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 8
        };
        return respond(request.id, {
          content: [{ type: 'text', text: JSON.stringify({ nodeId: args.nodeId ?? null, styles }) }],
          structuredContent: { nodeId: args.nodeId ?? null, styles }
        });
      }
      if (name === 'run_js') {
        const script = String(args.script ?? '');
        if (script.includes('desaignsync:collect-element-evidence')) {
          return respond(request.id, {
            content: [{ type: 'text', text: JSON.stringify({ result: ELEMENT_DESCRIPTOR }) }],
            structuredContent: { result: ELEMENT_DESCRIPTOR }
          });
        }
        const result = script === 'document.title' ? 'Fixture Home' : `evaluated:${script}`;
        return respond(request.id, {
          content: [{ type: 'text', text: JSON.stringify({ result }) }],
          structuredContent: { result }
        });
      }
      // capture_screenshot
      return respond(request.id, {
        content: [
          { type: 'image', mimeType: 'image/png', data: ONE_PX_PNG_BASE64 },
          { type: 'text', text: 'screenshot captured' }
        ]
      });
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
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (message.method === 'notifications/initialized') continue;
    if (message.id === undefined) continue;
    void handleRequest(message);
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
