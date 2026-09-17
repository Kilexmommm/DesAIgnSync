import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Fixture MCP server over HTTP.
 *
 * Speaks the smallest useful subset of streamable HTTP: it accepts JSON-RPC 2.0 POSTs and
 * answers either as plain JSON or as an SSE stream (`mode: 'sse'`). It echoes the echo-fixture
 * tools of mcp-echo-server.mjs and stores the Mcp-Session-Id handshake so transports can be
 * tested against a real server process.
 */
export interface StartedHttpMcpFixture {
  url: string;
  receivedSessionIds: string[];
  mode: 'json' | 'sse';
  close(): Promise<void>;
}

export const startHttpMcpFixture = (
  mode: 'json' | 'sse' = 'json'
): Promise<StartedHttpMcpFixture> =>
  new Promise((resolve, reject) => {
    const receivedSessionIds: string[] = [];
    const echoTools = [
      { name: 'echo', description: 'Echo arguments back as text.', inputSchema: { type: 'object' } },
      {
        name: 'design_system_list_components',
        description: 'Return a minimal component inventory.',
        inputSchema: { type: 'object' }
      }
    ];

    const answer = (request: Record<string, unknown>): Record<string, unknown> => {
      switch (request['method']) {
        case 'initialize':
          return {
            protocolVersion:
              (request['params'] as Record<string, unknown> | undefined)?.['protocolVersion'] ?? '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'desaignsync-fixture-http', version: '0.1.0' }
          };
        case 'ping':
        case 'tools/list':
          return request['method'] === 'tools/list' ? { tools: echoTools } : {};
        case 'tools/call': {
          const params = (request['params'] ?? {}) as Record<string, unknown>;
          const name = params['name'];
          if (name === 'echo') {
            return { content: [{ type: 'text', text: JSON.stringify(params['arguments'] ?? {}) }] };
          }
          if (name === 'design_system_list_components') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ components: [{ id: 'button-primary', componentName: 'Button' }] })
                }
              ]
            };
          }
          return { content: [{ type: 'text', text: 'unknown' }], isError: true };
        }
        default:
          return { error: { code: -32601, message: `Method not found: ${String(request['method'])}` } };
      }
    };

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        let parsed: { id?: unknown; method?: unknown };
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400).end('not json');
          return;
        }
        const sessionId = req.headers['mcp-session-id'];
        if (typeof sessionId === 'string') receivedSessionIds.push(sessionId);

        // JSON-RPC notifications get 202 Accepted with no body.
        if (parsed.id === undefined) {
          res.writeHead(202).end();
          return;
        }

        const body = { jsonrpc: '2.0', id: parsed.id, ...(maybeErrorOrResult(answer(parsed))) };
        const envelope = mode === 'sse' ? toSse(body) : JSON.stringify(body);
        res.writeHead(200, {
          'content-type': mode === 'sse' ? 'text/event-stream' : 'application/json',
          'mcp-session-id': 'fixture-session-1'
        });
        res.end(envelope);
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Fixture MCP HTTP server did not bind.'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        receivedSessionIds,
        mode,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          })
      });
    });
  });

const maybeErrorOrResult = (
  payload: Record<string, unknown>
): { result: unknown } | { error: unknown } => {
  if ('error' in payload) return { error: payload['error'] };
  return { result: payload };
};

const toSse = (body: unknown): string => `event: message\ndata: ${JSON.stringify(body)}\n\n`;