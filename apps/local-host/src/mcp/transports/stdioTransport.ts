import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import { DesaignSyncHostError } from '@desaignsync/shared-types';

import type { JsonRpcMessage } from '../jsonRpc.js';
import { TransportClosedError, type McpTransport, type TransportCloseReason } from '../transport.js';

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  /** Fully resolved environment (secret values already substituted by the host). */
  env?: Record<string, string>;
  /** Grace period before SIGKILL when closing. */
  shutdownGraceMs?: number;
}

/**
 * stdio transport for local MCP servers (`npx chrome-devtools-mcp`, ...).
 * Messages are newline-delimited JSON-RPC, matching the MCP stdio framing.
 * The child is killed as a process group so grandchildren do not survive (DS-003/DS-004).
 */
export class StdioMcpTransport implements McpTransport {
  readonly kind = 'stdio' as const;
  readonly summary: string;

  #child: ChildProcess | undefined;
  #messageHandlers: Array<(message: unknown) => void> = [];
  #closeHandlers: Array<(reason: TransportCloseReason) => void> = [];
  #stderrHandlers: Array<(line: string) => void> = [];
  #closed = false;
  readonly #options: StdioTransportOptions;

  constructor(options: StdioTransportOptions) {
    this.#options = options;
    this.summary = [options.command, ...(options.args ?? [])].join(' ');
  }

  get pid(): number | undefined {
    return this.#child?.pid ?? undefined;
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#messageHandlers.push(handler);
  }

  onClose(handler: (reason: TransportCloseReason) => void): void {
    this.#closeHandlers.push(handler);
  }

  onStderr(handler: (line: string) => void): void {
    this.#stderrHandlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.#child) return;

    const isWindows = process.platform === 'win32';
    const child = spawn(this.#options.command, this.#options.args ?? [], {
      cwd: this.#options.cwd,
      env: { ...process.env, ...(this.#options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true
    });

    this.#child = child;

    child.on('error', (error) => {
      this.#emitClose({ error });
    });

    child.on('exit', (code, signal) => {
      this.#emitClose({ code, signal });
    });

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr || !child.stdin) {
      throw new DesaignSyncHostError('MCP_CONNECT_FAILED', 'Failed to open stdio pipes for the MCP server.');
    }

    const reader = createInterface({ input: stdout, crlfDelay: Infinity });
    reader.on('line', (line) => this.#handleLine(line));

    const stderrReader = createInterface({ input: stderr, crlfDelay: Infinity });
    stderrReader.on('line', (line) => {
      for (const handler of this.#stderrHandlers) handler(line);
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      child.once('spawn', () => {
        settled = true;
        resolve();
      });
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        reject(
          new DesaignSyncHostError('MCP_CONNECT_FAILED', `Cannot start MCP server: ${error.message}`, {
            details: { command: this.#options.command }
          })
        );
      });
    });
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not JSON-RPC framing: treat as diagnostic output.
      for (const handler of this.#stderrHandlers) handler(trimmed);
      return;
    }
    for (const handler of this.#messageHandlers) handler(parsed);
  }

  #emitClose(reason: TransportCloseReason): void {
    if (this.#closed) return;
    this.#closed = true;
    const handlers = this.#closeHandlers;
    this.#closeHandlers = [];
    for (const handler of handlers) handler(reason);
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const child = this.#child;
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw new TransportClosedError('MCP stdio transport is not writable.');
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin?.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) reject(new TransportClosedError(error.message));
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    const child = this.#child;
    if (!child) {
      this.#emitClose({});
      return;
    }
    const graceMs = this.#options.shutdownGraceMs ?? 2000;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });

    this.#terminate(child, 'SIGTERM', graceMs);
    const timer = new Promise<void>((resolve) => {
      const handle = setTimeout(resolve, graceMs);
      handle.unref?.();
    });
    await Promise.race([exited, timer]);
    if (child.exitCode === null && child.signalCode === null) {
      this.#terminate(child, 'SIGKILL');
      await exited;
    }
    this.#child = undefined;
    this.#emitClose({});
  }

  #terminate(child: ChildProcess, signal: NodeJS.Signals, _graceMs?: number): void {
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform !== 'win32') {
        process.kill(-pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  }
}
