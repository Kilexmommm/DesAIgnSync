/**
 * Matching contracts (DS-014, spec v2.1 §12).
 *
 * A match is always an inference: deterministic signals produce a calibrated confidence,
 * the LLM is one optional signal among many, and `no reliable match` is a valid outcome.
 * Measured facts never get a confidence; only the candidate ranking does.
 */

export const MATCH_SCHEMA_VERSION = 1;

export const MATCH_SIGNALS = [
  'semantic',
  'structure',
  'attributes',
  'classes',
  'css',
  'geometry',
  'vision',
  'docs',
  'llm'
] as const;

export type MatchSignal = (typeof MATCH_SIGNALS)[number];

export interface MatchSignalContribution {
  signal: MatchSignal;
  /** 0..1 agreement between the observed evidence and the Design System reference. */
  score: number;
  /** Normalized weight actually applied after renormalization. */
  weight: number;
  /** score * weight, i.e. this signal's share of the final confidence. */
  weighted: number;
  /** True when the signal had no usable data and was excluded from the sum. */
  unavailable?: boolean;
  notes?: string;
}

export const MATCH_OUTCOMES = ['primary', 'inferred', 'review', 'no-reliable-match'] as const;

export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

export interface ComponentCandidateMatch {
  componentId: string;
  componentName: string;
  variantName?: string;
  sourceMcp: string;
  signatureId?: string;
  /** Calibrated 0..1 confidence. Never presented as certainty. */
  confidence: number;
  /**
   * Share of the weighted signal budget that had usable data (0..1).
   * Confidence is scaled by coverage, so a single signal can never reach 100%.
   */
  evidenceCoverage?: number;
  breakdown: MatchSignalContribution[];
  evidenceRefs: string[];
  reasons: string[];
  /** Strong native-semantics contradiction (e.g. a div styled as a Button). */
  contradiction?: boolean;
  /** Present only when the LLM contributed; clearly separated from deterministic signals. */
  llmInterpretation?: string;
}

export interface MatchResult {
  schemaVersion: number;
  pageId?: number;
  uid?: string;
  outcome: MatchOutcome;
  /** Confidence of `selected`; undefined when there is no reliable match. */
  confidence?: number;
  selected?: ComponentCandidateMatch;
  candidates: ComponentCandidateMatch[];
  /** Effective minimum confidence used to select a candidate. */
  minConfidence: number;
  evaluatedAt: string;
  llmUsed: boolean;
  notes: string[];
  evidenceRefs: string[];
}

/** Default confidence bands (spec v2.1 §12.2). */
export const DEFAULT_CONFIDENCE_THRESHOLDS = {
  primary: 0.85,
  inferred: 0.65,
  review: 0.4
} as const;

/**
 * Optional LLM ranking hint. It is treated as one signal with a bounded weight,
 * so it can break ties but never identify a component on its own (AC-22).
 */
export interface LlmMatchHint {
  signatureId?: string;
  componentId?: string;
  /** 0..1 confidence proposed by the model for this candidate. */
  score: number;
  rationale?: string;
}

export type LlmMatchHints = LlmMatchHint[];
