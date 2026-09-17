import { MCP_PROTOCOL_VERSION, MCP_SUPPORTED_PROTOCOL_VERSIONS } from '@desaignsync/shared-types';
import type {
  JsonObject,
  McpConnectionState,
  McpContentBlock,
  McpResourceDescriptor,
  McpServerCapabilities,
  McpToolDescriptor
} from '@desaignsync/shared-types';

import { JsonRpcPeer, JsonRpcRemoteError, type JsonRpcNotification } from './jsonRpc.js';
import type { McpTransport, TransportCloseReason } from './transport.js';

export interface McpServerInfo {
  name?: string;
  version?: string;
  title?: string;
}

export interface McpClientOptions {
  serverId: string;
  transport: McpTransport;
  timeoutMs: number;
  clientName: string;
  clientVersion: string;
  onNotification?: (notification: JsonRpcNotification) => void;
  onTransportClose?: (reason: TransportCloseReason) => void;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  structuredContent?: unknown;
  isError: boolean;
}

interface InitializeResult {
  protocolVersion?: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: McpServerInfo;
}

const MAX_LIST_PAGES = 20;

/**
 * One MCP server session: initialize handshake, capability/tool discovery and tool calls.
 * Nothing here knows about Chrome or Storybook; adapters do that mapping (spec v2.1 §11).
 */
export class McpClient {
  readonly serverId: string;
  state: McpConnectionState = 'stopped';
  protocolVersion: string | undefined;
  serverInfo: McpServerInfo | undefined;
  capabilities: McpServerCapabilities | undefined;
  tools: McpToolDescriptor[] = [];

  readonly #peer: JsonRpcPeer;
  readonly #transport: McpTransport;
  #closeReason: TransportCloseReason | undefined;
  #userClosed = false;

