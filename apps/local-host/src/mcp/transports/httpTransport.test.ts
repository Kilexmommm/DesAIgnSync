import { afterEach, describe, expect, it } from 'vitest';

import { startHttpMcpFixture, type StartedHttpMcpFixture } from '../../../../../tests/fixtures/mcpHttpFixture.js';
import { McpClient } from '../mcpClient.js';
import { StreamableHttpMcpTransport } from './httpTransport.js';

const fixtures: StartedHttpMcpFixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture) await fixture.close();
  }
});

const connectClient = async (
  mode: 'json' | 'sse'
): Promise<{ client: McpClient; transport: StreamableHttpMcpTransport }> => {
  const fixture = await startHttpMcpFixture(mode);
  fixtures.push(fixture);
  const transport = new StreamableHttpMcpTransport({ url: fixture.url, timeoutMs: 5_000 });
  const client = new McpClient({
    serverId: `http-fixture-${mode}`,
    transport,
    timeoutMs: 5_000,
    clientName: 'tests',
    clientVersion: '0.0.0'
  });
  await client.connect();
  return { client, transport };
};

describe('streamable HTTP transport against a real fixture MCP server', () => {
  it('completes the MCP handshake and discovers tools over plain JSON', async () => {
    const { client } = await connectClient('json');

    expect(client.state).toBe('ready');
    expect(client.protocolVersion).toBe('2025-06-18');
    expect(client.tools.map((tool) => tool.name)).toContain('echo');
  });

  it('calls tools and captures the session handshake', async () => {
    const { client, transport } = await connectClient('json');

    const result = await client.callTool('echo', { value: 'ping-http' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toBe(JSON.stringify({ value: 'ping-http' }));
    expect(transport.sessionId).toBe('fixture-session-1');

    await client.close();
  });

  it('parses tool results delivered as SSE streams', async () => {
    const { client } = await connectClient('sse');

    const result = await client.callTool('design_system_list_components');
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('button-primary');

    await client.close();
  });

  it('surfaces HTTP failures as transport errors', async () => {
    const transport = new StreamableHttpMcpTransport({ url: 'http://127.0.0.1:1/mcp', timeoutMs: 1_000 });
    const client = new McpClient({
      serverId: 'http-fixture-unreachable',
      transport,
      timeoutMs: 1_000,
      clientName: 'tests',
      clientVersion: '0.0.0'
    });

    await expect(client.connect()).rejects.toThrow();
  });
});