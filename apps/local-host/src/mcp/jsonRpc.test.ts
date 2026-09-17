import { describe, expect, it, vi } from 'vitest';

import {
  JSON_RPC_ERRORS,
  JsonRpcPeer,
  JsonRpcRemoteError,
  JsonRpcTimeoutError,
  type JsonRpcMessage,
  type JsonRpcNotification
} from './jsonRpc.js';

describe('JsonRpcPeer (MCP JSON-RPC 2.0)', () => {
  it('correlates responses with requests', async () => {
    const sent: JsonRpcMessage[] = [];
    const peer = new JsonRpcPeer({
      send: async (message) => {
        sent.push(message);
      },
      defaultTimeoutMs: 1_000
    });

    const pending = peer.request('tools/list', {});
    expect(sent).toHaveLength(1);
    const requestId = (sent[0] as { id: string | number }).id;

    peer.accept({ jsonrpc: '2.0', id: requestId, result: { tools: [] } });
    await expect(pending).resolves.toEqual({ tools: [] });
  });

  it('turns remote JSON-RPC errors into JsonRpcRemoteError', async () => {
    const sent: JsonRpcMessage[] = [];
    const peer = new JsonRpcPeer({
      send: async (message) => {
        sent.push(message);
      },
      defaultTimeoutMs: 1_000
    });

    const pending = peer.request('tools/call', {});
    const requestId = (sent[0] as { id: string | number }).id;
    peer.accept({
      jsonrpc: '2.0',
      id: requestId,
      error: { code: JSON_RPC_ERRORS.methodNotFound, message: 'Method not found' }
    });

    await expect(pending).rejects.toBeInstanceOf(JsonRpcRemoteError);
  });

  it('times out requests that never get a response', async () => {
    vi.useFakeTimers();
    try {
      const peer = new JsonRpcPeer({
        send: async () => undefined,
        defaultTimeoutMs: 50
      });
      const pending = peer.request('ping', {});
      const assertion = expect(pending).rejects.toBeInstanceOf(JsonRpcTimeoutError);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispatches notifications and answers unknown server requests with method-not-found', async () => {
    const sent: JsonRpcMessage[] = [];
    const seen: JsonRpcNotification[] = [];
    const peer = new JsonRpcPeer({
      send: async (message) => {
        sent.push(message);
      },
      defaultTimeoutMs: 1_000,
      onNotification: (notification) => {
        seen.push(notification);
      }
    });

    peer.accept({ jsonrpc: '2.0', method: 'notifications/progress' });
    expect(seen).toHaveLength(1);

    peer.accept({ jsonrpc: '2.0', id: 99, method: 'server/unknown' });
    await new Promise((resolve) => setImmediate(resolve));
    const answer = sent.find((message) => 'id' in message && message.id === 99);
    expect(answer).toMatchObject({ jsonrpc: '2.0', id: 99 });
    expect(answer).toHaveProperty(['error', 'code'], JSON_RPC_ERRORS.methodNotFound);
  });

  it('fails all in-flight requests when the transport closes', async () => {
    const peer = new JsonRpcPeer({
      send: async () => undefined,
      defaultTimeoutMs: 5_000
    });
    const first = peer.request('tools/list', {});
    const second = peer.request('tools/call', {});
    peer.fail(new Error('transport gone'));

    await expect(first).rejects.toThrow('transport gone');
    await expect(second).rejects.toThrow('transport gone');
    expect(peer.pendingCount).toBe(0);
  });
});