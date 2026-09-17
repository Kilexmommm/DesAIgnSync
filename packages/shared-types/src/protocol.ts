import type { JsonValue } from './common.js';
import type { HostErrorBody } from './errors.js';
import type { McpServerRuntimeStatus } from './mcp.js';

/**
 * Internal API contract between the Side Panel and the Local MCP Host (spec v2.1 §18).
 * Loopback only, always authenticated by an ephemeral session token.
 */
export const HOST_API_VERSION = '1';

export const HOST_API_PATHS = {
  health: '/health',
  info: '/info',
  sessionPair: '/session/pair',
  sessionInfo: '/session',
  sessionRenew: '/session/renew',
  events: '/events',
  mcpServers: '/mcp/servers',
  mcpServersTest: '/mcp/servers/test',
  mcpToolsCall: '/mcp/tools/call',
  llmProviders: '/llm/providers',
  llmProvidersTest: '/llm/providers/test',
  llmProvidersModels: '/llm/providers/models',
  profiles: '/profiles',
  inspectionStart: '/inspection/start',
  inspectionSnapshot: '/inspection/snapshot',
  inspectionScreenshot: '/inspection/screenshot',
  inspectionReview: '/inspection/review',
  reportsExport: '/reports/export'
} as const;

export type HostApiPath = (typeof HOST_API_PATHS)[keyof typeof HOST_API_PATHS];

export type HostLifecycleState = 'starting' | 'ready' | 'degraded' | 'shutting-down';

/** Unauthenticated, deliberately minimal (no config, no secrets). */
export interface HealthResponse {
  status: 'ok';
  lifecycle: HostLifecycleState;
  hostVersion: string;
  apiVersion: string;
  uptimeMs: number;
  pairingOpen: boolean;
  loopbackOnly: boolean;
}

export interface HostInfoResponse {
  name: string;
  hostVersion: string;
  apiVersion: string;
  supportedProtocolVersions: string[];
  pinnedExtensionOrigins: string[];
  servers: McpServerRuntimeStatus[];
}

export interface PairRequest {
  pairingCode: string;
  clientName?: string;
  extensionId?: string;
}

export interface PairResponse {
  token: string;
  expiresAt: string;
  apiVersion: string;
  hostVersion: string;
}

export interface SessionInfoResponse {
  sessionId: string;
  clientName?: string;
  createdAt: string;
  expiresAt: string;
  hostVersion: string;
  apiVersion: string;
}

export interface ApiErrorResponse {
  error: HostErrorBody;
}

export interface McpServersResponse {
  servers: McpServerRuntimeStatus[];
}

export interface TestMcpServerRequest {
  serverId?: string;
  config?: {
    transport: 'stdio' | 'streamable-http';
    command?: string;
    args?: string[];
    url?: string;
    timeoutMs?: number;
  };
}

export interface TestMcpServerResponse {
  ok: boolean;
  status: McpServerRuntimeStatus;
  error?: HostErrorBody;
}

export type HostEvent =
  | { type: 'host.lifecycle'; ts: string; payload: { lifecycle: HostLifecycleState; uptimeMs: number } }
  | { type: 'host.pairing-window'; ts: string; payload: { open: boolean } }
  | { type: 'mcp.status'; ts: string; payload: { serverId: string; state: string; message?: string } }
  | { type: 'mcp.tool-call'; ts: string; payload: { serverId: string; toolName: string; ok: boolean; durationMs: number } }
  | { type: 'log'; ts: string; payload: { level: 'error' | 'warn' | 'info' | 'debug'; message: string; fields?: { [key: string]: JsonValue } } };

export type HostEventType = HostEvent['type'];