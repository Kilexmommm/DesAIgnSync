import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  MATCH_SCHEMA_VERSION,
  type ComponentCandidateMatch,
  type ComponentSignature,
  type ComputedStyleEvidence,
  type LlmMatchHints,
  type MatchOutcome,
  type MatchResult,
  type MatchSignal,
  type MatchSignalContribution,
  type MatchingConfig,
  type MatchingWeights,
  type PageElementEvidence,
  type StyleReference
} from '@desaignsync/shared-types';

import { CLASS_SIGNAL_WEIGHT_CAP } from '../evidence/classNormalizer.js';

/**
 * Deterministic matching engine (DS-014, spec v2.1 §12).
 *
 * The engine ranks Design System candidates against observed element evidence. It is fully
 * explainable: every candidate carries a per-signal breakdown, and the LLM is just one
 * bounded signal. `no reliable match` is a first-class outcome — nothing is ever forced.
 */

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  semantic: 0.25,
  structure: 0.15,
  attributes: 0,
  classes: 0.1,
  css: 0.2,
  geometry: 0.1,
  vision: 0.05,
  docs: 0.05,
  llm: 0.1
};

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  weights: DEFAULT_MATCHING_WEIGHTS,
  minConfidence: DEFAULT_CONFIDENCE_THRESHOLDS.inferred,
  maxCandidates: 3
};

/**
 * Minimum share of the weighted signal budget that must have data for a candidate to reach
 * its full confidence. Without this floor, renormalization would let a single signal (e.g. an
 * LLM hint or a class name) score 100% on its own, which AC-22 forbids.
 */
export const MIN_EVIDENCE_COVERAGE = 0.6;

export interface MatchElementOptions {
  config?: Partial<MatchingConfig>;
  /** Optional LLM ranking hints; treated as a bounded signal, never authoritative. */
  llmHints?: LlmMatchHints;
  evidenceRefs?: string[];
  /** Test seam. Defaults to `new Date()`. */
  now?: () => Date;
}

interface SignalOutcome {
  score?: number;
  notes?: string;
  contradiction?: boolean;
}

interface SignalContext {
  evidence: PageElementEvidence;
  signature: ComponentSignature;
  llmHints: LlmMatchHints;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeText = (value: string | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const tokenize = (value: string | undefined): string[] =>
  normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1);

const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary']);

const ROLE_COMPATIBILITY: Record<string, string[]> = {
  button: ['button', 'link', 'menuitem', 'tab', 'switch'],
  link: ['link', 'button', 'menuitem'],
  textbox: ['textbox', 'searchbox', 'combobox'],
  searchbox: ['searchbox', 'textbox'],
  checkbox: ['checkbox', 'switch', 'radio'],
  radio: ['radio', 'checkbox'],
  switch: ['switch', 'checkbox'],
  combobox: ['combobox', 'listbox', 'textbox'],
  listbox: ['listbox', 'combobox'],
  dialog: ['dialog', 'alertdialog'],
  img: ['img'],
  heading: ['heading']
};

/** Numeric comparisons use a small absolute tolerance so sub-pixel noise never decides a match. */
const NUMERIC_TOLERANCE = 1;

const numericCloseness = (observed: number, expected: number): number => {
  const difference = Math.abs(observed - expected);
  if (difference <= NUMERIC_TOLERANCE) return 1;
  const scale = Math.max(Math.abs(observed), Math.abs(expected), 1);
  return clamp01(1 - difference / scale);
};

const normalizeColor = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '').replace(/^rgba?\(/, 'rgb(');

const colorCloseness = (observed: string, expected: string): number => {
  const left = normalizeColor(observed);
  const right = normalizeColor(expected);
  if (left === right) return 1;
  const hexLeft = toHex(left);
  const hexRight = toHex(right);
  if (hexLeft && hexRight && hexLeft === hexRight) return 1;
  return 0;
};

const toHex = (value: string): string | undefined => {
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short?.[1]) {
    return `#${short[1]
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`;
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  if (full?.[1]) return `#${full[1]}`;
  const rgb = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/i.exec(value);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) => Number.parseInt(part ?? '0', 10).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return undefined;
};

