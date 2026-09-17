import { DesaignSyncHostError, type JsonObject, type McpToolDescriptor } from '@desaignsync/shared-types';
import type { McpToolGateway } from '../mcp-tool-gateway.js';
import { discoverLogicalTools, pickArgKey } from '../tool-discovery.js';
import { CHROME_LOGICAL_OPERATIONS, CHROME_TOOL_ALIASES, type ChromeLogicalOperation } from './chrome-tool-aliases.js';

export type { ChromeLogicalOperation };
export { CHROME_LOGICAL_OPERATIONS, CHROME_TOOL_ALIASES };
export interface ChromePage { id: string; title?: string; url?: string; raw: JsonObject; }
export interface ChromeSnapshot { pageId?: string; text: string; structured?: unknown; toolName: string; }
export interface ChromeCssStyles { uid: string; styles: Record<string, unknown>; rawText: string; toolName: string; }
export interface ChromeScreenshot { mimeType: string; dataBase64?: string; textFallback?: string; toolName: string; }
export interface ChromeCapabilityReport {
  serverId: string; supported: ChromeLogicalOperation[];
  unavailable: ChromeLogicalOperation[]; mapping: Partial<Record<ChromeLogicalOperation, string>>;
  discoveredAt: string;
}
export type ChromeToolOverride = Partial<Record<ChromeLogicalOperation, string>>;

