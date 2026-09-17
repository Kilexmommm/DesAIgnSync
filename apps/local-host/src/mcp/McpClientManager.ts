import {
  DesaignSyncHostError,
  type HostErrorBody,
  type McpConnectionState,
  type McpServerConfig,
  type McpServerRuntimeStatus,
  type McpToolCallOutcome,
  type McpToolCallRequest,
  type TestMcpServerRequest,
  type TestMcpServerResponse
} from '@desaignsync/shared-types';

import { redactUrl } from '../security/redaction.js';
import type { Logger } from '../logging/logger.js';
import { McpClient } from './mcpClient.js';
import { JsonRpcRemoteError, JsonRpcTimeoutError } from './jsonRpc.js';
import { StdioMcpTransport } from './transports/stdioTransport.js';
import { StreamableHttpMcpTransport } from './transports/httpTransport.js';
import { TransportClosedError, type McpTransport } from './transport.js';

export interface McpManagerOptions {
  defaultTimeoutMs: number;
  logger: Logger;
  /** Max automatic reconnects after an unexpected crash. */
  maxRestarts?: number;
  restartBaseDelayMs?: number;
  /** Resolves secret references for stdio env vars (secret store lands in DS-009). */
  secretResolver?: (ref: string) => Promise<string | undefined>;
  onStatusChange?: (status: McpServerRuntimeStatus) => void;
}

interface ServerEntry {
  config: McpServerConfig;
  client: McpClient | undefined;
  state: McpConnectionState;
  restartCount: number;
  lastError: HostErrorBody | undefined;
  restartTimer: NodeJS.Timeout | undefined;
  connecting: Promise<McpServerRuntimeStatus> | undefined;
  userDisconnected: boolean;
  lastLatencyMs: number | undefined;
}

/**
 * Generic MCP connection manager for stdio and streamable-http servers (DS-004, spec v2.1 §7).
 * It never assumes concrete tool names; adapters map domain operations onto discovered tools.
 */
export class McpClientManager {
  readonly #entries = new Map<string, ServerEntry>();
  readonly #options: McpManagerOptions;
  readonly #maxRestarts: number;
  readonly #restartBaseDelayMs: number;
  #disposed = false;

  constructor(options: McpManagerOptions) {
    this.#options = options;
    this.#maxRestarts = options.maxRestarts ?? 3;
    this.#restartBaseDelayMs = options.restartBaseDelayMs ?? 500;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  #entry(serverId: string): ServerEntry {
    const entry = this.#entries.get(serverId);
    if (!entry) {
      throw new DesaignSyncHostError('MCP_SERVER_NOT_FOUND', `Unknown MCP server "${serverId}".`, {
        details: { serverId }
      });
    }
    return entry;
  }

  /** Registers or updates a server configuration without connecting it. */
  upsertServer(config: McpServerConfig, options: { reconnect?: boolean } = {}): void {
    const existing = this.#entries.get(config.id);
    const entry: ServerEntry = existing ?? {
      config,
      client: undefined,
      state: 'stopped',
      restartCount: 0,
      lastError: undefined,
      restartTimer: undefined,
      connecting: undefined,
      userDisconnected: false,
      lastLatencyMs: undefined
    };
    entry.config = config;
    this.#entries.set(config.id, entry);
    if (options.reconnect && existing) {
      void this.disconnect(config.id).then(() => this.connect(config.id)).catch(() => undefined);
    }
  }

  getConfig(serverId: string): McpServerConfig | undefined {
    return this.#entries.get(serverId)?.config;
  }

  listConfigs(): McpServerConfig[] {
    return [...this.#entries.values()].map((entry) => entry.config);
  }

  async removeServer(serverId: string): Promise<void> {
    if (!this.#entries.has(serverId)) return;
    await this.disconnect(serverId);
    this.#entries.delete(serverId);
  }

  async #createTransport(config: McpServerConfig): Promise<McpTransport> {
    const timeoutMs = config.timeoutMs ?? this.#options.defaultTimeoutMs;
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new DesaignSyncHostError(
          'CONFIG_INVALID',
          `MCP server "${config.name}" uses stdio but has no command.`,
          { details: { serverId: config.id } }
        );
      }
      const env = await this.#resolveEnv(config);
      return new StdioMcpTransport({
        command: config.command,
        args: config.args ?? [],
        ...(Object.keys(env).length > 0 ? { env } : {})
      });
    }