const firstFontFamily = (value: string): string =>
  value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '').toLowerCase() ?? '';

const boxAverage = (observed: { top: number; right: number; bottom: number; left: number }): number =>
  (observed.top + observed.right + observed.bottom + observed.left) / 4;

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Aspect 1 of spec §12.1: native semantics first. A native <button> therefore beats a
 * candidate whose expected tags are a different interactive element, no matter the styles.
 */
const scoreSemantic = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const expectedTags = (signature.expectedTags ?? []).map((tag) => tag.toLowerCase());
  const expectedInputTypes = (signature.expectedInputTypes ?? []).map((type) => type.toLowerCase());
  const expectedRole = signature.semanticRole?.toLowerCase();
  const tag = evidence.tagName?.toLowerCase();
  const evidenceRole = evidence.role?.toLowerCase();
  const inputType = evidence.inputType?.toLowerCase();

  if (expectedTags.length === 0 && expectedInputTypes.length === 0 && !expectedRole) {
    return {};
  }

  const components: number[] = [];
  const notes: string[] = [];
  let contradiction = false;

  if (tag && expectedTags.length > 0) {
    if (expectedTags.includes(tag)) {
      components.push(1);
      notes.push(`native <${tag}> matches the reference tag`);
    } else if (
      INTERACTIVE_TAGS.has(tag) &&
      expectedTags.some((expected) => INTERACTIVE_TAGS.has(expected))
    ) {
      components.push(0);
      contradiction = true;
      notes.push(`native <${tag}> contradicts the expected <${expectedTags.join('/')}>`);
    } else {
      components.push(0.2);
      notes.push(`native <${tag}> is not among the expected tags`);
    }
  }

  if (evidenceRole && expectedRole) {
    if (evidenceRole === expectedRole) {
      components.push(1);
      notes.push(`role "${evidenceRole}" matches the reference role`);
    } else if ((ROLE_COMPATIBILITY[expectedRole] ?? [expectedRole]).includes(evidenceRole)) {
      components.push(0.6);
      notes.push(`role "${evidenceRole}" is compatible with "${expectedRole}"`);
    } else {
      components.push(0);
      contradiction = true;
      notes.push(`role "${evidenceRole}" contradicts the reference role "${expectedRole}"`);
    }
  }

  if (inputType && expectedInputTypes.length > 0) {
    components.push(expectedInputTypes.includes(inputType) ? 1 : 0.3);
  }

  if (components.length === 0) return {};
  return {
    score: average(components),
    notes: notes.join('; '),
    ...(contradiction ? { contradiction: true } : {})
  };
};

const scoreStructure = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const structure = signature.structure;
  if (!structure) return {};

  const childTags = new Set(
    (evidence.childSummary ?? [])
      .map((child) => child.tagName?.toLowerCase())
      .filter((tag): tag is string => typeof tag === 'string')
  );
  const hasIcon =
    ['svg', 'img', 'i'].some((tag) => childTags.has(tag)) ||
    (evidence.normalizedClassTokens ?? []).includes('icon');
  const hasLabel =
    (evidence.labelRefs?.length ?? 0) > 0 ||
    (evidence.attributes?.['aria-label'] ?? '').trim() !== '';

  const checks: number[] = [];
  const notes: string[] = [];

  // A check only counts when the evidence actually contains data about it: absence of a field
  // means "unknown", and unknown must never be scored as agreement.
  const canInspectLabel = evidence.attributes !== undefined || evidence.labelRefs !== undefined;
  const canInspectChildren = evidence.childSummary !== undefined;

  if (structure.hasLabel !== undefined && canInspectLabel) {
    checks.push(structure.hasLabel === hasLabel ? 1 : 0.5);
    notes.push(
      `label ${hasLabel ? 'present' : 'absent'} (reference: ${structure.hasLabel ? 'required' : 'not expected'})`
    );
  }
  if (structure.hasIcon !== undefined && canInspectChildren) {
    checks.push(structure.hasIcon === hasIcon ? 1 : 0.5);
  }
  if (structure.childTags && structure.childTags.length > 0 && childTags.size > 0) {
    const expected = structure.childTags.map((tag) => tag.toLowerCase());
    const overlap = expected.filter((tag) => childTags.has(tag)).length;
    checks.push(overlap / expected.length);
  }

  if (checks.length === 0) return {};
  return { score: average(checks), notes: notes.join('; ') };
};

