import type { JsonObject, JsonValue } from './common.js';
import type { HostErrorBody } from './errors.js';

/** Minimal, spec-compliant MCP client surface used by the Local MCP Host (spec v2.1 §7). */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  MCP_PROTOCOL_VERSION,
  '2025-03-26',
  '2024-11-05'
];

export type McpConnectionState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'error';

export interface McpContentBlock {
  type: 'text' | 'image' | 'resource' | string;
  text?: string;
  mimeType?: string;
  /** Base64 payload for image content. Kept transient, never persisted by default. */
  data?: string;
  uri?: string;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
}

export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  mimeType?: string;
  description?: string;
}

export interface McpServerCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string; title?: string };
}

export interface McpServerRuntimeStatus {
  serverId: string;
  name: string;
  transport: 'stdio' | 'streamable-http';
  /** Redacted, safe to display: no env secret values. */
  transportSummary: string;
  state: McpConnectionState;
  role: 'inspection' | 'design-system-reference' | 'generic';
  capabilities?: McpServerCapabilities;
  tools?: McpToolDescriptor[];
  connectedAt?: string;
  lastError?: HostErrorBody;
  pid?: number;
  latencyMs?: number;
  restartCount: number;
}

export interface McpToolCallRequest {
  serverId: string;
  toolName: string;
  args?: JsonObject;
  timeoutMs?: number;
}

export interface McpToolCallOutcome {
  serverId: string;
  toolName: string;
  ok: boolean;
  isError: boolean;
  content: McpContentBlock[];
  structuredContent?: JsonValue;
  durationMs: number;
  error?: HostErrorBody;
}