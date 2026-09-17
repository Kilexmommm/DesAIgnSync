import type { JsonValue } from './common.js';

/**
 * Structured error contract returned by the Local MCP Host (spec v2.1 §20).
 * Messages are always safe to show in the Side Panel and never contain secrets.
 */
export const HOST_ERROR_CODES = [
  'HOST_NOT_READY',
  'UNAUTHORIZED',
  'FORBIDDEN_ORIGIN',
  'BAD_REQUEST',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'MCP_SERVER_NOT_FOUND',
  'MCP_CONNECT_FAILED',
  'MCP_TOOL_NOT_FOUND',
  'MCP_TIMEOUT',
  'MCP_PROTOCOL_ERROR',
  'MCP_SERVER_CRASHED',
  'CHROME_MCP_UNAVAILABLE',
  'DESIGN_SYSTEM_UNAVAILABLE',
  'DESIGN_SYSTEM_CAPABILITY_MISSING',
  'LLM_PROVIDER_NOT_CONFIGURED',
  'LLM_AUTH_FAILED',
  'LLM_TIMEOUT',
  'LLM_BAD_RESPONSE',
  'SECRET_STORE_UNAVAILABLE',
  'CONFIG_INVALID',
  'INSPECTION_FAILED',
  'INTERNAL'
] as const;

export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

export interface HostErrorBody {
  code: HostErrorCode;
  /** Safe, human readable message. Never contains secrets or page content. */
  message: string;
  /** Optional structured, non-sensitive context (server id, tool name, ...). */
  details?: { [key: string]: JsonValue };
  retryable: boolean;
  correlationId: string;
}

export class DesaignSyncHostError extends Error {
  readonly code: HostErrorCode;
  readonly retryable: boolean;
  readonly details?: { [key: string]: JsonValue };

  constructor(
    code: HostErrorCode,
    message: string,
    options: { retryable?: boolean; details?: { [key: string]: JsonValue } } = {}
  ) {
    super(message);
    this.name = 'DesaignSyncHostError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export const isHostErrorCode = (value: unknown): value is HostErrorCode =>
  typeof value === 'string' && (HOST_ERROR_CODES as readonly string[]).includes(value);