/**
 * Aspect 3: attributes/ARIA. Flags states the observed element exhibits that the reference
 * does not declare, instead of demanding that states be present.
 */
const scoreAttributes = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const declared = new Set((signature.states ?? []).map((state) => state.toLowerCase()));
  if (declared.size === 0) return {};

  const observed = new Set<string>();
  if (evidence.disabled === true) observed.add('disabled');
  if (evidence.readOnly === true) observed.add('readonly');
  if (evidence.required === true) observed.add('required');
  for (const key of Object.keys(evidence.ariaState ?? {})) {
    observed.add(key.replace(/^aria-/, '').toLowerCase());
  }
  if (observed.size === 0) return {};

  const undeclared = [...observed].filter((state) => !declared.has(state));
  if (undeclared.length === 0) {
    return { score: 1, notes: `observed states are declared by the reference (${[...observed].join(', ')})` };
  }
  return {
    score: clamp01(1 - undeclared.length / observed.size),
    notes: `states not declared by the reference: ${undeclared.join(', ')}`
  };
};

/** Classes are capped secondary evidence: they can corroborate, never identify (AC-22). */
const scoreClasses = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const observed = new Set(evidence.normalizedClassTokens ?? []);
  const expected = signature.classKeywords ?? [];
  if (observed.size === 0 || expected.length === 0) return {};

  const matched = expected.filter((token) => observed.has(token));
  if (matched.length === 0) {
    return { score: 0, notes: 'no normalized class token overlap' };
  }
  return {
    score: clamp01(matched.length / Math.min(expected.length, 3)),
    notes: `matched class tokens: ${matched.join(', ')}`
  };
};

interface StyleComparison {
  key: string;
  score: number;
}

const compareStyles = (observed: ComputedStyleEvidence, expected: StyleReference): StyleComparison[] => {
  const comparisons: StyleComparison[] = [];

  const numericKeys = [
    'fontSize',
    'fontWeight',
    'lineHeight',
    'borderRadius',
    'borderWidth',
    'opacity',
    'gap',
    'height',
    'width',
    'minHeight'
  ] as const;
  for (const key of numericKeys) {
    const left = observed[key];
    const right = expected[key];
    if (typeof left === 'number' && typeof right === 'number') {
      comparisons.push({ key: `css.${key}`, score: numericCloseness(left, right) });
    }
  }

  const colorKeys = ['color', 'backgroundColor', 'borderColor'] as const;
  for (const key of colorKeys) {
    const left = observed[key];
    const right = expected[key];
    if (typeof left === 'string' && typeof right === 'string') {
      comparisons.push({ key: `css.${key}`, score: colorCloseness(left, right) });
    }
  }

  if (typeof observed.fontFamily === 'string' && typeof expected.fontFamily === 'string') {
    comparisons.push({
      key: 'css.fontFamily',
      score: firstFontFamily(observed.fontFamily) === firstFontFamily(expected.fontFamily) ? 1 : 0
    });
  }
  if (typeof observed.boxShadow === 'string' && typeof expected.boxShadow === 'string') {
    comparisons.push({
      key: 'css.boxShadow',
      score: normalizeText(observed.boxShadow) === normalizeText(expected.boxShadow) ? 1 : 0
    });
  }
  if (observed.padding && expected.padding) {
    comparisons.push({
      key: 'css.padding',
      score: numericCloseness(boxAverage(observed.padding), boxAverage(expected.padding))
    });
  }

  return comparisons;
};

const scoreCss = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const observed = evidence.computedStyle;
  const expected = signature.styles;
  if (!observed || !expected) return {};

  const comparisons = compareStyles(observed, expected);
  if (comparisons.length === 0) return {};

  const diverging = comparisons.filter((comparison) => comparison.score < 0.9).map((comparison) => comparison.key);
  return {
    score: average(comparisons.map((comparison) => comparison.score)),
    notes:
      diverging.length === 0
        ? 'all comparable styles agree'
        : `style differences in ${diverging.join(', ')}`
  };
};

