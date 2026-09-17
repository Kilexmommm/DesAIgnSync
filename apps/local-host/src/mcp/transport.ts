import type { McpTransportKind } from '@desaignsync/shared-types';
import type { JsonRpcMessage } from './jsonRpc.js';

export interface TransportCloseReason {
  error?: Error;
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

/**
 * Transport abstraction so the core never depends on a concrete MCP server
 * implementation or tool naming (spec v2.1 §5 and §11).
 */
export interface McpTransport {
  readonly kind: McpTransportKind;
  /** Redacted, printable description (command + args or URL). Safe for logs and UI. */
  readonly summary: string;
  readonly pid?: number;
  start(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
  onMessage(handler: (message: unknown) => void): void;
  onClose(handler: (reason: TransportCloseReason) => void): void;
  onStderr?(handler: (line: string) => void): void;
}

export class TransportClosedError extends Error {
  readonly code: number | null | undefined;

  constructor(message: string, code?: number | null) {
    super(message);
    this.name = 'TransportClosedError';
    this.code = code ?? undefined;
  }
}