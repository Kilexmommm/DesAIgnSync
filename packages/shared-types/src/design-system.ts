import type { Box, EvidenceKind, JsonValue } from './common.js';
import type { ComputedStyleEvidence } from './evidence.js';

/**
 * Reference values coming from the Design System MCP (spec v2.1 §11).
 * Never invent missing properties: `undefined` means "not provided by the MCP".
 */
export interface StyleReference {
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  padding?: Box;
  gap?: number;
  width?: number;
  height?: number;
  minHeight?: number;
  borderRadius?: number;
  borderWidth?: number;
  boxShadow?: string;
  opacity?: number;
}

export interface DesignSystemComponent {
  id: string;
  componentName: string;
  variantName?: string;
  description?: string;
  roles?: string[];
  props?: Record<string, JsonValue>;
  usageGuidelines?: string;
  referenceStyles?: StyleReference;
  storyOrPreviewRef?: string;
  screenshotRef?: string;
  sourceMcp: string;
}

/**
 * Normalized, comparable representation of a Design System component (DS-013).
 * Partial by design: missing data stays missing and lowers evidence coverage.
 */
export interface ComponentSignature {
  schemaVersion: number;
  id: string;
  component: string;
  variant?: string;
  /** Which MCP (server id) this signature came from. */
  sourceMcp: string;
  semanticRole?: string;
  expectedTags?: string[];
  expectedInputTypes?: string[];
  structure?: {
    childTags?: string[];
    hasLabel?: boolean;
    hasIcon?: boolean;
    wrapperTags?: string[];
  };
  props?: Record<string, JsonValue>;
  styles?: StyleReference;
  states?: string[];
  classKeywords?: string[];
  documentation?: string;
  visualReferenceRef?: string;
  /** Which fields were actually provided by the MCP, for evidence coverage. */
  providedFields: string[];
  /** Fields computed from the provided data (never invented) e.g. expectedTags from roles. */
  derivedFields?: string[];
  kind: EvidenceKind;
  retrievedAt: string;
}

/** Logical operations every Design System MCP is mapped onto (spec v2.1 §11.1). */
export const DS_LOGICAL_OPERATIONS = [
  'list_components',
  'get_component',
  'search_components',
  'get_variant_reference',
  'get_usage_guidelines'
] as const;

export type DsLogicalOperation = (typeof DS_LOGICAL_OPERATIONS)[number];

export interface DsCapabilityReport {
  serverId: string;
  supported: DsLogicalOperation[];
  unavailable: DsLogicalOperation[];
  /** Actual MCP tool names behind each logical operation (for Expert debugging). */
  mapping: Partial<Record<DsLogicalOperation, string>>;
  discoveredAt: string;
}

/** A candidate retrieved from the Design System, before/after scoring (DS-014). */
export interface DesignSystemCandidate {
  componentId: string;
  componentName: string;
  variantName?: string;
  signatureId?: string;
  sourceMcp: string;
  summary?: string;
}

export type { ComputedStyleEvidence };
