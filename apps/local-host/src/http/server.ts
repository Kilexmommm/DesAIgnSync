import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import {
  DesaignSyncHostError,
  HOST_API_PATHS,
  HOST_API_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  type ApiErrorResponse,
  type HealthResponse,
  type HostEvent,
  type HostInfoResponse,
  type HostLifecycleState,
  type LlmModelsResponse,
  type LlmProvidersResponse,
  type McpServerConfig,
  type McpServersResponse,
  type McpToolCallOutcome,
  type McpToolCallRequest,
  type PairRequest,
  type PairResponse,
  type ProfilesResponse,
  type RemoveLlmProviderRequest,
  type RemoveLlmProviderResponse,
  type RemoveMcpServerRequest,
  type RemoveMcpServerResponse,
  type RemoveProfileRequest,
  type RemoveProfileResponse,
  type ReviewRequest,
  type ReviewResult,
  type SaveLlmProviderRequest,
  type SaveProfileRequest,
  type SessionInfoResponse,
  type TestLlmProviderRequest,
  type TestLlmProviderResponse,
  type TestMcpServerRequest,
  type TestMcpServerResponse
} from '@desaignsync/shared-types';
import { normalizeElementTarget } from '@desaignsync/core';

import { HOST_VERSION, type HostRuntimeConfig } from '../config/hostConfig.js';
import type { ConfigStore } from '../config/configStore.js';
import type { Logger } from '../logging/logger.js';
import type { McpClientManager } from '../mcp/McpClientManager.js';
import type { LlmProviderRegistry } from '../llm/providerRegistry.js';
import type { ProfileRegistry } from '../review/profileRegistry.js';
import type { ReviewOrchestrator } from '../review/reviewOrchestrator.js';
import { evaluateOrigin } from '../security/originPolicy.js';
import type { SessionRecord, SessionStore } from '../security/sessionStore.js';
import { EventBus } from './eventBus.js';
import { statusForErrorCode, toErrorBody } from './httpErrors.js';

export interface HostServerOptions {
  config: HostRuntimeConfig;
  logger: Logger;
  sessions: SessionStore;
  mcp: McpClientManager;
  events?: EventBus;
  providers?: LlmProviderRegistry;
  profiles?: ProfileRegistry;
  review?: ReviewOrchestrator;
  /** Settings persistence (DS-028). Optional so tests can run fully in-memory. */
  configStore?: ConfigStore;
  onShutdownRequested?: () => void;
}

export interface HostServer {
  readonly port: number;
  readonly url: string;
  readonly events: EventBus;
  readonly lifecycle: HostLifecycleState;
  setLifecycle(next: HostLifecycleState): void;
  close(): Promise<void>;
}

const JSON_HEADERS: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };

/* MARKER_SERVER_METHODS */