    if (!config.url) {
      throw new DesaignSyncHostError(
        'CONFIG_INVALID',
        `MCP server "${config.name}" uses streamable-http but has no URL.`,
        { details: { serverId: config.id } }
      );
    }
    return new StreamableHttpMcpTransport({ url: config.url, timeoutMs });
  }

  async #resolveEnv(config: McpServerConfig): Promise<Record<string, string>> {
    const envRefs = config.envRefs ?? {};
    const names = Object.keys(envRefs);
    if (names.length === 0) return {};
    const resolver = this.#options.secretResolver;
    if (!resolver) {
      throw new DesaignSyncHostError(
        'SECRET_STORE_UNAVAILABLE',
        `MCP server "${config.name}" requires secret environment variables but no secret store is configured.`,
        { details: { serverId: config.id, count: names.length } }
      );
    }
    const resolved: Record<string, string> = {};
    for (const name of names) {
      const ref = envRefs[name];
      if (!ref) continue;
      const value = await resolver(ref);
      if (value === undefined) {
        throw new DesaignSyncHostError(
          'SECRET_STORE_UNAVAILABLE',
          `Missing secret for "${name}" of MCP server "${config.name}".`,
          { details: { serverId: config.id } }
        );
      }
      resolved[name] = value;
    }
    return resolved;
  }

  async connect(serverId: string): Promise<McpServerRuntimeStatus> {
    const entry = this.#entry(serverId);
    if (this.#disposed) {
      throw new DesaignSyncHostError('HOST_NOT_READY', 'The Local Host is shutting down.');
    }
    if (entry.connecting) return entry.connecting;

    entry.userDisconnected = false;
    entry.state = 'starting';
    this.#emit(entry);

    const connecting = (async (): Promise<McpServerRuntimeStatus> => {
      try {
        const transport = await this.#createTransport(entry.config);
        const client = new McpClient({
          serverId: entry.config.id,
          transport,
          timeoutMs: entry.config.timeoutMs ?? this.#options.defaultTimeoutMs,
          clientName: 'DesAIgnSync Local Host',
          clientVersion: '0.1.0',
          onNotification: (notification) =>
            this.#options.logger.debug('MCP notification received', {
              serverId: entry.config.id,
              method: notification.method
            }),
          onTransportClose: (reason) => this.#handleTransportClose(entry, reason)
        });

        const startedAt = Date.now();
        await client.connect();
        entry.lastLatencyMs = Date.now() - startedAt;
        entry.client = client;
        entry.state = 'ready';
        entry.lastError = undefined;
        this.#options.logger.info('MCP server connected', {
          serverId: entry.config.id,
          transport: transport.kind,
          tools: client.tools.length,
          protocolVersion: client.protocolVersion
        });
        this.#emit(entry);
        return this.#snapshot(entry);
      } catch (error) {
        const hostError = toHostError(error, entry.config.id);
        entry.lastError = hostError;
        entry.state = 'error';
        entry.client = undefined;
        this.#options.logger.error('MCP server connection failed', {
          serverId: entry.config.id,
          code: hostError.code,
          message: hostError.message
        });
        this.#emit(entry);
        throw new DesaignSyncHostError(hostError.code, hostError.message, {
          retryable: hostError.retryable,
          ...(hostError.details ? { details: hostError.details } : {})
        });
      } finally {
        entry.connecting = undefined;
      }
    })();

    entry.connecting = connecting;
    return connecting;
  }

  #handleTransportClose(
    entry: ServerEntry,
    reason: { error?: Error; code?: number | null; signal?: NodeJS.Signals | null }
  ): void {
    entry.client = undefined;
    if (entry.userDisconnected || this.#disposed) {
      entry.state = 'stopped';
      this.#emit(entry);
      return;
    }
    entry.lastError = toHostError(
      reason.error ?? new Error('MCP transport closed unexpectedly.'),
      entry.config.id
    );
    entry.state = 'degraded';
    this.#emit(entry);
    this.#scheduleRestart(entry);
  }

  #scheduleRestart(entry: ServerEntry): void {
    if (this.#disposed || entry.userDisconnected || !entry.config.enabled) return;
    if (entry.restartCount >= this.#maxRestarts) {
      entry.state = 'error';
      entry.lastError = {
        code: 'MCP_SERVER_CRASHED',
        message: `MCP server "${entry.config.name}" crashed repeatedly; automatic restarts stopped.`,
        retryable: true,
        correlationId: `${entry.config.id}-restart-limit`
      };
      this.#emit(entry);
      return;
    }
    entry.restartCount += 1;
    const delay = this.#restartBaseDelayMs * 2 ** (entry.restartCount - 1);
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = undefined;
      void this.connect(entry.config.id).catch(() => undefined);
    }, delay);
    entry.restartTimer.unref?.();
    this.#options.logger.warn('MCP server restart scheduled', {
      serverId: entry.config.id,
      attempt: entry.restartCount,
      delayMs: delay
    });
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.#entry(serverId);
    entry.userDisconnected = true;
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = undefined;
    }
    const client = entry.client;
    entry.client = undefined;
    if (client) {
      await client.close();
    }
    entry.state = 'stopped';
    entry.restartCount = 0;
    this.#emit(entry);
  }

  #snapshot(entry: ServerEntry): McpServerRuntimeStatus {
    const client = entry.client;
    const config = entry.config;
    const transportSummary =
      config.transport === 'stdio'
        ? [config.command ?? 'unknown', ...(config.args ?? [])].join(' ')
        : redactUrl(config.url ?? 'unknown');

    const status: McpServerRuntimeStatus = {
      serverId: config.id,
      name: config.name,
      transport: config.transport,
      transportSummary,
      state: entry.state,
      role: config.role,
      restartCount: entry.restartCount
    };
    if (client?.capabilities) status.capabilities = client.capabilities;
    if (client?.tools) status.tools = client.tools;
    if (entry.lastError) status.lastError = entry.lastError;
    if (client?.pid !== undefined) status.pid = client.pid;
    if (entry.lastLatencyMs !== undefined) status.latencyMs = entry.lastLatencyMs;
    return status;
  }

  #emit(entry: ServerEntry): void {
    this.#options.onStatusChange?.(this.#snapshot(entry));
  }

  getStatus(serverId: string): McpServerRuntimeStatus | undefined {
    const entry = this.#entries.get(serverId);
    return entry ? this.#snapshot(entry) : undefined;
  }

  listStatuses(): McpServerRuntimeStatus[] {
    return [...this.#entries.values()].map((entry) => this.#snapshot(entry));
  }

  /** Ids of servers whose role matches and that are currently usable. */
  findReadyServerIdsByRole(role: McpServerConfig['role']): string[] {
    return [...this.#entries.values()]
      .filter((entry) => entry.config.role === role && entry.state === 'ready' && entry.client)
      .map((entry) => entry.config.id);
  }

  findTools(serverId: string): string[] {
    return this.#entries.get(serverId)?.client?.tools.map((tool) => tool.name) ?? [];
  }

  /** Connects every enabled server marked `autoStart`, tolerating individual failures. */
  async connectAutoStart(): Promise<McpServerRuntimeStatus[]> {
    const targets = [...this.#entries.values()].filter(
      (entry) => entry.config.enabled && entry.config.autoStart
    );
    const results: McpServerRuntimeStatus[] = [];
    for (const entry of targets) {
      try {
        results.push(await this.connect(entry.config.id));
      } catch {
        const status = this.#snapshot(entry);
        results.push(status);
      }
    }
    return results;
  }

  /** Calls a tool on a connected server, mapping failures to structured host errors. */
  async callTool(request: McpToolCallRequest): Promise<McpToolCallOutcome> {
    const entry = this.#entries.get(request.serverId);
    const startedAt = Date.now();

    if (!entry) {
      return failure(request, Date.now() - startedAt, {
        code: 'MCP_SERVER_NOT_FOUND',
        message: `Unknown MCP server "${request.serverId}".`,
        retryable: false,
        correlationId: `${request.serverId}-not-found`
      });
    }

    const client = entry.client;
    if (!client || client.state !== 'ready') {
      return failure(request, Date.now() - startedAt, {
        code: 'MCP_CONNECT_FAILED',
        message: `MCP server "${entry.config.name}" is not connected.`,
        retryable: true,
        correlationId: `${request.serverId}-not-connected`
      });
    }

    if (!client.tools.some((tool) => tool.name === request.toolName)) {
      return failure(request, Date.now() - startedAt, {
        code: 'MCP_TOOL_NOT_FOUND',
        message: `MCP server "${entry.config.name}" does not expose the tool "${request.toolName}".`,
        retryable: false,
        correlationId: `${request.serverId}-${request.toolName}`,
        details: { toolName: request.toolName }
      });
    }

    try {
      const result = await client.callTool(
        request.toolName,
        request.args,
        request.timeoutMs ?? entry.config.timeoutMs
      );
      const outcome: McpToolCallOutcome = {
        serverId: request.serverId,
        toolName: request.toolName,
        ok: !result.isError,
        isError: result.isError,
        content: result.content,
        durationMs: Date.now() - startedAt
      };
      if (result.structuredContent !== undefined) {
        outcome.structuredContent = result.structuredContent as McpToolCallOutcome['structuredContent'];
      }
      if (result.isError) {
        outcome.error = {
          code: 'MCP_PROTOCOL_ERROR',
          message: `Tool "${request.toolName}" reported an error.`,
          retryable: false,
          correlationId: `${request.serverId}-${request.toolName}`
        };
      }
      return outcome;
    } catch (error) {
      return failure(request, Date.now() - startedAt, toHostError(error, request.serverId));
    }
  }

  /** Ephemeral connect + tools/list probe used by "Test connection" in Settings. */
  async testConnection(input: TestMcpServerRequest): Promise<TestMcpServerResponse> {
    const temporaryId = input.serverId ?? `probe-${Date.now().toString(36)}`;
    const existingConfig = input.serverId ? this.getConfig(input.serverId) : undefined;

    let config: McpServerConfig;
    if (existingConfig) {
      config = existingConfig;
    } else if (input.config) {
      const base: McpServerConfig = {
        id: temporaryId,
        name: `Probe ${temporaryId}`,
        transport: input.config.transport,
        role: 'generic',
        enabled: true,
        autoStart: false
      };
      if (input.config.command) base.command = input.config.command;
      if (input.config.args) base.args = input.config.args;
      if (input.config.url) base.url = input.config.url;
      if (input.config.timeoutMs) base.timeoutMs = input.config.timeoutMs;
      config = base;
    } else {
      throw new DesaignSyncHostError('BAD_REQUEST', 'Provide either serverId or a config to test.');
    }

    const shouldCleanup = existingConfig === undefined;
    this.upsertServer(config);
    try {
      const status = await this.connect(config.id);
      return { ok: true, status };
    } catch (error) {
      const hostError = toHostError(error, config.id);
      return {
        ok: false,
        status: this.getStatus(config.id) ?? {
          serverId: config.id,
          name: config.name,
          transport: config.transport,
          transportSummary: config.url ?? config.command ?? 'unknown',
          state: 'error',
          role: config.role,
          restartCount: 0,
          lastError: hostError
        },
        error: hostError
      };
    } finally {
      if (shouldCleanup) {
        await this.removeServer(config.id).catch(() => undefined);
      }
    }
  }

  /** Stops every server and kills all child processes spawned by DesAIgnSync (DS-003). */
  async dispose(): Promise<void> {
    this.#disposed = true;
    const ids = [...this.#entries.keys()];
    await Promise.all(ids.map((id) => this.disconnect(id).catch(() => undefined)));
    this.#entries.clear();
  }
}

const failure = (
  request: McpToolCallRequest,
  durationMs: number,
  error: HostErrorBody
): McpToolCallOutcome => ({
  serverId: request.serverId,
  toolName: request.toolName,
  ok: false,
  isError: true,
  content: [],
  durationMs,
  error
});

/** Maps transport/protocol failures onto structured, secret-free host errors. */
export function toHostError(error: unknown, serverId: string): HostErrorBody {
  const correlationId = `${serverId}-${Date.now().toString(36)}`;
  if (error instanceof DesaignSyncHostError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      correlationId,
      ...(error.details ? { details: error.details } : {})
    };
  }
  if (error instanceof JsonRpcTimeoutError) {
    return {
      code: 'MCP_TIMEOUT',
      message: error.message,
      retryable: true,
      correlationId
    };
  }
  if (error instanceof JsonRpcRemoteError) {
    return {
      code: 'MCP_PROTOCOL_ERROR',
      message: `MCP server returned error ${error.code}: ${error.message}`,
      retryable: false,
      correlationId
    };
  }
  if (error instanceof TransportClosedError) {
    return {
      code: 'MCP_SERVER_CRASHED',
      message: error.message,
      retryable: true,
      correlationId
    };
  }
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : 'Unexpected MCP failure.',
    retryable: false,
    correlationId
  };
}