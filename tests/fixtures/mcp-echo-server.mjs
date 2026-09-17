#!/usr/bin/env node
/**
 * Fixture MCP server over stdio (newline-delimited JSON-RPC 2.0).
 *
 * Used by contract tests and local development. It is a real server process, not a mock:
 * the same code path used against `chrome-devtools-mcp` or a Design System MCP is exercised.
 *
 * Tools:
 *   echo            - returns its arguments as text
 *   slow_echo       - waits `delayMs` before answering (used for timeout tests)
 *   crash           - exits the process (used for restart policy tests)
 *   design_system_list_components - tiny Design System shaped payload for adapter work
 */

const tools = [
  {
    name: 'echo',
    description: 'Echo the provided arguments back as text.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
  },
  {
    name: 'slow_echo',
    description: 'Echo after a delay, to exercise request timeouts.',
    inputSchema: { type: 'object', properties: { delayMs: { type: 'number' } } }
  },
  {
    name: 'crash',
    description: 'Terminate the server process immediately.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'design_system_list_components',
    description: 'Return a minimal Design System component inventory.',
    inputSchema: { type: 'object', properties: {} }
  }
];

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
        capabilities: { tools: { listChanged: false }, resources: {} },
        serverInfo: { name: 'desaignsync-fixture-mcp', version: '0.1.0' }
      });
    case 'ping':
      return respond(request.id, {});
    case 'tools/list':
      return respond(request.id, { tools });
    case 'resources/list':
      return respond(request.id, {
        resources: [
          { uri: 'fixture://design-system/button', name: 'Button', mimeType: 'application/json' }
        ]
      });
    case 'tools/call': {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      if (!tools.some((tool) => tool.name === name)) {
        return respondError(request.id, -32602, `Unknown tool: ${String(name)}`);
      }
      if (name === 'crash') {
        setTimeout(() => process.exit(3), 10);
        return respond(request.id, { content: [{ type: 'text', text: 'crashing' }] });
      }
      if (name === 'slow_echo') {
        const delayMs = Number(args.delayMs ?? 5000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return respond(request.id, { content: [{ type: 'text', text: `slow:${delayMs}` }] });
      }
      if (name === 'design_system_list_components') {
        return respond(request.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                components: [
                  {
                    id: 'button-primary',
                    componentName: 'Button',
                    variantName: 'Primary',
                    referenceStyles: { backgroundColor: '#0057b8', borderRadius: 8, height: 40 }
                  },
                  {
                    id: 'button-secondary',
                    componentName: 'Button',
                    variantName: 'Secondary',
                    referenceStyles: { backgroundColor: 'transparent', borderRadius: 8, height: 40 }
                  }
                ]
              })
            }
          ]
        });
      }
      return respond(request.id, {
        content: [{ type: 'text', text: JSON.stringify(args) }]
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