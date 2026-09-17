/**
 * @desaignsync/mcp-adapters — vendor-agnostic MCP adapters.
 *
 * Ownership by wave (spec v2.1 §5, §11, §24):
 *   - src/chrome-devtools  Chrome DevTools MCP -> PageElementEvidence (DS-005, wave 2)
 *   - src/design-system    generic Design System MCP -> ComponentSignature (DS-006/013, wave 2/3)
 *   - src/storybook        Storybook MCP preset/mapping on top of the generic adapter (DS-007, wave 2)
 *
 * Adapters translate discovered MCP tools into logical operations; the core never depends on
 * concrete MCP tool names (spec v2.1 §5 and §11.1).
 */

export type {
  ComponentSignature,
  DesignSystemCandidate,
  DesignSystemComponent,
  DsCapabilityReport,
  DsLogicalOperation,
  McpServerRuntimeStatus,
  McpToolCallOutcome,
  McpToolCallRequest,
  McpToolDescriptor,
  PageElementEvidence
} from '@desaignsync/shared-types';

export { DS_LOGICAL_OPERATIONS } from '@desaignsync/shared-types';
export { ChromeMCPAdapter, CHROME_LOGICAL_OPERATIONS, CHROME_TOOL_ALIASES } from './chrome-devtools/chrome-mcp-adapter.js';
export type {
  ChromeCapabilityReport, ChromeCssStyles, ChromeLogicalOperation, ChromePage,
  ChromeScreenshot, ChromeSnapshot, ChromeToolOverride
} from './chrome-devtools/chrome-mcp-adapter.js';
export { DesignSystemMCPAdapter, DS_TOOL_ALIASES, mergeAliases } from './design-system/design-system-mcp-adapter.js';
export type { DesignSystemAdapterOptions, DsSearchQuery, DsToolOverrides } from './design-system/design-system-mcp-adapter.js';
export {
  candidateFromSignature,
  EXPECTED_SIGNATURE_FIELDS,
  SIGNATURE_SCHEMA_VERSION,
  signatureCoverage,
  signatureSearchText,
  toComponentSignature,
  toComponentSignatures
} from './design-system/componentSignature.js';
export type { SignatureOptions } from './design-system/componentSignature.js';
export { StorybookMCPAdapter, STORYBOOK_EXTRA_ALIASES, STORYBOOK_MCP_PRESET_ID, createStorybookAdapter } from './storybook/storybook-mcp-adapter.js';
export { createManagerGateway } from './mcp-tool-gateway.js';
export {
  COLLECT_EVIDENCE_MARKER,
  buildElementEvidenceExpression,
  readCollectedDescriptor
} from './chrome-devtools/elementEvidenceCollector.js';
export type { CollectedElementDescriptor } from './chrome-devtools/elementEvidenceCollector.js';
export type { ManagerLike, McpToolGateway } from './mcp-tool-gateway.js';
export { discoverLogicalTools, normalizeToolName, pickArgKey, resolveLogicalTool } from './tool-discovery.js';
export type { DiscoveredTools, LogicalAliasTable } from './tool-discovery.js';