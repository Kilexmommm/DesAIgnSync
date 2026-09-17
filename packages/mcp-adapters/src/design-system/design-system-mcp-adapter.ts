import { DesaignSyncHostError, EVIDENCE_SCHEMA_VERSION } from '@desaignsync/shared-types';
import type { DesignSystemComponent, DsCapabilityReport, DsLogicalOperation, ComponentSignature, StyleReference, McpToolDescriptor, JsonObject } from '@desaignsync/shared-types';
import type { LogicalAliasTable } from '../tool-discovery.js';
import { discoverLogicalTools, pickArgKey } from '../tool-discovery.js';
import type { McpToolGateway } from '../mcp-tool-gateway.js';
import { DS_TOOL_ALIASES } from './ds-tool-aliases.js';
export type { DsLogicalOperation, DsCapabilityReport, DesignSystemComponent, ComponentSignature };
export { DS_TOOL_ALIASES };
export type DsToolOverrides = Partial<Record<DsLogicalOperation, string>>;
export interface DesignSystemAdapterOptions { overrides?: DsToolOverrides; extraAliases?: Partial<Record<DsLogicalOperation, readonly string[]>>; }
export interface DsSearchQuery { text?: string; componentName?: string; role?: string; }
const OPERATIONS: DsLogicalOperation[] = ['list_components', 'get_component', 'search_components', 'get_variant_reference', 'get_usage_guidelines'];
export const mergeAliases = (base: LogicalAliasTable<DsLogicalOperation>, extra: Partial<Record<DsLogicalOperation, readonly string[]>>): LogicalAliasTable<DsLogicalOperation> => {
  const merged = { ...base };
  for (const op of OPERATIONS) {
    const additions = extra[op] ?? [];
    const seen = new Set(merged[op].map((n) => n.toLowerCase()));
    merged[op] = [...merged[op], ...additions.filter((n) => { const l = n.toLowerCase(); if (seen.has(l)) return false; seen.add(l); return true; })];
  }
  return merged;
};
/** Generic adapter over ANY Design System MCP (DS-006, spec v2.1 §11/§11.1). */
export class DesignSystemMCPAdapter {
  readonly #gateway: McpToolGateway;
  readonly #aliases: LogicalAliasTable<DsLogicalOperation>;
  readonly #overrides: DsToolOverrides;
  constructor(gateway: McpToolGateway, options: DesignSystemAdapterOptions = {}) {
    this.#gateway = gateway;
    this.#overrides = options.overrides ?? {};
    this.#aliases = mergeAliases(DS_TOOL_ALIASES, options.extraAliases ?? {});
  }
  get serverId(): string { return this.#gateway.serverId; }
  describeTools(): McpToolDescriptor[] { return this.#gateway.listTools(); }
  aliasTable(): LogicalAliasTable<DsLogicalOperation> { return this.#aliases; }
  capabilityReport(): DsCapabilityReport {
    const d = discoverLogicalTools(this.#gateway.listToolNames(), OPERATIONS, this.#aliases, this.#overrides);
    return { serverId: this.#gateway.serverId, supported: [...d.supported], unavailable: [...d.unavailable], mapping: { ...d.mapping }, discoveredAt: new Date().toISOString() };
  }
  #resolve(operation: DsLogicalOperation): string {
    const d = discoverLogicalTools(this.#gateway.listToolNames(), OPERATIONS, this.#aliases, this.#overrides);
    const tool = d.mapping[operation];
    if (tool === undefined) {
      throw new DesaignSyncHostError('DESIGN_SYSTEM_CAPABILITY_MISSING',
        `Design System MCP "${this.#gateway.serverId}" does not expose "${operation}" (missing tool; looked for ${this.#aliases[operation].join(', ')}).`,
        { details: { serverId: this.#gateway.serverId, operation, availableTools: this.#gateway.listToolNames() } });
    }
    return tool;
  }
  async #call(operation: DsLogicalOperation, args: JsonObject, timeoutMs?: number) {
    const toolName = this.#resolve(operation);
    const outcome = await this.#gateway.callTool(toolName, args, ...(timeoutMs === undefined ? [] : [timeoutMs]));
    if (!outcome.ok) {
      throw new DesaignSyncHostError('DESIGN_SYSTEM_UNAVAILABLE',
        outcome.error?.message ?? `Design System tool "${toolName}" failed for "${operation}".`,
        { retryable: outcome.error?.retryable ?? false, details: { serverId: this.#gateway.serverId, operation, toolName } });
    }
    return { toolName, outcome };
  }
  async listComponents(timeoutMs?: number): Promise<DesignSystemComponent[]> {
    const { outcome } = await this.#call('list_components', {}, timeoutMs);
    return normalizeComponentList(firstPayload(outcome.structuredContent, outcome.content), this.#gateway.serverId);
  }
  async getComponent(componentId: string, timeoutMs?: number): Promise<DesignSystemComponent> {
    const toolName = this.#resolve('get_component');
    const key = pickArgKey(this.#gateway.findTool(toolName), ['componentId', 'component_id', 'id', 'name', 'componentName', 'slug', 'key'], 'componentId');
    const { outcome } = await this.#call('get_component', { [key]: componentId }, timeoutMs);
    const component = normalizeSingleComponent(firstPayload(outcome.structuredContent, outcome.content), this.#gateway.serverId);
    if (component === undefined) {
      throw new DesaignSyncHostError('DESIGN_SYSTEM_UNAVAILABLE', `Design System MCP "${this.#gateway.serverId}" returned no component for id "${componentId}".`,
        { details: { serverId: this.#gateway.serverId, componentId, toolName } });
    }
    return component;
  }
  async searchComponents(query: string | DsSearchQuery, timeoutMs?: number): Promise<DesignSystemComponent[]> {
    const toolName = this.#resolve('search_components');
    const descriptor = this.#gateway.findTool(toolName);
    const q: DsSearchQuery = typeof query === 'string' ? { text: query } : query;
    const args: JsonObject = {};
    args[pickArgKey(descriptor, ['query', 'q', 'text', 'search', 'term', 'keyword'], 'query')] = q.text ?? q.componentName ?? q.role ?? '';
    if (q.componentName !== undefined) args[pickArgKey(descriptor, ['componentName', 'name', 'component'], 'componentName')] = q.componentName;
    if (q.role !== undefined) args[pickArgKey(descriptor, ['role', 'semanticRole', 'kind'], 'role')] = q.role;
    const { outcome } = await this.#call('search_components', args, timeoutMs);
    return normalizeComponentList(firstPayload(outcome.structuredContent, outcome.content), this.#gateway.serverId);
  }
  async getVariantReference(componentId: string, variant?: string, timeoutMs?: number): Promise<DesignSystemComponent> {
    const toolName = this.#resolve('get_variant_reference');
    const descriptor = this.#gateway.findTool(toolName);
    const args: JsonObject = { [pickArgKey(descriptor, ['componentId', 'component_id', 'id', 'name', 'componentName', 'slug'], 'componentId')]: componentId };
    if (variant !== undefined) args[pickArgKey(descriptor, ['variant', 'variantName', 'story', 'storyId', 'storyName'], 'variant')] = variant;
    const { outcome } = await this.#call('get_variant_reference', args, timeoutMs);
    const component = normalizeSingleComponent(firstPayload(outcome.structuredContent, outcome.content), this.#gateway.serverId);
    if (component === undefined) {
      throw new DesaignSyncHostError('DESIGN_SYSTEM_UNAVAILABLE', `Design System MCP "${this.#gateway.serverId}" returned no variant reference for "${componentId}".`,
        { details: { serverId: this.#gateway.serverId, componentId, ...(variant !== undefined ? { variant } : {}), toolName } });
    }
    return component;
  }
  async getUsageGuidelines(componentId: string, timeoutMs?: number): Promise<string | undefined> {
    const toolName = this.#resolve('get_usage_guidelines');
    const key = pickArgKey(this.#gateway.findTool(toolName), ['componentId', 'component_id', 'id', 'name', 'componentName', 'slug'], 'componentId');
    const { outcome } = await this.#call('get_usage_guidelines', { [key]: componentId }, timeoutMs);
    const payload = firstPayload(outcome.structuredContent, outcome.content);
    return extractGuidelines(payload) ?? normalizeSingleComponent(payload, this.#gateway.serverId)?.usageGuidelines;
  }
  toSignature(component: DesignSystemComponent): ComponentSignature {
    const providedFields = providedFieldNames(component);
    const signature: ComponentSignature = { schemaVersion: EVIDENCE_SCHEMA_VERSION, id: component.id, component: component.componentName,
      sourceMcp: component.sourceMcp, providedFields, kind: 'observed', retrievedAt: new Date().toISOString() };
    if (component.variantName !== undefined) signature.variant = component.variantName;
    if (component.roles?.[0] !== undefined) signature.semanticRole = component.roles[0];
    if (component.props !== undefined) signature.props = component.props;
    if (component.referenceStyles !== undefined) signature.styles = component.referenceStyles;
    const documentation = component.usageGuidelines ?? component.description;
    if (documentation !== undefined) signature.documentation = documentation;
    const visualReferenceRef = component.screenshotRef ?? component.storyOrPreviewRef;
    if (visualReferenceRef !== undefined) signature.visualReferenceRef = visualReferenceRef;
    return signature;
  }
}
const tryParseJson = (text: string): unknown => {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
  try { return JSON.parse(t) as unknown; } catch { return undefined; }
};
const firstPayload = (structured: unknown, content: Array<{ text?: string }>): unknown => {
  if (structured !== undefined) return structured;
  for (const block of content) {
    if (typeof block.text === 'string') { const p = tryParseJson(block.text); if (p !== undefined) return p; }
  }
  return content.map((b) => b.text ?? '').join('\n');
};
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);
const asStringArray = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) { const items = value.filter((e): e is string => typeof e === 'string'); return items.length > 0 ? items : undefined; }
  if (typeof value === 'string' && value.length > 0) return [value];
  return undefined;
};
const candidateLists = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.map((e) => asRecord(e)).filter((e): e is Record<string, unknown> => e !== undefined);
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['components', 'items', 'results', 'stories', 'data']) {
    if (Array.isArray(record[key])) return candidateLists(record[key]);
  }
  return normalizeComponent(record, '') ? [record] : [];
};
const normalizeComponent = (record: Record<string, unknown>, sourceMcp: string): DesignSystemComponent | undefined => {
  const id = asString(record['id']) ?? asString(record['componentId']) ?? asString(record['key']) ?? asString(record['slug']) ?? asString(record['storyId']);
  const componentName = asString(record['componentName']) ?? asString(record['name']) ?? asString(record['title']);
  if (id === undefined || componentName === undefined) return undefined;
  const component: DesignSystemComponent = { id, componentName, sourceMcp };
  const variantName = asString(record['variantName']) ?? asString(record['variant']) ?? asString(record['story']);
  if (variantName !== undefined) component.variantName = variantName;
  const description = asString(record['description']);
  if (description !== undefined) component.description = description;
  const roles = asStringArray(record['roles']) ?? asStringArray(record['role']);
  if (roles !== undefined) component.roles = roles;
  const props = asRecord(record['props']) ?? asRecord(record['args']) ?? asRecord(record['argTypes']);
  if (props !== undefined) component.props = props as DesignSystemComponent['props'];
  const usageGuidelines = asString(record['usageGuidelines']) ?? asString(record['guidelines']) ?? asString(record['docs']);
  if (usageGuidelines !== undefined) component.usageGuidelines = usageGuidelines;
  const styles = normalizeStyleReference(record['referenceStyles'] ?? record['styles'] ?? record['tokens']);
  if (styles !== undefined) component.referenceStyles = styles;
  const storyOrPreviewRef = asString(record['storyOrPreviewRef']) ?? asString(record['storyId']) ?? asString(record['storyUrl']);
  if (storyOrPreviewRef !== undefined) component.storyOrPreviewRef = storyOrPreviewRef;
  const screenshotRef = asString(record['screenshotRef']) ?? asString(record['screenshot']);
  if (screenshotRef !== undefined) component.screenshotRef = screenshotRef;
  return component;
};
const STYLE_KEYS = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'gap', 'width', 'height', 'borderRadius', 'boxShadow', 'opacity'] as const;
const NUMERIC_KEYS = new Set(['fontSize', 'fontWeight', 'lineHeight', 'gap', 'width', 'height', 'borderRadius', 'opacity']);
const normalizeStyleReference = (value: unknown): StyleReference | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const styles: StyleReference = {};
  let found = false;
  for (const key of STYLE_KEYS) {
    const raw = record[key];
    if (typeof raw === 'string' || typeof raw === 'number') {
      if (NUMERIC_KEYS.has(key)) { const n = coerceNumber(raw); if (n !== undefined) { (styles as Record<string, unknown>)[key] = n; found = true; continue; } }
      (styles as Record<string, unknown>)[key] = raw;
      found = true;
    } else if (key === 'padding') {
      const box = asRecord(raw);
      if (box && typeof box['top'] === 'number' && typeof box['right'] === 'number' && typeof box['bottom'] === 'number' && typeof box['left'] === 'number') {
        styles.padding = { top: box['top'], right: box['right'], bottom: box['bottom'], left: box['left'] };
        found = true;
      }
    }
  }
  return found ? styles : undefined;
};
const coerceNumber = (value: string | number): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/);
    if (m?.[1] !== undefined) { const n = Number(m[1]); return Number.isFinite(n) ? n : undefined; }
  }
  return undefined;
};
const extractGuidelines = (payload: unknown): string | undefined => {
  if (typeof payload === 'string') return payload.length > 0 ? payload : undefined;
  const record = asRecord(payload);
  if (!record) return undefined;
  return asString(record['usageGuidelines']) ?? asString(record['guidelines']) ?? asString(record['docs']);
};
const providedFieldNames = (component: DesignSystemComponent): string[] => {
  const fields = ['id', 'componentName', 'sourceMcp'];
  if (component.variantName !== undefined) fields.push('variantName');
  if (component.description !== undefined) fields.push('description');
  if (component.roles !== undefined) fields.push('roles');
  if (component.props !== undefined) fields.push('props');
  if (component.usageGuidelines !== undefined) fields.push('usageGuidelines');
  if (component.referenceStyles !== undefined) fields.push('referenceStyles');
  if (component.storyOrPreviewRef !== undefined) fields.push('storyOrPreviewRef');
  if (component.screenshotRef !== undefined) fields.push('screenshotRef');
  return fields;
};

export const normalizeComponentList = (payload: unknown, sourceMcp: string): DesignSystemComponent[] =>
  candidateLists(payload).map((e) => normalizeComponent(e, sourceMcp)).filter((e): e is DesignSystemComponent => e !== undefined);
export const normalizeSingleComponent = (payload: unknown, sourceMcp: string): DesignSystemComponent | undefined => {
  const record = asRecord(payload);
  if (record) {
    for (const key of ['component', 'story', 'variant', 'details', 'result']) {
      const nested = asRecord(record[key]);
      if (nested) { const n = normalizeComponent(nested, sourceMcp); if (n) return n; }
    }
    const direct = normalizeComponent(record, sourceMcp);
    if (direct) return direct;
  }
  const list = candidateLists(payload);
  return list.length > 0 ? normalizeComponent(list[0] as Record<string, unknown>, sourceMcp) : undefined;
};