const scoreGeometry = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const comparisons: number[] = [];
  const height = evidence.computedStyle?.height ?? evidence.geometry?.height;
  const width = evidence.computedStyle?.width ?? evidence.geometry?.width;
  const expectedHeight = signature.styles?.height;
  const expectedWidth = signature.styles?.width;

  if (typeof height === 'number' && typeof expectedHeight === 'number') {
    comparisons.push(numericCloseness(height, expectedHeight));
  }
  if (typeof width === 'number' && typeof expectedWidth === 'number') {
    comparisons.push(numericCloseness(width, expectedWidth));
  }
  if (comparisons.length === 0) return {};
  return { score: average(comparisons) };
};

const scoreDocs = ({ evidence, signature }: SignalContext): SignalOutcome => {
  const docs = tokenize(signature.documentation);
  const elementTokens = new Set([
    ...tokenize(evidence.accessibleName),
    ...tokenize(evidence.textHint),
    ...tokenize(evidence.attributes?.['placeholder'])
  ]);
  if (docs.length === 0 || elementTokens.size === 0) return {};

  const overlap = docs.filter((token) => elementTokens.has(token)).length;
  return {
    score: clamp01(overlap / Math.min(docs.length, 5)),
    notes: overlap > 0 ? 'documentation shares terms with the element' : 'no documentation overlap'
  };
};

const scoreLlm = ({ signature, llmHints }: SignalContext): SignalOutcome => {
  const hint = llmHints.find(
    (entry) =>
      (entry.signatureId !== undefined && entry.signatureId === signature.id) ||
      (entry.componentId !== undefined && entry.componentId === signature.component)
  );
  if (!hint) return {};
  return {
    score: clamp01(hint.score),
    notes: hint.rationale ?? 'LLM ranking hint (bounded signal)'
  };
};

/** Vision needs a vision-capable model (DS-026) and is reported as unavailable, never faked. */
const scoreVision = (): SignalOutcome => ({
  notes: 'visual comparison not available in this engine'
});

const SIGNAL_SCORERS: Record<MatchSignal, (context: SignalContext) => SignalOutcome> = {
  semantic: scoreSemantic,
  structure: scoreStructure,
  attributes: scoreAttributes,
  classes: scoreClasses,
  css: scoreCss,
  geometry: scoreGeometry,
  vision: scoreVision,
  docs: scoreDocs,
  llm: scoreLlm
};

export const SIGNAL_ORDER: readonly MatchSignal[] = [
  'semantic',
  'structure',
  'attributes',
  'classes',
  'css',
  'geometry',
  'vision',
  'docs',
  'llm'
];

const resolveWeights = (weights: Partial<MatchingWeights> | undefined): MatchingWeights => {
  const merged: MatchingWeights = { ...DEFAULT_MATCHING_WEIGHTS, ...(weights ?? {}) };
  // Hard cap: semantic class names can never dominate a match (spec §12, AC-22).
  merged.classes = Math.min(Math.max(merged.classes, 0), CLASS_SIGNAL_WEIGHT_CAP);
  return merged;
};

export const resolveMatchingConfig = (config: Partial<MatchingConfig> | undefined): MatchingConfig => ({
  weights: resolveWeights(config?.weights),
  minConfidence: config?.minConfidence ?? DEFAULT_MATCHING_CONFIG.minConfidence,
  maxCandidates: config?.maxCandidates ?? DEFAULT_MATCHING_CONFIG.maxCandidates
});

