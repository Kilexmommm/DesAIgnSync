import { createServer } from 'node:http';
export const startHttpMcpFixture = (mode = 'json') => new Promise((resolve, reject) => {
    const receivedSessionIds = [];
    const echoTools = [
        { name: 'echo', description: 'Echo arguments back as text.', inputSchema: { type: 'object' } },
        {
            name: 'design_system_list_components',
            description: 'Return a minimal component inventory.',
            inputSchema: { type: 'object' }
        }
    ];
    const answer = (request) => {
        switch (request['method']) {
            case 'initialize':
                return {
                    protocolVersion: request['params']?.['protocolVersion'] ?? '2025-06-18',
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'desaignsync-fixture-http', version: '0.1.0' }
                };
            case 'ping':
            case 'tools/list':
                return request['method'] === 'tools/list' ? { tools: echoTools } : {};
            case 'tools/call': {
                const params = (request['params'] ?? {});
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
    const server = createServer((req, res) => {
        if (req.method !== 'POST') {
            res.writeHead(405).end();
            return;
        }
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            let parsed;
            try {
                parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            catch {
                res.writeHead(400).end('not json');
                return;
            }
            const sessionId = req.headers['mcp-session-id'];
            if (typeof sessionId === 'string')
                receivedSessionIds.push(sessionId);
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
            close: () => new Promise((done) => {
                server.close(() => done());
            })
        });
    });
});
const maybeErrorOrResult = (payload) => {
    if ('error' in payload)
        return { error: payload['error'] };
    return { result: payload };
};
const toSse = (body) => `event: message\ndata: ${JSON.stringify(body)}\n\n`;
//# sourceMappingURL=mcpHttpFixture.js.map