/**
 * @desaignsync/shared-types
 *
 * Single source of truth for the contracts shared by:
 *   - apps/extension        (Side Panel + bridge client)
 *   - apps/local-host       (HTTP/WS API, MCP client manager)
 *   - packages/core         (evidence, matching, rules, reporting)
 *   - packages/mcp-adapters (Chrome DevTools / Design System / Storybook)
 *
 * Ownership: Agent 1 (Architecture) is the only writer of this package.
 * Other workstreams request changes through an ADR or a small PR (spec v2.1 §26 orchestration rules).
 */

export * from './common.js';
export * from './errors.js';
export * from './evidence.js';
export * from './design-system.js';
export * from './matching.js';
export * from './finding.js';
export * from './config.js';
export * from './mcp.js';
export * from './protocol.js';