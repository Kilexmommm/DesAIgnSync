import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startLocalHost, type StartedHost } from '../host.js';

const hosts: StartedHost[] = [];

afterEach(async () => {
  while (hosts.length > 0) {
    await hosts.pop()?.shutdown();
  }
});

const startHost = async (): Promise<StartedHost> => {
  const host = await startLocalHost({
    env: {
      DESAIGNSYNC_HOME: mkdtempSync(join(tmpdir(), 'desaignsync-recovery-')),
      DESAIGNSYNC_LOG_LEVEL: 'silent',
      DESAIGNSYNC_SECRET_BACKEND: 'file'
    },
    overrides: { port: 0 },
    connectAutoStart: false,
    onPairingCode: () => undefined
  });
  hosts.push(host);
  return host;
};

const pair = async (host: StartedHost): Promise<string> => {
  const response = await fetch(`${host.server.url}/session/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingCode: host.sessions.pairingCode })
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
};

describe('session recovery (DS-003: a lost token must not require a host restart)', () => {
  it('reopens the pairing window when an invalid token is used and accepts the new code', async () => {
    const host = await startHost();
    const firstToken = await pair(host);
    const authorized = await fetch(`${host.server.url}/info`, {
      headers: { authorization: `Bearer ${firstToken}` }
    });
    expect(authorized.status).toBe(200);
    expect(host.sessions.isPairingOpen()).toBe(false);

    // The panel lost the token (browser restart / extension reload) and now sends a stale one.
    const stale = await fetch(`${host.server.url}/info`, {
      headers: { authorization: 'Bearer stale-token' }
    });
    expect(stale.status).toBe(401);
    const staleBody = (await stale.json()) as { error: { code: string; message: string } };
    expect(staleBody.error.code).toBe('UNAUTHORIZED');
    expect(staleBody.error.message).toContain('pairing code');

    // /health now tells the Side Panel to show the pairing form again.
    const health = (await (await fetch(`${host.server.url}/health`)).json()) as {
      pairingOpen: boolean;
    };
    expect(health.pairingOpen).toBe(true);

    // Pairing with the new code (printed by the host terminal) works without restarting the host.
    const secondToken = await pair(host);
    const authorizedAgain = await fetch(`${host.server.url}/info`, {
      headers: { authorization: `Bearer ${secondToken}` }
    });
    expect(authorizedAgain.status).toBe(200);
    expect(host.sessions.isPairingOpen()).toBe(false);
  });

  it('does not touch the pairing window while the session is valid', async () => {
    const host = await startHost();
    const token = await pair(host);
    await fetch(`${host.server.url}/info`, { headers: { authorization: `Bearer ${token}` } });
    expect(host.sessions.isPairingOpen()).toBe(false);
  });
});