const scoreCandidate = (
  signature: ComponentSignature,
  context: Omit<SignalContext, 'signature'>,
  weights: MatchingWeights
): ComponentCandidateMatch => {
  const signalContext: SignalContext = { ...context, signature };
  const breakdown: MatchSignalContribution[] = [];
  const reasons: string[] = [];
  let contradiction = false;
  let llmInterpretation: string | undefined;

  for (const signal of SIGNAL_ORDER) {
    const outcome = SIGNAL_SCORERS[signal](signalContext);
    if (outcome.contradiction === true) contradiction = true;

    if (outcome.score === undefined) {
      breakdown.push({
        signal,
        score: 0,
        weight: 0,
        weighted: 0,
        unavailable: true,
        ...(outcome.notes ? { notes: outcome.notes } : {})
      });
      continue;
    }
    breakdown.push({
      signal,
      score: outcome.score,
      weight: weights[signal],
      weighted: 0,
      ...(outcome.notes ? { notes: outcome.notes } : {})
    });
    if (signal === 'llm' && outcome.notes) llmInterpretation = outcome.notes;
  }

  const available = breakdown.filter((entry) => entry.unavailable !== true);
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  const coverage = Math.round(Math.min(1, totalWeight) * 1000) / 1000;

  let confidence = 0;
  if (totalWeight > 0) {
    for (const entry of available) {
      entry.weight = entry.weight / totalWeight;
      entry.weighted = entry.score * entry.weight;
      confidence += entry.weighted;
    }
  }

  // Confidence is scaled by how much evidence actually existed (never redistributed for free).
  const coveragePenalty = Math.min(1, totalWeight / MIN_EVIDENCE_COVERAGE);
  if (coveragePenalty < 1) {
    confidence *= coveragePenalty;
    for (const entry of available) entry.weighted *= coveragePenalty;
    reasons.push(`confidence scaled by evidence coverage (${coverage.toFixed(2)} of ${MIN_EVIDENCE_COVERAGE})`);
  }

  if (contradiction) {
    confidence *= 0.5;
    for (const entry of available) entry.weighted *= 0.5;
    reasons.push('strong semantic contradiction between native semantics and the reference');
  }

  for (const entry of [...available].sort((left, right) => right.weighted - left.weighted).slice(0, 3)) {
    if (entry.score >= 0.8 && entry.notes) reasons.push(`${entry.signal}: ${entry.notes}`);
  }

  return {
    componentId: signature.id,
    componentName: signature.component,
    ...(signature.variant ? { variantName: signature.variant } : {}),
    sourceMcp: signature.sourceMcp,
    signatureId: signature.id,
    confidence: Math.round(clamp01(confidence) * 1000) / 1000,
    evidenceCoverage: coverage,
    breakdown,
    evidenceRefs: [],
    reasons,
    ...(contradiction ? { contradiction: true } : {}),
    ...(llmInterpretation ? { llmInterpretation } : {})
  };
};

const compareCandidates = (left: ComponentCandidateMatch, right: ComponentCandidateMatch): number => {
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  const semanticOf = (candidate: ComponentCandidateMatch): number =>
    candidate.breakdown.find((entry) => entry.signal === 'semantic')?.score ?? 0;
  if (semanticOf(right) !== semanticOf(left)) return semanticOf(right) - semanticOf(left);
  return left.componentName.localeCompare(right.componentName);
};

/**
 * Ranks Design System candidates for one observed element.
 * `no reliable match` is returned when nothing clears the review threshold (spec §12.2).
 */
