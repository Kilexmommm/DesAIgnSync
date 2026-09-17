import { DesaignSyncHostError, type HostErrorBody, type HostErrorCode } from '@desaignsync/shared-types';

const STATUS_BY_CODE: Partial<Record<HostErrorCode, number>> = {
  HOST_NOT_READY: 503,
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  MCP_SERVER_NOT_FOUND: 404,
  MCP_TOOL_NOT_FOUND: 404,
  MCP_CONNECT_FAILED: 503,
  MCP_TIMEOUT: 504,
  MCP_PROTOCOL_ERROR: 502,
  MCP_SERVER_CRASHED: 502,
  CHROME_MCP_UNAVAILABLE: 503,
  DESIGN_SYSTEM_UNAVAILABLE: 503,
  DESIGN_SYSTEM_CAPABILITY_MISSING: 503,
  LLM_PROVIDER_NOT_CONFIGURED: 503,
  LLM_AUTH_FAILED: 502,
  LLM_TIMEOUT: 504,
  LLM_BAD_RESPONSE: 502,
  SECRET_STORE_UNAVAILABLE: 503,
  CONFIG_INVALID: 400,
  INSPECTION_FAILED: 500,
  INTERNAL: 500
};

export const statusForErrorCode = (code: HostErrorCode): number => STATUS_BY_CODE[code] ?? 500;

let correlationCounter = 0;

const nextCorrelationId = (): string => {
  correlationCounter += 1;
  return `req-${Date.now().toString(36)}-${correlationCounter}`;
};

/** Converts any thrown value into a safe, structured error body (spec v2.1 §20). */
export function toErrorBody(error: unknown, correlationId?: string): HostErrorBody {
  const id = correlationId ?? nextCorrelationId();
  if (error instanceof DesaignSyncHostError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      correlationId: id,
      ...(error.details ? { details: error.details } : {})
    };
  }
  return {
    code: 'INTERNAL',
    message: 'Unexpected host error.',
    retryable: false,
    correlationId: id
  };
}