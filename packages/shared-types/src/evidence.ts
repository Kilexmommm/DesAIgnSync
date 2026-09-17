import type { Box, Dimensions, EvidenceKind, JsonValue, Rectangle } from './common.js';

/**
 * Normalized evidence collected from the inspected page through Chrome DevTools MCP.
 * Read-only: this model only ever describes what is already rendered (spec v2.1 §10.1).
 * Element inference order is tag -> role/ARIA -> attributes -> hierarchy -> classes ->
 * computed CSS -> visual evidence (spec v2.1 §12.1).
 */
export interface ElementParentContext {
  tagName?: string;
  role?: string;
  classTokens?: string[];
  distance?: number;
}

export interface ElementChildSummary {
  tagName?: string;
  role?: string;
  classTokens?: string[];
}

export interface ComputedStyleEvidence {
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  padding?: Box;
  margin?: Box;
  gap?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  borderRadius?: number;
  borderWidth?: number;
  borderStyle?: string;
  boxShadow?: string;
  opacity?: number;
  display?: string;
  position?: string;
}

export interface PageElementEvidence {
  /** Schema version of this payload, mirrored in `EVIDENCE_SCHEMA_VERSION`. */
  schemaVersion: number;
  kind: EvidenceKind;
  pageId: number;
  uid?: string;
  url?: string;
  tagName?: string;
  role?: string;
  accessibleName?: string;
  textHint?: string;
  inputType?: string;
  attributes?: Record<string, string>;
  /** Raw class names exactly as observed. Kept for auditability (never dropped). */
  classNames?: string[];
  /** Semantic tokens derived by the class normalizer (DS-011). */
  normalizedClassTokens?: string[];
  parentContext?: ElementParentContext;
  childSummary?: ElementChildSummary[];
  labelRefs?: string[];
  computedStyle?: ComputedStyleEvidence;
  geometry?: Rectangle;
  viewport?: Dimensions;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  ariaState?: Record<string, string>;
  screenshotRef?: string;
  snapshotExcerpt?: string;
  collectedAt?: string;
  source?: {
    inspectionMcpId?: string;
    toolName?: string;
  };
}

/** Pointer to a stored piece of evidence. Findings reference evidence, never inline blobs. */
export interface EvidenceRef {
  id: string;
  kind: 'element' | 'css' | 'snapshot' | 'screenshot' | 'design-system' | 'rule' | 'llm';
  label: string;
  /** Provenance: which MCP/tool produced it (or `core:rules` for derived data). */
  source: string;
  jsonPointer?: string;
  meta?: { [key: string]: JsonValue };
}