export async function createHostServer(options: HostServerOptions): Promise<HostServer> {
  const { config, logger, sessions, mcp } = options;
  const events = options.events ?? new EventBus();
  const startedAt = Date.now();
  let lifecycle: HostLifecycleState = 'starting';
  let boundPort = config.port;

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const decision = evaluateOrigin(req.headers.origin, {
      allowExtensionScheme: config.allowExtensionScheme,
      pinnedExtensionOrigins: config.pinnedExtensionOrigins,
      allowDevRemoteOrigins: config.allowDevRemoteOrigins
    });
    const url = safeUrl(req.url, config.host, boundPort);
    const token = extractToken(req, url);
    if (!decision.allowed || url.pathname !== HOST_API_PATHS.events || !sessions.verify(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      registerEventClient(client);
    });
  });

  const registerEventClient = (client: WebSocket): void => {
    const hello: HostEvent = {
      type: 'host.lifecycle',
      ts: new Date().toISOString(),
      payload: { lifecycle, uptimeMs: Date.now() - startedAt }
    };
    client.send(JSON.stringify(hello));
    const unsubscribe = events.subscribe((event) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    });
    client.on('close', unsubscribe);
    client.on('error', unsubscribe);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = safeUrl(req.url, config.host, boundPort);
    const correlationId = `req-${Date.now().toString(36)}`;

    try {
      const decision = evaluateOrigin(req.headers.origin, {
        allowExtensionScheme: config.allowExtensionScheme,
        pinnedExtensionOrigins: config.pinnedExtensionOrigins,
        allowDevRemoteOrigins: config.allowDevRemoteOrigins
      });
      if (!decision.allowed) {
        throw new DesaignSyncHostError(
          'FORBIDDEN_ORIGIN',
          'This origin is not allowed to talk to the DesAIgnSync Local Host.',
          { details: { reason: decision.reason } }
        );
      }

      if (req.method === 'OPTIONS') {
        writePreflight(req, res);
        return;
      }

      if (url.pathname === HOST_API_PATHS.health && req.method === 'GET') {
        const body: HealthResponse = {
          status: 'ok',
          lifecycle,
          hostVersion: HOST_VERSION,
          apiVersion: HOST_API_VERSION,
          uptimeMs: Date.now() - startedAt,
          pairingOpen: sessions.isPairingOpen(),
          loopbackOnly: true
        };
        writeJson(res, 200, body, req);
        return;
      }

      if (url.pathname === HOST_API_PATHS.sessionPair && req.method === 'POST') {
        const payload = (await readJsonBody(req, config)) as PairRequest;
        if (typeof payload?.pairingCode !== 'string') {
          throw new DesaignSyncHostError('BAD_REQUEST', 'pairingCode is required.');
        }
        const issued = sessions.pair(payload.pairingCode, {
          ...(payload.clientName ? { clientName: payload.clientName } : {}),
          ...(payload.extensionId ? { extensionId: payload.extensionId } : {})
        });
        logger.info('Extension paired with the Local Host', {
          sessionId: issued.session.id,
          clientName: issued.session.clientName
        });
        events.publish({
          type: 'host.pairing-window',
          ts: new Date().toISOString(),
          payload: { open: false }
        });
        const body: PairResponse = {
          token: issued.token,
          expiresAt: issued.expiresAt,
          apiVersion: HOST_API_VERSION,
          hostVersion: HOST_VERSION
        };
        writeJson(res, 200, body, req);
        return;
      }

      const token = extractToken(req, url);
      const session = sessions.verify(token);
      if (!session) {
        throw new DesaignSyncHostError(
          'UNAUTHORIZED',
          'Missing or expired session. Pair the extension again from the Side Panel.'
        );
      }

      await handleAuthenticatedRoute(req, res, url, session, token, correlationId);
    } catch (error) {
      const body = toErrorBody(error, correlationId);
      logger.warn('Host request failed', {
        path: url.pathname,
        method: req.method,
        code: body.code
      });
      writeJson(res, statusForErrorCode(body.code), { error: body } satisfies ApiErrorResponse, req);
    }
  };

  const handleAuthenticatedRoute = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    session: SessionRecord,
    token: string | undefined,
    correlationId: string
  ): Promise<void> => {
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === HOST_API_PATHS.sessionInfo && method === 'GET') {
      const body: SessionInfoResponse = {
        sessionId: session.id,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        hostVersion: HOST_VERSION,
        apiVersion: HOST_API_VERSION,
        ...(session.clientName ? { clientName: session.clientName } : {})
      };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.sessionRenew && method === 'POST') {
      const issued = sessions.renew(token);
      if (!issued) {
        throw new DesaignSyncHostError('UNAUTHORIZED', 'Session cannot be renewed.');
      }
      const body: PairResponse = {
        token: issued.token,
        expiresAt: issued.expiresAt,
        apiVersion: HOST_API_VERSION,
        hostVersion: HOST_VERSION
      };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.sessionInfo && method === 'DELETE') {
      const revoked = sessions.revoke(token);
      events.publish({
        type: 'log',
        ts: new Date().toISOString(),
        payload: { level: 'info', message: `Session ${session.id} revoked.` }
      });
      writeJson(res, 200, { revoked }, req);
      return;
    }

    if (path === HOST_API_PATHS.info && method === 'GET') {
      const body: HostInfoResponse = {
        name: 'DesAIgnSync Local MCP Host',
        hostVersion: HOST_VERSION,
        apiVersion: HOST_API_VERSION,
        supportedProtocolVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
        pinnedExtensionOrigins: config.pinnedExtensionOrigins,
        servers: mcp.listStatuses()
      };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.mcpServers && method === 'GET') {
      const body: McpServersResponse = { servers: mcp.listStatuses() };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.mcpServers && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config));
      const server = payload['server'];
      if (typeof server !== 'object' || server === null) {
        throw new DesaignSyncHostError('BAD_REQUEST', 'A server configuration object is required.');
      }
      const validated = validateMcpServerConfig(server as Record<string, unknown>);
      mcp.upsertServer(validated);
      const connect = payload['connect'] === true;
      const status = connect ? await mcp.connect(validated.id) : mcp.getStatus(validated.id);
      options.configStore?.saveMcpServers(mcp.listConfigs());
      writeJson(res, 200, { status: status ?? undefined }, req);
      return;
    }

    if (path === HOST_API_PATHS.mcpServersRemove && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as RemoveMcpServerRequest;
      if (typeof payload.serverId !== 'string' || payload.serverId === '') {
        throw new DesaignSyncHostError('BAD_REQUEST', 'serverId is required.');
      }
      await mcp.removeServer(payload.serverId);
      options.configStore?.saveMcpServers(mcp.listConfigs());
      const body: RemoveMcpServerResponse = { removed: true };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.mcpServersTest && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as TestMcpServerRequest;
      const body: TestMcpServerResponse = await mcp.testConnection(payload);
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.mcpToolsCall && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as McpToolCallRequest;
      if (typeof payload.serverId !== 'string' || typeof payload.toolName !== 'string') {
        throw new DesaignSyncHostError('BAD_REQUEST', 'serverId and toolName are required.');
      }
      const outcome: McpToolCallOutcome = await mcp.callTool(payload);
      writeJson(res, outcome.ok ? 200 : 502, outcome, req);
      return;
    }

    if (path === HOST_API_PATHS.llmProviders && method === 'GET') {
      const body: LlmProvidersResponse = { providers: options.providers?.describe() ?? [] };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.llmProviders && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as SaveLlmProviderRequest;
      if (typeof payload.name !== 'string' || typeof payload.baseUrl !== 'string') {
        throw new DesaignSyncHostError('BAD_REQUEST', 'Provider name and baseUrl are required.');
      }
      const registry = requireProviders(options);
      const provider = await registry.save(payload);
      // Only the safe projection leaves the host: the API key stays in the credential store.
      const saved = registry.describe().find((entry) => entry.id === provider.id);
      options.configStore?.saveLlmProviders(registry.list());
      writeJson(res, 200, { provider: saved ?? undefined }, req);
      return;
    }

    if (path === HOST_API_PATHS.llmProvidersRemove && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as RemoveLlmProviderRequest;
      if (typeof payload.providerId !== 'string' || payload.providerId === '') {
        throw new DesaignSyncHostError('BAD_REQUEST', 'providerId is required.');
      }
      const registry = requireProviders(options);
      const removed = await registry.remove(payload.providerId);
      options.configStore?.saveLlmProviders(registry.list());
      const body: RemoveLlmProviderResponse = { removed };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.llmProvidersTest && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as TestLlmProviderRequest;
      const registry = requireProviders(options);
      let providerId = payload.providerId;
      if (providerId === undefined && payload.config !== undefined) {
        providerId = (await registry.save(payload.config)).id;
      }
      const result = await registry.adapter(providerId).testConnection(payload.timeoutMs);
      const body: TestLlmProviderResponse = {
        ok: result.ok,
        ...(result.value?.model !== undefined ? { model: result.value.model } : {}),
        ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
        ...(result.error !== undefined ? { error: result.error } : {})
      };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.llmProvidersModels && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as TestLlmProviderRequest;
      const registry = requireProviders(options);
      const result = await registry.adapter(payload.providerId).fetchModels(payload.timeoutMs);
      const body: LlmModelsResponse = {
        ok: result.ok,
        models: result.value ?? [],
        ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
        ...(result.error !== undefined ? { error: result.error } : {})
      };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.profiles && method === 'GET') {
      const body: ProfilesResponse = { profiles: options.profiles?.describe() ?? [] };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.profilesSave && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as SaveProfileRequest;
      const registry = requireProfiles(options);
      registry.upsert(payload.profile);
      options.configStore?.saveProfiles(registry.list());
      writeJson(res, 200, { saved: true }, req);
      return;
    }

    if (path === HOST_API_PATHS.profilesRemove && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as RemoveProfileRequest;
      if (typeof payload.profileId !== 'string' || payload.profileId === '') {
        throw new DesaignSyncHostError('BAD_REQUEST', 'profileId is required.');
      }
      const registry = requireProfiles(options);
      const target = registry.get(payload.profileId);
      const removed = registry.remove(payload.profileId);
      options.configStore?.saveProfiles(registry.list());
      const body: RemoveProfileResponse = removed
        ? { removed }
        : {
            removed,
            reason:
              target?.isBuiltIn === true
                ? 'Built-in profiles cannot be removed; reset them to their template instead.'
                : 'Unknown profile.'
          };
      writeJson(res, 200, body, req);
      return;
    }

    if (path === HOST_API_PATHS.inspectionReview && method === 'POST') {
      const payload = asRecord(await readJsonBody(req, config)) as unknown as ReviewRequest;
      const validation = normalizeElementTarget(payload.target);
      if (!validation.ok || validation.target === undefined) {
        throw new DesaignSyncHostError(
          'BAD_REQUEST',
          `A valid element target is required: ${validation.issues.join('; ')}`
        );
      }
      if (options.review === undefined) {
        throw new DesaignSyncHostError('HOST_NOT_READY', 'The review orchestrator is not available.');
      }
      const result: ReviewResult = await options.review.review({
        ...payload,
        target: validation.target
      });
      writeJson(res, 200, result, req);
      return;
    }

    throw new DesaignSyncHostError('NOT_FOUND', `Unknown route: ${method} ${path}`, {
      details: { correlationId }
    });
  };

  const host: HostServer = {
    get port() {
      return boundPort;
    },
    get url() {
      return `http://${config.host}:${boundPort}`;
    },
    events,
    get lifecycle() {
      return lifecycle;
    },
    setLifecycle(next: HostLifecycleState) {
      lifecycle = next;
      events.publish({
        type: 'host.lifecycle',
        ts: new Date().toISOString(),
        payload: { lifecycle: next, uptimeMs: Date.now() - startedAt }
      });
    },
    async close(): Promise<void> {
      lifecycle = 'shutting-down';
      for (const client of wss.clients) {
        try {
          client.close(1001, 'Host shutting down');
        } catch {
          // Client already gone.
        }
      }
      wss.close();
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      // Keep-alive sockets (Side Panel polling, CLI) would otherwise delay shutdown.
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closed;
    }
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        boundPort = address.port;
      }
      resolve();
    });
  });

  logger.info('Local MCP Host listening', {
    url: `http://${config.host}:${boundPort}`,
    logLevel: config.logLevel,
    pinnedOrigins: config.pinnedExtensionOrigins.length
  });

  return host;
}

