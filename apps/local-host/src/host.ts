import type { HostEvent, McpServerConfig, McpServerRuntimeStatus } from '@desaignsync/shared-types';

import {
  HOST_VERSION,
  loadHostConfig,
  type HostRuntimeConfig,
  type LoadHostConfigOptions
} from './config/hostConfig.js';
import { EventBus } from './http/eventBus.js';
import { createHostServer, type HostServer } from './http/server.js';
import { createLogger, type Logger } from './logging/logger.js';
import { McpClientManager } from './mcp/McpClientManager.js';
import { getDefaultMcpPresets } from './mcp/presets.js';
import { SessionStore } from './security/sessionStore.js';

export interface StartLocalHostOptions extends LoadHostConfigOptions {
  /** Servers to register before serving (Settings persistence arrives in DS-028). */
  servers?: McpServerConfig[];
  /** Connect every `autoStart` server after the API is up. Default: true. */
  connectAutoStart?: boolean;
  logger?: Logger;
}

export interface StartedHost {
  readonly server: HostServer;
  readonly mcp: McpClientManager;
  readonly sessions: SessionStore;
  readonly config: HostRuntimeConfig;
  readonly logger: Logger;
  readonly pairingCode: string;
  shutdown(): Promise<void>;
}

/**
 * Boots the Local MCP Host: loopback API + MCP client manager + session security (DS-003/DS-004).
 * Nothing here touches the inspected page directly; Chrome work happens through MCP (spec v2.1 §5).
 */
export async function startLocalHost(options: StartLocalHostOptions = {}): Promise<StartedHost> {
  const config = loadHostConfig(options);
  const logger =
    options.logger ??
    createLogger({ level: config.logLevel, bindings: { component: 'local-host', version: HOST_VERSION } });

  const sessions = new SessionStore({
    tokenTtlMs: config.tokenTtlMs,
    pairingWindowMs: config.pairingWindowMs,
    maxPairingAttempts: config.maxPairingAttempts
  });

  const events = new EventBus();

  const mcp = new McpClientManager({
    defaultTimeoutMs: config.defaultMcpTimeoutMs,
    logger: logger.child({ scope: 'mcp' }),
    onStatusChange: (status: McpServerRuntimeStatus) => {
      const event: HostEvent = {
        type: 'mcp.status',
        ts: new Date().toISOString(),
        payload: {
          serverId: status.serverId,
          state: status.state,
          ...(status.lastError ? { message: status.lastError.message } : {})
        }
      };
      events.publish(event);
    }
  });

  for (const preset of getDefaultMcpPresets()) {
    mcp.upsertServer(preset);
  }
  for (const server of options.servers ?? []) {
    mcp.upsertServer(server);
  }

  const server = await createHostServer({
    config,
    logger: logger.child({ scope: 'http' }),
    sessions,
    mcp,
    events
  });
  server.setLifecycle('ready');
  logger.info('DesAIgnSync Local Host ready', { version: HOST_VERSION, url: server.url });

  if (options.connectAutoStart !== false) {
    const results = await mcp.connectAutoStart();
    const failed = results.filter((status) => status.state === 'error');
    if (results.length > 0 && failed.length === results.length) {
      // Every server failed: the host still serves /health so the UI can explain the state.
      server.setLifecycle('degraded');
    }
  }

  return {
    server,
    mcp,
    sessions,
    config,
    logger,
    pairingCode: sessions.pairingCode,
    async shutdown(): Promise<void> {
      server.setLifecycle('shutting-down');
      await server.close();
      // Guarantees no orphaned MCP child processes after the host exits (DS-003).
      await mcp.dispose();
      logger.info('DesAIgnSync Local Host stopped');
    }
  };
}