/** Observation-only Chrome DevTools MCP adapter (DS-005, spec v2.1 §10). */
export class ChromeMCPAdapter {
  readonly #gateway: McpToolGateway;
  readonly #overrides: ChromeToolOverride;
  constructor(gateway: McpToolGateway, overrides: ChromeToolOverride = {}) {
    this.#gateway = gateway;
    this.#overrides = overrides;
  }
  get serverId(): string { return this.#gateway.serverId; }
  describeTools(): McpToolDescriptor[] { return this.#gateway.listTools(); }
  capabilityReport(): ChromeCapabilityReport {
    const d = discoverLogicalTools(this.#gateway.listToolNames(), CHROME_LOGICAL_OPERATIONS, CHROME_TOOL_ALIASES, this.#overrides);
    return { serverId: this.#gateway.serverId, supported: [...d.supported], unavailable: [...d.unavailable], mapping: { ...d.mapping }, discoveredAt: new Date().toISOString() };
  }
  #resolve(operation: ChromeLogicalOperation): string {
    const d = discoverLogicalTools(this.#gateway.listToolNames(), CHROME_LOGICAL_OPERATIONS, CHROME_TOOL_ALIASES, this.#overrides);
    const tool = d.mapping[operation];
    if (tool === undefined) {
      throw new DesaignSyncHostError('CHROME_MCP_UNAVAILABLE',
        `Chrome MCP server "${this.#gateway.serverId}" does not expose "${operation}" (looked for ${CHROME_TOOL_ALIASES[operation].join(', ')}).`,
        { details: { serverId: this.#gateway.serverId, operation, availableTools: this.#gateway.listToolNames() } });
    }
    return tool;
  }
  async #call(operation: ChromeLogicalOperation, args: JsonObject, timeoutMs?: number) {
    const toolName = this.#resolve(operation);
    const outcome = await this.#gateway.callTool(toolName, args, ...(timeoutMs === undefined ? [] : [timeoutMs]));
    if (!outcome.ok) {
      throw new DesaignSyncHostError('CHROME_MCP_UNAVAILABLE',
        outcome.error?.message ?? `Chrome MCP tool "${toolName}" failed for "${operation}".`,
        { retryable: outcome.error?.retryable ?? false, details: { serverId: this.#gateway.serverId, operation, toolName } });
    }
    return { toolName, outcome };
  }
  async selectPage(pageId: string, timeoutMs?: number): Promise<{ pageId: string; toolName: string }> {
    const toolName = this.#resolve('select_page');
    const key = pickArgKey(this.#gateway.findTool(toolName), ['pageId', 'tabId', 'targetId', 'id', 'index'], 'pageId');
    const { outcome } = await this.#call('select_page', { [key]: pageId }, timeoutMs);
    void outcome;
    return { pageId, toolName };
  }
  async takeSnapshot(pageId?: string, timeoutMs?: number): Promise<ChromeSnapshot> {
    const toolName = this.#resolve('take_snapshot');
    const args: JsonObject = {};
    if (pageId !== undefined) args[pickArgKey(this.#gateway.findTool(toolName), ['pageId', 'tabId', 'targetId', 'id'], 'pageId')] = pageId;
    const { outcome } = await this.#call('take_snapshot', args, timeoutMs);
    return { ...(pageId !== undefined ? { pageId } : {}), text: joinText(outcome.content),
      ...(outcome.structuredContent !== undefined ? { structured: outcome.structuredContent } : {}), toolName };
  }
  async getCssStyles(uid: string, timeoutMs?: number): Promise<ChromeCssStyles> {
    const toolName = this.#resolve('get_css_styles');
    const key = pickArgKey(this.#gateway.findTool(toolName), ['uid', 'nodeId', 'backendNodeId', 'elementId', 'selector'], 'uid');
    const { outcome } = await this.#call('get_css_styles', { [key]: uid }, timeoutMs);
    const payload = firstStructuredPayload(outcome.structuredContent, outcome.content);
    return { uid, styles: toRecord(payload) ?? {}, rawText: joinText(outcome.content), toolName };
  }
  async evaluateScript(expression: string, extraArgs: JsonObject = {}, timeoutMs?: number) {
    const toolName = this.#resolve('evaluate_script');
    const key = pickArgKey(this.#gateway.findTool(toolName), ['expression', 'script', 'code', 'js', 'source'], 'expression');
    const { outcome } = await this.#call('evaluate_script', { [key]: expression, ...extraArgs }, timeoutMs);
    return { expression, text: joinText(outcome.content),
      ...(outcome.structuredContent !== undefined ? { structured: outcome.structuredContent } : {}), toolName };
  }
  async takeScreenshot(options: { uid?: string; fullPage?: boolean } = {}, timeoutMs?: number): Promise<ChromeScreenshot> {
    const toolName = this.#resolve('take_screenshot');
    const descriptor = this.#gateway.findTool(toolName);
    const args: JsonObject = {};
    if (options.uid !== undefined) args[pickArgKey(descriptor, ['uid', 'nodeId', 'elementId', 'targetId'], 'uid')] = options.uid;
    if (options.fullPage !== undefined) args['fullPage'] = options.fullPage;
    const { outcome } = await this.#call('take_screenshot', args, timeoutMs);
    const image = outcome.content.find((b) => b.type === 'image' && typeof b.data === 'string');
    const mimeType = (typeof image?.mimeType === 'string' && image.mimeType) || 'image/png';
    return { mimeType, ...(image?.data !== undefined ? { dataBase64: image.data } : {}),
      ...(image?.data === undefined ? { textFallback: joinText(outcome.content) } : {}), toolName };
  }
  async listPages(timeoutMs?: number): Promise<ChromePage[]> {
    const { outcome } = await this.#call('list_pages', {}, timeoutMs);
    return normalizePages(firstStructuredPayload(outcome.structuredContent, outcome.content));
  }
}
  const joinText = (content: Array<{ text?: string }>): string =>
  content.map((b) => (typeof b.text === 'string' ? b.text : '')).filter((t) => t.length > 0).join('\n');
const tryParseJson = (text: string): unknown => {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
  try { return JSON.parse(t) as unknown; } catch { return undefined; }
};
const firstStructuredPayload = (structured: unknown, content: Array<{ text?: string; data?: string }>): unknown => {
  if (structured !== undefined) return structured;
  for (const block of content) {
    if (typeof block.text === 'string') {
      const parsed = tryParseJson(block.text);
      if (parsed !== undefined) return parsed;
    }
  }
  return joinText(content);
};
const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['styles', 'computedStyle', 'computedStyles', 'css', 'result']) {
    const nested = record[key];
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) return nested as Record<string, unknown>;
  }
  return record;
};
const asRecordArray = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e));
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ['pages', 'tabs', 'targets', 'items', 'result']) {
      if (Array.isArray(record[key])) return asRecordArray(record[key]);
    }
  }
  return [];
};
const normalizePages = (payload: unknown): ChromePage[] => {
  const entries = asRecordArray(payload);
  return entries.map((entry, index) => {
    const id = asString(entry['id']) ?? asString(entry['pageId']) ?? asString(entry['tabId']) ?? asString(entry['targetId']) ?? `page-${index}`;
    const record: JsonObject = {};
    for (const [key, val] of Object.entries(entry)) {
      if (val === undefined) continue;
      record[key] = val as JsonObject[string];
    }
    const page: ChromePage = { id, raw: record };
    const title = asString(entry['title']);
    const url = asString(entry['url']);
    if (title !== undefined) page.title = title;
    if (url !== undefined) page.url = url;
    return page;
  });
};
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : undefined;