const safeUrl = (rawUrl: string | undefined, host: string, port: number): URL => {
  try {
    return new URL(rawUrl ?? '/', `http://${host}:${port > 0 ? port : 80}`);
  } catch {
    return new URL('/', `http://${host}`);
  }
};

/** Token can arrive as a Bearer header, an explicit header or (WS) a query parameter. */
const extractToken = (req: IncomingMessage, url: URL): string | undefined => {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const explicit = req.headers['x-desaignsync-token'];
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim();
  const queryToken = url.searchParams.get('token');
  return queryToken ?? undefined;
};

const applyCors = (req: IncomingMessage, res: ServerResponse): void => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
};

const writeJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  req?: IncomingMessage
): void => {
  if (req) applyCors(req, res);
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body ?? {}));
};

const writePreflight = (req: IncomingMessage, res: ServerResponse): void => {
  applyCors(req, res);
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'authorization,content-type,x-desaignsync-token,x-desaignsync-pairing-code'
  );
  res.setHeader('access-control-max-age', '600');
  res.writeHead(204);
  res.end();
};

const readJsonBody = async (req: IncomingMessage, config: HostRuntimeConfig): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > config.requestBodyLimitBytes) {
      throw new DesaignSyncHostError('PAYLOAD_TOO_LARGE', 'Request body exceeds the configured limit.');
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DesaignSyncHostError('BAD_REQUEST', 'Request body is not valid JSON.');
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const requireProviders = (options: HostServerOptions): LlmProviderRegistry => {
  if (options.providers === undefined) {
    throw new DesaignSyncHostError('HOST_NOT_READY', 'The LLM provider registry is not available.');
  }
  return options.providers;
};

const requireProfiles = (options: HostServerOptions): ProfileRegistry => {
  if (options.profiles === undefined) {
    throw new DesaignSyncHostError('HOST_NOT_READY', 'The validation profile registry is not available.');
  }
  return options.profiles;
};

/** Validates an MCP server config coming from the Side Panel (never trusts the payload). */
export const validateMcpServerConfig = (raw: Record<string, unknown>): McpServerConfig => {
  const transport = raw['transport'];
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    throw new DesaignSyncHostError(
      'CONFIG_INVALID',
      'MCP transport must be either "stdio" or "streamable-http".'
    );
  }
  const rawId = raw['id'];
  const id =
    typeof rawId === 'string' && rawId.trim() !== '' ? rawId.trim() : `mcp-${Date.now().toString(36)}`;
  const rawName = raw['name'];
  const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : id;
  const role =
    raw['role'] === 'inspection' ||
    raw['role'] === 'design-system-reference' ||
    raw['role'] === 'generic'
      ? raw['role']
      : 'generic';

  const config: McpServerConfig = {
    id,
    name,
    transport,
    role,
    enabled: raw['enabled'] !== false,
    autoStart: raw['autoStart'] === true
  };
  if (typeof raw['command'] === 'string') config.command = raw['command'];
  if (Array.isArray(raw['args'])) {
    config.args = raw['args'].filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof raw['url'] === 'string') config.url = raw['url'];
  if (typeof raw['description'] === 'string') config.description = raw['description'];
  if (typeof raw['presetId'] === 'string') config.presetId = raw['presetId'];
  if (typeof raw['timeoutMs'] === 'number' && raw['timeoutMs'] > 0) config.timeoutMs = raw['timeoutMs'];
  const envRefs = asRecord(raw['envRefs']);
  if (Object.keys(envRefs).length > 0) {
    config.envRefs = Object.fromEntries(
      Object.entries(envRefs).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  }

  if (transport === 'stdio' && !config.command) {
    throw new DesaignSyncHostError('CONFIG_INVALID', 'stdio MCP servers require a command.');
  }
  if (transport === 'streamable-http' && !config.url) {
    throw new DesaignSyncHostError('CONFIG_INVALID', 'streamable-http MCP servers require a url.');
  }
  return config;
};