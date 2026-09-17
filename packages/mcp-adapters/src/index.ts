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