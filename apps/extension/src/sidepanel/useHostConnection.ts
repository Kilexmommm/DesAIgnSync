import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HostEvent, McpServerRuntimeStatus } from '@desaignsync/shared-types';

import { HostRequestError, LocalHostClient } from '../bridge/LocalHostClient.js';
import {
  getHostUrl,
  getSessionToken,
  setHostUrl,
  setSessionToken
} from '../bridge/extensionStorage.js';

export type HostConnectionState = 'checking' | 'offline' | 'pairing-required' | 'connected';

export interface HostConnectionSnapshot {
  state: HostConnectionState;
  hostUrl: string;
  hostVersion?: string;
  apiVersion?: string;
  pairingOpen: boolean;
  servers: McpServerRuntimeStatus[];
  message?: string;
}

const HEALTH_POLL_MS = 5_000;

/**
 * Owns everything the Side Panel knows about the Local Host connection:
 * health detection, pairing, server list and live MCP status events.
 */
export function useHostConnection(): {
  snapshot: HostConnectionSnapshot;
  busy: boolean;
  updateHostUrl: (url: string) => Promise<void>;
  pair: (pairingCode: string) => Promise<void>;
  refresh: () => Promise<void>;
  unpair: () => Promise<void>;
  testServer: (serverId: string) => Promise<McpServerRuntimeStatus | undefined>;
} {
  const [hostUrl, setHostUrlState] = useState<string>('');
  const [snapshot, setSnapshot] = useState<HostConnectionSnapshot>({
    state: 'checking',
    hostUrl: '',
    pairingOpen: false,
    servers: []
  });
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<LocalHostClient | undefined>(undefined);

  const buildClient = useCallback(async (explicitUrl?: string): Promise<LocalHostClient> => {
    const url = explicitUrl ?? (await getHostUrl());
    const token = await getSessionToken();
    const client = new LocalHostClient({ baseUrl: url, token });
    clientRef.current = client;
    return client;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const client = clientRef.current ?? (await buildClient());
    try {
      const health = await client.health();
      const base = {
        hostUrl: client.baseUrl,
        hostVersion: health.hostVersion,
        apiVersion: health.apiVersion,
        pairingOpen: health.pairingOpen
      };
      if (!client.token) {
        setSnapshot({ ...base, state: 'pairing-required', servers: [] });
        return;
      }
      const [info, servers] = await Promise.all([client.info(), client.servers()]);
      setSnapshot({
        ...base,
        state: 'connected',
        servers: servers.servers.length > 0 ? servers.servers : info.servers
      });
    } catch (error) {
      const message =
        error instanceof HostRequestError
          ? error.message
          : 'Unexpected error contacting the Local Host.';
      // An expired/revoked token surfaces as UNAUTHORIZED on info()/servers():
      // fall back to pairing instead of reporting the host as offline.
      if (error instanceof HostRequestError && error.code === 'UNAUTHORIZED') {
        await setSessionToken(undefined);
        client.setToken(undefined);
        setSnapshot({
          hostUrl: client.baseUrl,
          state: 'pairing-required',
          pairingOpen: false,
          servers: [],
          message
        });
        return;
      }
      setSnapshot({
        hostUrl: client.baseUrl,
        state: 'offline',
        pairingOpen: false,
        servers: [],
        message
      });
    }
  }, [buildClient]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const url = await getHostUrl();
      if (!mounted) return;
      setHostUrlState(url);
      await buildClient(url);
      await refresh();
    })();
    const timer = setInterval(() => {
      if (mounted) void refresh();
    }, HEALTH_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [buildClient, refresh]);

  // Live MCP status: keeps the server list fresh without polling the host.
  useEffect(() => {
    const client = clientRef.current;
    if (!client?.token || snapshot.state !== 'connected') return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = client.subscribeEvents((event: HostEvent) => {
        if (event.type !== 'mcp.status') return;
        setSnapshot((current) => ({
          ...current,
          servers: current.servers.map((server) =>
            server.serverId === event.payload.serverId
              ? { ...server, state: event.payload.state as McpServerRuntimeStatus['state'] }
              : server
          )
        }));
      });
    } catch {
      // No token yet: the polling refresh will catch up.
    }
    return () => unsubscribe?.();
  }, [snapshot.state]);

  const pair = useCallback(
    async (pairingCode: string): Promise<void> => {
      setBusy(true);
      try {
        const client = clientRef.current ?? (await buildClient());
        const result = await client.pair(pairingCode, {
          clientName: 'DesAIgnSync Side Panel',
          extensionId: chrome.runtime?.id
        });
        await setSessionToken(result.token);
        client.setToken(result.token);
        await refresh();
        setHostUrlState(client.baseUrl);
      } finally {
        setBusy(false);
      }
    },
    [buildClient, refresh]
  );

  const unpair = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client?.token) {
      await client.revokeSession().catch(() => undefined);
    }
    await setSessionToken(undefined);
    client?.setToken(undefined);
    await refresh();
  }, [refresh]);

  const updateHostUrl = useCallback(
    async (url: string): Promise<void> => {
      await setHostUrl(url);
      await buildClient(url);
      setHostUrlState(url);
      await refresh();
    },
    [buildClient, refresh]
  );

  const testServer = useCallback(
    async (serverId: string): Promise<McpServerRuntimeStatus | undefined> => {
      const client = clientRef.current;
      if (!client) return undefined;
      setBusy(true);
      try {
        const result = await client.testServer({ serverId });
        await refresh();
        return result.status;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  return useMemo(
    () => ({
      snapshot: { ...snapshot, hostUrl: snapshot.hostUrl || hostUrl },
      busy,
      updateHostUrl,
      pair,
      refresh,
      unpair,
      testServer
    }),
    [snapshot, hostUrl, busy, updateHostUrl, pair, refresh, unpair, testServer]
  );
}