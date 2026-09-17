/**
 * Tolerant logical-tool discovery shared by every MCP adapter (DS-005/DS-006/DS-007,
 * spec v2.1 §5 and §11.1).
 *
 * The core never depends on concrete MCP tool names: each adapter declares, per logical
 * operation, an ordered alias list (canonical name first) and resolves it against the
 * tools a server actually exposes. Name comparison is case-insensitive and ignores
 * separators (`-`, `/`, `.`, spaces), so `List_Pages`, `list-pages` and `list_pages`
 * all match.
 */

export type LogicalAliasTable<TOperation extends string> = Record<TOperation, readonly string[]>;

export interface DiscoveredTools<TOperation extends string> {
  mapping: Partial<Record<TOperation, string>>;
  supported: TOperation[];
  unavailable: TOperation[];
}

export const normalizeToolName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s./-]+/g, '_')
    .replace(/__+/g, '_');

/**
 * Resolves one logical operation to the actual tool name exposed by the server.
 * An explicit override wins when it matches a real tool; otherwise the first alias
 * (in canonical-first order) present on the server wins.
 */
export function resolveLogicalTool(
  availableToolNames: readonly string[],
  aliases: readonly string[],
  override?: string
): string | undefined {
  if (override !== undefined) {
    const hit = availableToolNames.find(
      (candidate) => normalizeToolName(candidate) === normalizeToolName(override)
    );
    if (hit !== undefined) return hit;
  }
  for (const alias of aliases) {
    const normalized = normalizeToolName(alias);
    const hit = availableToolNames.find((candidate) => normalizeToolName(candidate) === normalized);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Resolves every logical operation, splitting the result into supported/unavailable. */
export function discoverLogicalTools<TOperation extends string>(
  availableToolNames: readonly string[],
  operations: readonly TOperation[],
  aliases: LogicalAliasTable<TOperation>,
  overrides: Partial<Record<TOperation, string>> = {}
): DiscoveredTools<TOperation> {
  const mapping: Partial<Record<TOperation, string>> = {};
  const supported: TOperation[] = [];
  const unavailable: TOperation[] = [];
  for (const operation of operations) {
    const tool = resolveLogicalTool(
      availableToolNames,
      aliases[operation] ?? [],
      overrides[operation]
    );
    if (tool === undefined) {
      unavailable.push(operation);
    } else {
      supported.push(operation);
      mapping[operation] = tool;
    }
  }
  return { mapping, supported, unavailable };
}

interface SchemaHolder {
  inputSchema?: unknown;
}

/**
 * Picks the argument key a server expects for a logical input (e.g. `tabId` vs
 * `pageId`) by inspecting the tool inputSchema. Falls back when the schema is
 * absent or lists none of the candidates, so adapters keep working against
 * loosely described servers.
 */
export function pickArgKey(
  descriptor: SchemaHolder | undefined,
  candidates: readonly string[],
  fallback: string
): string {
  const schema = descriptor?.inputSchema;
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return fallback;
  const properties = (schema as Record<string, unknown>)['properties'];
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return fallback;
  }
  const byLower = new Map<string, string>();
  for (const key of Object.keys(properties)) byLower.set(key.toLowerCase(), key);
  for (const candidate of candidates) {
    const hit = byLower.get(candidate.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return fallback;
}
