import type { HostEvent, McpServerConfig, McpServerRuntimeStatus } from '@desaignsync/shared-types';

import {
  HOST_VERSION,
  loadHostConfig,
  type HostRuntimeConfig,
  type LoadHostConfigOptions
} from './config/hostConfig.js';
import { EventBus } from './http/eventBus.js';
import { createHostServer, type HostServer } from './http/server.js';
import { ConfigStore } from './config/configStore.js';
import { createSecretStore, type SecretStore } from './security/secretStoreFactory.js';
import { LlmProviderRegistry } from './llm/providerRegistry.js';
import { ProfileRegistry } from './review/profileRegistry.js';
import { ReviewOrchestrator } from './review/reviewOrchestrator.js';
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
  readonly secrets: SecretStore;
  readonly providers: LlmProviderRegistry;
  readonly profiles: ProfileRegistry;
  readonly review: ReviewOrchestrator;
  readonly configStore: ConfigStore;
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

  // Settings persistence (DS-028). Secrets never reach this file, only their references.
  const configStore = new ConfigStore({
    configPath: config.configPath,
    logger: logger.child({ scope: 'config' })
  });
  const persisted = configStore.read();

  // OS credential store (or documented fallback): API keys and MCP env secrets (DS-009).
  const secrets = createSecretStore({
    dataDir: config.dataDir,
    preferOsKeychain: config.secretBackend !== 'file'
  });

  const mcp = new McpClientManager({
    defaultTimeoutMs: config.defaultMcpTimeoutMs,
    logger: logger.child({ scope: 'mcp' }),
    secretResolver: (ref) => secrets.get(ref),
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

  // Once the settings file exists it is the source of truth: a preset the user removed stays removed.
  if (persisted.mcpServers === undefined) {
    for (const preset of getDefaultMcpPresets()) {
      mcp.upsertServer(preset);
    }
  } else {
    for (const server of persisted.mcpServers) {
      mcp.upsertServer(server);
    }
  }
  for (const server of options.servers ?? []) {
    mcp.upsertServer(server);
  }

  const providers = new LlmProviderRegistry(secrets);
  for (const provider of persisted.llmProviders ?? []) {
    providers.upsert(provider);
  }

  const profiles = new ProfileRegistry();
  for (const profile of persisted.profiles ?? []) {
    try {
      profiles.upsert(profile);
    } catch (error) {
      logger.warn('Discarding an invalid persisted validation profile', {
        profileId: profile.id,
        reason: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
  const review = new ReviewOrchestrator({
    mcp,
    providers,
    profiles,
    logger: logger.child({ scope: 'review' })
  });

  const server = await createHostServer({
    config,
    logger: logger.child({ scope: 'http' }),
    sessions,
    mcp,
    events,
    providers,
    profiles,
    review,
    configStore
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
    secrets,
    providers,
    profiles,
    review,
    configStore,
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