export function matchElement(
  evidence: PageElementEvidence,
  candidates: readonly ComponentSignature[],
  options: MatchElementOptions = {}
): MatchResult {
  const config = resolveMatchingConfig(options.config);
  const llmHints = options.llmHints ?? [];
  const evaluatedAt = (options.now ?? (() => new Date()))().toISOString();
  const notes: string[] = [];

  if (candidates.length === 0) {
    notes.push('no Design System candidates were provided for this element');
    return {
      schemaVersion: MATCH_SCHEMA_VERSION,
      pageId: evidence.pageId,
      ...(evidence.uid ? { uid: evidence.uid } : {}),
      outcome: 'no-reliable-match',
      candidates: [],
      minConfidence: config.minConfidence,
      evaluatedAt,
      llmUsed: llmHints.length > 0,
      notes,
      evidenceRefs: options.evidenceRefs ?? []
    };
  }

  const ranked = candidates
    .map((signature) => scoreCandidate(signature, { evidence, llmHints }, config.weights))
    .sort(compareCandidates)
    .slice(0, Math.max(1, config.maxCandidates))
    .map((candidate) => ({ ...candidate, evidenceRefs: options.evidenceRefs ?? [] }));

  const best = ranked[0];
  const bestConfidence = best?.confidence ?? 0;

  let outcome: MatchOutcome = 'no-reliable-match';
  if (bestConfidence >= DEFAULT_CONFIDENCE_THRESHOLDS.primary) outcome = 'primary';
  else if (bestConfidence >= DEFAULT_CONFIDENCE_THRESHOLDS.inferred) outcome = 'inferred';
  else if (bestConfidence >= DEFAULT_CONFIDENCE_THRESHOLDS.review) outcome = 'review';

  if (outcome === 'no-reliable-match') {
    notes.push(
      `no reliable match: best candidate scored ${bestConfidence.toFixed(2)} (review threshold ${DEFAULT_CONFIDENCE_THRESHOLDS.review})`
    );
  }
  if (bestConfidence < config.minConfidence && outcome !== 'no-reliable-match') {
    notes.push(
      `best candidate scored ${bestConfidence.toFixed(2)}, below the configured minimum ${config.minConfidence}`
    );
    outcome = 'no-reliable-match';
  }

  const unavailableSignals = [
    ...new Set(
      ranked
        .flatMap((candidate) => candidate.breakdown.filter((entry) => entry.unavailable === true))
        .map((entry) => entry.signal)
    )
  ];
  if (unavailableSignals.length > 0) {
    notes.push(`signals without data: ${unavailableSignals.join(', ')}`);
  }

  const selected = outcome === 'no-reliable-match' ? undefined : best;
  if (unavailableSignals.includes('vision')) {
    notes.push('screenshots were not used for matching (vision signal unavailable)');
  }

  return {
    schemaVersion: MATCH_SCHEMA_VERSION,
    pageId: evidence.pageId,
    ...(evidence.uid ? { uid: evidence.uid } : {}),
    outcome,
    ...(selected ? { confidence: selected.confidence, selected } : {}),
    candidates: ranked,
    minConfidence: config.minConfidence,
    evaluatedAt,
    llmUsed: llmHints.length > 0,
    notes,
    evidenceRefs: options.evidenceRefs ?? []
  };
}

/** Human-readable, deterministic explanation of a match result (used by reports and Ask AI). */
export function explainMatchResult(result: MatchResult): string[] {
  const lines: string[] = [];
  if (result.selected) {
    lines.push(
      `Likely match: ${result.selected.componentName}${
        result.selected.variantName ? ` / ${result.selected.variantName}` : ''
      } - confidence ${(result.selected.confidence * 100).toFixed(0)}% (${result.outcome})`
    );
  } else {
    lines.push(`No reliable match (${result.candidates.length} candidate(s) evaluated)`);
  }
  for (const candidate of result.candidates) {
    const top = candidate.breakdown
      .filter((entry) => entry.unavailable !== true)
      .sort((left, right) => right.weighted - left.weighted)
      .slice(0, 3)
      .map((entry) => `${entry.signal} ${entry.score.toFixed(2)}x${entry.weight.toFixed(2)}`)
      .join(', ');
    lines.push(
      `  ${candidate.componentName}${candidate.variantName ? ` / ${candidate.variantName}` : ''} ` +
        `${(candidate.confidence * 100).toFixed(0)}%${top ? ` [${top}]` : ''}${
          candidate.contradiction ? ' (semantic contradiction)' : ''
        }`
    );
  }
  for (const note of result.notes) lines.push(`note: ${note}`);
  return lines;
}

/** Stateful facade so callers can keep a profile-specific configuration (DS-017). */
export class MatchingEngine {
  readonly #config: Partial<MatchingConfig>;

  constructor(config: Partial<MatchingConfig> = {}) {
    this.#config = config;
  }

  match(
    evidence: PageElementEvidence,
    candidates: readonly ComponentSignature[],
    options: MatchElementOptions = {}
  ): MatchResult {
    return matchElement(evidence, candidates, {
      ...options,
      config: { ...this.#config, ...(options.config ?? {}) }
    });
  }
}
