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
export declare const startHttpMcpFixture: (mode?: "json" | "sse") => Promise<StartedHttpMcpFixture>;
//# sourceMappingURL=mcpHttpFixture.d.ts.map