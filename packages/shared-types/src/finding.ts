import type { JsonValue } from './common.js';

/** Result of a deterministic check (spec v2.1 §15). */
export type FindingStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_EVALUATED';

export type Severity = 'info' | 'minor' | 'major' | 'critical';

export type RuleCategory =
  | 'component'
  | 'semantics'
  | 'color'
  | 'typography'
  | 'spacing'
  | 'shape'
  | 'dimensions'
  | 'accessibility';

export interface Finding {
  id: string;
  category: RuleCategory;
  status: FindingStatus;
  severity: Severity;
  /** Machine readable names, e.g. `color.background`, `typography.fontWeight`. */
  ruleId: string;
  check: string;
  observed?: JsonValue;
  expected?: JsonValue;
  difference?: JsonValue;
  tolerance?: JsonValue;
  evidenceRefs: string[];
  sourceMcpRefs?: string[];
  /** Only present when the finding depends on an inferred match. */
  matchConfidence?: number;
  explanation?: string;
  /** `true` when the value came from the LLM. Deterministic findings stay false. */
  interpretedByLlm?: boolean;
}

export type ComparisonStrategy = 'exact' | 'numeric-absolute' | 'numeric-relative' | 'color-perceptual';

export interface ToleranceSpec {
  strategy: ComparisonStrategy;
  /** Absolute delta allowed for `numeric-absolute` (e.g. 2 for spacing ±2px). */
  absolute?: number;
  /** Relative delta 0..1 allowed for `numeric-relative`. */
  relative?: number;
  /** Perceptual distance threshold 0..1 for `color-perceptual`. */
  perceptual?: number;
}

export const FINDING_STATUSES: readonly FindingStatus[] = ['PASS', 'FAIL', 'REVIEW', 'NOT_EVALUATED'];