  constructor(options: McpClientOptions) {
    this.serverId = options.serverId;
    this.#transport = options.transport;
    this.#peer = new JsonRpcPeer({
      send: (message) => this.#transport.send(message),
      defaultTimeoutMs: options.timeoutMs,
      idPrefix: options.serverId.slice(0, 8),
      ...(options.onNotification ? { onNotification: options.onNotification } : {})
    });
    this.#transport.onMessage((message) => this.#peer.accept(message));
    this.#transport.onClose((reason) => {
      this.#closeReason = reason;
      this.state = this.#userClosed ? 'stopped' : 'error';
      this.#peer.fail(
        new Error(
          reason.error?.message ??
            `MCP server "${this.serverId}" closed the transport${
              reason.code !== undefined && reason.code !== null ? ` (exit code ${reason.code})` : ''
            }.`
        )
      );
      options.onTransportClose?.(reason);
    });
  }

  get transport(): McpTransport {
    return this.#transport;
  }

  get closeReason(): TransportCloseReason | undefined {
    return this.#closeReason;
  }

  get pid(): number | undefined {
    return this.#transport.pid;
  }

  async connect(): Promise<void> {
    this.state = 'starting';
    this.#userClosed = false;
    await this.#transport.start();

    const result = (await this.#peer.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: false },
        sampling: {}
      },
      clientInfo: { name: 'DesAIgnSync Local Host', version: '0.1.0' }
    })) as InitializeResult | undefined;

    this.protocolVersion = result?.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.serverInfo = result?.serverInfo;
    this.capabilities = this.#mapCapabilities(result?.capabilities, result?.serverInfo);

    await this.#peer.notify('notifications/initialized');
    this.tools = await this.#discoverTools();
    this.state = 'ready';
  }

  get negotiatedVersionSupported(): boolean {
    return this.protocolVersion !== undefined
      ? MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(this.protocolVersion)
      : true;
  }

  #mapCapabilities(
    raw: Record<string, unknown> | undefined,
    serverInfo: McpServerInfo | undefined
  ): McpServerCapabilities {
    const has = (key: string): boolean => raw !== undefined && raw[key] !== undefined;
    return {
      tools: has('tools'),
      resources: has('resources'),
      prompts: has('prompts'),
      logging: has('logging'),
      ...(this.protocolVersion ? { protocolVersion: this.protocolVersion } : {}),
      ...(serverInfo ? { serverInfo } : {})
    };
  }

  async #discoverTools(): Promise<McpToolDescriptor[]> {
    if (this.capabilities?.tools === false) return [];
    const collected: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      let result: { tools?: unknown; nextCursor?: unknown };
      try {
        result = (await this.#peer.request('tools/list', cursor ? { cursor } : {})) as {
          tools?: unknown;
          nextCursor?: unknown;
        };
      } catch (error) {
        if (error instanceof JsonRpcRemoteError) return collected;
        throw error;
      }
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      for (const tool of tools) {
        const descriptor = this.#mapTool(tool);
        if (descriptor) collected.push(descriptor);
      }
      const next = result?.nextCursor;
      if (typeof next !== 'string' || next === '') break;
      cursor = next;
    }
    return collected;
  }

  #mapTool(raw: unknown): McpToolDescriptor | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate['name'] !== 'string') return undefined;
    const descriptor: McpToolDescriptor = { name: candidate['name'] };
    if (typeof candidate['description'] === 'string') descriptor.description = candidate['description'];
    if (isJsonObject(candidate['inputSchema'])) descriptor.inputSchema = candidate['inputSchema'];
    if (isJsonObject(candidate['outputSchema'])) descriptor.outputSchema = candidate['outputSchema'];
    if (isJsonObject(candidate['annotations'])) descriptor.annotations = candidate['annotations'];
    return descriptor;
  }

  /** Best effort: servers without resource support simply return an empty list. */
  async listResources(): Promise<McpResourceDescriptor[]> {
    if (this.capabilities?.resources !== true) return [];
    try {
      const result = (await this.#peer.request('resources/list', {})) as { resources?: unknown };
      if (!Array.isArray(result?.resources)) return [];
      return result.resources
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .filter((entry) => typeof entry['uri'] === 'string')
        .map((entry) => {
          const resource: McpResourceDescriptor = { uri: entry['uri'] as string };
          if (typeof entry['name'] === 'string') resource.name = entry['name'];
          if (typeof entry['mimeType'] === 'string') resource.mimeType = entry['mimeType'];
          if (typeof entry['description'] === 'string') resource.description = entry['description'];
          return resource;
        });
    } catch {
      return [];
    }
  }

  async callTool(name: string, args?: JsonObject, timeoutMs?: number): Promise<McpToolCallResult> {
    const result = (await this.#peer.request(
      'tools/call',
      { name, ...(args ? { arguments: args } : {}) },
      timeoutMs
    )) as { content?: unknown; structuredContent?: unknown; isError?: unknown } | undefined;

    const content: McpContentBlock[] = [];
    const rawContent = result?.content;
    if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (typeof block !== 'object' || block === null) continue;
        const candidate = block as Record<string, unknown>;
        const mapped: McpContentBlock = {
          type: typeof candidate['type'] === 'string' ? (candidate['type'] as string) : 'text'
        };
        if (typeof candidate['text'] === 'string') mapped.text = candidate['text'];
        if (typeof candidate['mimeType'] === 'string') mapped.mimeType = candidate['mimeType'];
        if (typeof candidate['data'] === 'string') mapped.data = candidate['data'];
        if (typeof candidate['uri'] === 'string') mapped.uri = candidate['uri'];
        content.push(mapped);
      }
    }

    return {
      content,
      ...(result?.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
      isError: result?.isError === true
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.#peer.request('ping', {}, 5_000);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.#userClosed = true;
    await this.#transport.close();
    this.#peer.fail(new Error('Client closed.'));
    if (this.state !== 'error') this.state = 'stopped';
  }
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);