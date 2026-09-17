import type {
  JsonObject,
  McpToolCallOutcome,
  McpToolCallRequest,
  McpToolDescriptor
} from '@desaignsync/shared-types';

/**
 * Minimal tool surface adapters need from an MCP server connection (DS-004/DS-005).
 *
 * This is a structural interface on purpose: adapters stay decoupled from
 * `McpClientManager` (apps/local-host) and can run against any transport, stub or
 * fixture that speaks tools/list + tools/call semantics.
 */
export interface McpToolGateway {
  readonly serverId: string;
  listTools(): McpToolDescriptor[];
  listToolNames(): string[];
  findTool(name: string): McpToolDescriptor | undefined;
  callTool(toolName: string, args?: JsonObject, timeoutMs?: number): Promise<McpToolCallOutcome>;
}

/** Structural subset of `McpClientManager` the gateway bridge needs. No import. */
export interface ManagerLike {
  getStatus(serverId: string): { tools?: McpToolDescriptor[] } | undefined;
  callTool(request: McpToolCallRequest): Promise<McpToolCallOutcome>;
}

/** Bridges a connected `McpClientManager` server onto the adapter gateway surface. */
export const createManagerGateway = (manager: ManagerLike, serverId: string): McpToolGateway => ({
  serverId,
  listTools: () => manager.getStatus(serverId)?.tools ?? [],
  listToolNames: () => manager.getStatus(serverId)?.tools?.map((tool) => tool.name) ?? [],
  findTool: (name: string) => manager.getStatus(serverId)?.tools?.find((tool) => tool.name === name),
  callTool: (toolName: string, args?: JsonObject, timeoutMs?: number) =>
    manager.callTool({
      serverId,
      toolName,
      ...(args !== undefined ? { args } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    })
});
