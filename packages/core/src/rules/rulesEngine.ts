import {
  CHECK_IDS,
  type CheckConfig,
  type CheckId,
  type ComputedStyleEvidence,
  type Finding,
  type FindingStatus,
  type JsonValue,
  type PageElementEvidence,
  type RuleCategory,
  type Severity,
  type StyleReference,
  type ToleranceSpec
} from '@desaignsync/shared-types';

import { colorsEqual, contrastRatio, firstFontFamily } from '../shared/css.js';

/**
 * Deterministic Rules Engine (DS-015, spec §15).
 *
 * Objective checks run in code, never through the LLM: colors, typography, spacing, shape,
 * dimensions and accessibility basics. Missing data yields NOT_EVALUATED — an invented FAIL is
 * never acceptable — and every finding keeps observed / expected / difference / tolerance / source.
 */

export interface RuleReference extends Partial<StyleReference> {
  role?: string;
  accessibleName?: string;
  tags?: string[];
  states?: string[];
}

export interface RuleEvaluationInput {
  evidence: PageElementEvidence;
  reference?: RuleReference;
  /** Confidence of the matched component: the component check is inferred, not measured. */
  matchConfidence?: number;
  evidenceRefs?: string[];
  sourceMcpRefs?: string[];
}

export interface RulesEngineOptions {
  /** Profile-level overrides: enabled, severity and tolerance per check (DS-017). */
  checks?: Partial<Record<CheckId, CheckConfig>>;
}

export interface CheckOutcome {
  status: FindingStatus;
  observed?: unknown;
  expected?: unknown;
  difference?: unknown;
  tolerance?: unknown;
  explanation?: string;
}

type CheckEvaluator = (input: RuleEvaluationInput, config: CheckConfig) => CheckOutcome;

interface CheckDefinition {
  id: CheckId;
  category: RuleCategory;
  check: string;
  evaluate: CheckEvaluator;
}

const exactCheck = (severity: Severity): CheckConfig => ({
  enabled: true,
  severity,
  tolerance: { strategy: 'exact' }
});

const pixelCheck = (severity: Severity, absolute: number): CheckConfig => ({
  enabled: true,
  severity,
  tolerance: { strategy: 'numeric-absolute', absolute }
});

/** Default tolerances follow spec §13.2: spacing ±2px, radius ±1px, colors/typography exact. */
export const DEFAULT_CHECKS: Record<CheckId, CheckConfig> = {
  'component.matching': exactCheck('info'),
  'color.text': exactCheck('major'),
  'color.background': exactCheck('major'),
  'color.border': exactCheck('minor'),
  'typography.fontFamily': exactCheck('major'),
  'typography.fontSize': exactCheck('major'),
  'typography.fontWeight': exactCheck('minor'),
  'typography.lineHeight': exactCheck('minor'),
  'spacing.padding': pixelCheck('minor', 2),
  'spacing.margin': pixelCheck('minor', 2),
  'spacing.gap': pixelCheck('minor', 2),
  'shape.borderRadius': pixelCheck('minor', 1),
  'shape.border': pixelCheck('minor', 1),
  'shape.shadow': exactCheck('minor'),
  'dimensions.height': pixelCheck('minor', 2),
  'dimensions.width': pixelCheck('minor', 2),
  'accessibility.role': exactCheck('critical'),
  'accessibility.name': exactCheck('major'),
  'accessibility.label': exactCheck('major'),
  'accessibility.contrast': {
    enabled: true,
    severity: 'major',
    tolerance: { strategy: 'numeric-absolute', absolute: 4.5 }
  },
  'accessibility.disabledState': exactCheck('info'),
  'accessibility.required': exactCheck('info')
};

export const RULES_ENGINE_CHECK_IDS: readonly CheckId[] = CHECK_IDS;

const notEvaluated = (explanation: string): CheckOutcome => ({ status: 'NOT_EVALUATED', explanation });

const round = (value: number): number => Math.round(value * 1000) / 1000;

const compareNumbers = (
  observed: number,
  expected: number,
  tolerance: ToleranceSpec,
  label: string
): CheckOutcome => {
  const difference = observed - expected;
  const absolute = Math.abs(difference);
  const allowed =
    tolerance.strategy === 'numeric-relative'
      ? Math.abs(expected) * (tolerance.relative ?? 0)
      : tolerance.absolute ?? 0;
  const pass = absolute <= allowed + 1e-9;
  return {
    status: pass ? 'PASS' : 'FAIL',
    observed,
    expected,
    difference: round(difference),
    tolerance: { strategy: tolerance.strategy, allowed: round(allowed) },
    explanation: pass
      ? `${label} is within tolerance (±${round(allowed)})`
      : `${label} differs by ${round(absolute)} (tolerance ±${round(allowed)})`
  };
};

const compareText = (observed: string, expected: string, label: string): CheckOutcome => {
  const pass = observed.trim().toLowerCase() === expected.trim().toLowerCase();
  return {
    status: pass ? 'PASS' : 'FAIL',
    observed,
    expected,
    difference: pass ? 0 : 'value differs',
    tolerance: { strategy: 'exact', allowed: 0 },
    explanation: pass ? `${label} matches the reference` : `${label} does not match the reference`
  };
};

/** Component choice is inferred, so this check reports confidence bands instead of a measurement. */
const checkComponentMatch: CheckEvaluator = ({ matchConfidence }) => {
  if (matchConfidence === undefined) return notEvaluated('no match confidence was produced for this element');
  if (matchConfidence >= 0.85) {
    return {
      status: 'PASS',
      observed: matchConfidence,
      expected: '>= 0.85',
      explanation: 'the Design System component match is reliable'
    };
  }
  if (matchConfidence >= 0.65) {
    return {
      status: 'REVIEW',
      observed: matchConfidence,
      expected: '>= 0.85',
      explanation: 'the component was inferred; verify the candidate before acting on findings'
    };
  }
  return {
    status: 'REVIEW',
    observed: matchConfidence,
    expected: '>= 0.65',
    explanation: 'no reliable match; validation against the Design System is limited'
  };
};

const COLOR_CHANNELS = ['color', 'backgroundColor', 'borderColor'] as const satisfies readonly (keyof ComputedStyleEvidence)[];

type ColorChannel = (typeof COLOR_CHANNELS)[number];

const checkColorChannel =
  (channel: ColorChannel, label: string): CheckEvaluator =>
  ({ evidence, reference }) => {
    const observed = evidence.computedStyle?.[channel];
    const expected = reference?.[channel];
    if (observed === undefined) return notEvaluated(`no observed ${label}`);
    if (expected === undefined) return notEvaluated(`the Design System reference does not provide ${label}`);
    const pass = colorsEqual(observed, expected);
    return {
      status: pass ? 'PASS' : 'FAIL',
      observed,
      expected,
      difference: pass ? 0 : 'colors differ',
      tolerance: { strategy: 'exact', allowed: 0 },
      explanation: pass ? `${label} matches the reference` : `${label} does not match the reference`
    };
  };

const NUMERIC_STYLE_KEYS = [
  'fontSize',
  'fontWeight',
  'lineHeight',
  'borderRadius',
  'borderWidth',
  'gap',
  'opacity',
  'width'
] as const satisfies readonly (keyof ComputedStyleEvidence)[];

type NumericStyleKey = (typeof NUMERIC_STYLE_KEYS)[number];

const checkNumericStyle =
  (key: NumericStyleKey, label: string): CheckEvaluator =>
  ({ evidence, reference }, config) => {
    const observed = evidence.computedStyle?.[key];
    const expected = reference?.[key];
    if (observed === undefined) return notEvaluated(`no observed ${label}`);
    if (expected === undefined) return notEvaluated(`the Design System reference does not provide ${label}`);
    if (typeof observed !== 'number' || typeof expected !== 'number') {
      return notEvaluated(`${label} is not numeric in the available evidence`);
    }
    return compareNumbers(observed, expected, config.tolerance, label);
  };

const checkFontFamily: CheckEvaluator = ({ evidence, reference }) => {
  const observed = evidence.computedStyle?.fontFamily;
  const expected = reference?.fontFamily;
  if (observed === undefined) return notEvaluated('no observed font family');
  if (expected === undefined) return notEvaluated('the Design System reference does not provide a font family');
  const observedFamily = firstFontFamily(observed);
  const expectedFamily = firstFontFamily(expected);
  const pass = observedFamily === expectedFamily;
  return {
    status: pass ? 'PASS' : 'FAIL',
    observed: observedFamily,
    expected: expectedFamily,
    difference: pass ? 0 : 'font family differs',
    tolerance: { strategy: 'exact', allowed: 0 },
    explanation: pass ? 'font family matches the reference' : 'font family does not match the reference'
  };
};

const checkBoxStyle =
  (key: 'padding' | 'margin', label: string): CheckEvaluator =>
  ({ evidence, reference }, config) => {
    const observed = evidence.computedStyle?.[key];
    const expected = reference?.[key];
    if (!observed) return notEvaluated(`no observed ${label}`);
    if (!expected) return notEvaluated(`the Design System reference does not provide ${label}`);

    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const maxAbsolute = Math.max(...sides.map((side) => Math.abs(observed[side] - expected[side])));
    const allowed = config.tolerance.absolute ?? 0;
    const pass = maxAbsolute <= allowed + 1e-9;
    return {
      status: pass ? 'PASS' : 'FAIL',
      observed,
      expected,
      difference: { maxAbsoluteDelta: round(maxAbsolute) },
      tolerance: { strategy: config.tolerance.strategy, allowed },
      explanation: pass
        ? `${label} is within tolerance (±${allowed}px)`
        : `${label} differs by up to ${round(maxAbsolute)}px (tolerance ±${allowed}px)`
    };
  };

const checkHeight: CheckEvaluator = ({ evidence, reference }, config) => {
  const observed = evidence.computedStyle?.height;
  const expected = reference?.height ?? reference?.minHeight;
  if (observed === undefined) return notEvaluated('no observed height');
  if (expected === undefined) return notEvaluated('the Design System reference does not provide a height');
  return compareNumbers(observed, expected, config.tolerance, 'height');
};

const checkBorder: CheckEvaluator = ({ evidence, reference }, config) => {
  const observedWidth = evidence.computedStyle?.borderWidth;
  const observedStyle = evidence.computedStyle?.borderStyle;
  const expectedWidth = reference?.borderWidth;
  const expectedStyle = reference?.borderStyle;

  if (observedWidth === undefined && observedStyle === undefined) {
    return notEvaluated('no observed border properties');
  }
  if (expectedWidth === undefined && expectedStyle === undefined) {
    return notEvaluated('the Design System reference does not provide a border');
  }

  const statuses: FindingStatus[] = [];
  if (typeof observedWidth === 'number' && typeof expectedWidth === 'number') {
    statuses.push(compareNumbers(observedWidth, expectedWidth, config.tolerance, 'border width').status);
  }
  if (typeof observedStyle === 'string' && typeof expectedStyle === 'string') {
    statuses.push(observedStyle === expectedStyle ? 'PASS' : 'FAIL');
  }
  if (statuses.length === 0) return notEvaluated('border properties are not comparable');

  const status: FindingStatus = statuses.includes('FAIL') ? 'FAIL' : 'PASS';
  return {
    status,
    observed: { width: observedWidth, style: observedStyle },
    expected: { width: expectedWidth, style: expectedStyle },
    tolerance: { strategy: 'numeric-absolute', allowed: config.tolerance.absolute ?? 0 },
    explanation: status === 'PASS' ? 'border matches the reference' : 'border differs from the reference'
  };
};

const checkShadow: CheckEvaluator = ({ evidence, reference }) => {
  const observed = evidence.computedStyle?.boxShadow;
  const expected = reference?.boxShadow;
  if (observed === undefined) return notEvaluated('no observed box-shadow');
  if (expected === undefined) return notEvaluated('the Design System reference does not provide a box-shadow');
  return compareText(
    observed.replace(/\s+/g, ' ').trim(),
    expected.replace(/\s+/g, ' ').trim(),
    'box-shadow'
  );
};

const TAGS_EXPECTING_LABEL = new Set(['input', 'select', 'textarea']);
const ROLES_EXPECTING_LABEL = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider'
]);

/**
 * Native semantics win: a div with role=button can match the role but is reported as REVIEW,
 * because the reference expects a native tag (spec §12.1).
 */
const checkRole: CheckEvaluator = ({ evidence, reference }) => {
  const expectedRole = reference?.role;
  const declaredTags = reference?.tags ?? [];
  const observedRole = evidence.role;
  const observedTag = evidence.tagName?.toLowerCase();

  if (observedRole === undefined && observedTag === undefined) {
    return notEvaluated('no role or tag was captured for this element');
  }
  if (expectedRole === undefined && declaredTags.length === 0) {
    return notEvaluated('the Design System reference does not declare an expected role');
  }

  const nativeMatch = observedTag !== undefined && declaredTags.includes(observedTag);
  const roleMatches = expectedRole !== undefined && observedRole?.toLowerCase() === expectedRole.toLowerCase();

  if (nativeMatch) {
    return {
      status: 'PASS',
      observed: { tag: observedTag, role: observedRole },
      expected: { tags: declaredTags, role: expectedRole },
      explanation: 'the native tag matches the reference'
    };
  }
  if (roleMatches) {
    return {
      status: 'REVIEW',
      observed: { tag: observedTag, role: observedRole },
      expected: { tags: declaredTags, role: expectedRole },
      explanation:
        'the role matches but the element is not the expected native tag; native semantics are preferable'
    };
  }
  return {
    status: 'FAIL',
    observed: { tag: observedTag, role: observedRole },
    expected: { tags: declaredTags, role: expectedRole },
    explanation: 'the element semantics contradict the Design System reference'
  };
};

const checkAccessibleName: CheckEvaluator = ({ evidence, reference }) => {
  const observed = evidence.accessibleName ?? evidence.attributes?.['aria-label'] ?? evidence.textHint;
  const expected = reference?.accessibleName;
  if (observed === undefined) return notEvaluated('no accessible name was captured for this element');
  if (expected === undefined) {
    if (observed.trim() === '') return notEvaluated('an empty accessible name cannot be confirmed as absent');
    return {
      status: 'PASS',
      observed,
      expected: 'non-empty accessible name',
      explanation: 'the element exposes a non-empty accessible name'
    };
  }
  return compareText(observed, expected, 'accessible name');
};

const checkLabel: CheckEvaluator = ({ evidence, reference }) => {
  const labels = evidence.labelRefs;
  const expectsLabel =
    (reference?.tags ?? []).some((tag) => TAGS_EXPECTING_LABEL.has(tag.toLowerCase())) ||
    (reference?.role !== undefined && ROLES_EXPECTING_LABEL.has(reference.role.toLowerCase()));

  if (labels === undefined) return notEvaluated('label relationships were not captured for this element');
  if (!expectsLabel) {
    return {
      status: 'PASS',
      observed: labels.length,
      expected: 'no label required',
      explanation: 'the reference does not require an associated label'
    };
  }
  if (labels.length === 0) {
    return {
      status: 'FAIL',
      observed: 0,
      expected: '>= 1 associated label',
      explanation: 'the reference requires a label but none is associated with the element'
    };
  }
  return {
    status: 'PASS',
    observed: labels.length,
    expected: '>= 1 associated label',
    explanation: 'an associated label was found'
  };
};

const checkContrast: CheckEvaluator = ({ evidence }, config) => {
  const foreground = evidence.computedStyle?.color;
  const background = evidence.computedStyle?.backgroundColor;
  const minimum = config.tolerance.absolute ?? 4.5;
  if (foreground === undefined || background === undefined) {
    return notEvaluated('text or background color is missing, so contrast cannot be computed');
  }
  const ratio = contrastRatio(foreground, background);
  if (ratio === undefined) return notEvaluated('colors could not be parsed for a WCAG contrast ratio');

  const pass = ratio >= minimum;
  return {
    status: pass ? 'PASS' : 'FAIL',
    observed: { ratio, foreground, background },
    expected: { minRatio: minimum },
    difference: round(ratio - minimum),
    tolerance: { strategy: 'numeric-absolute', allowed: minimum },
    explanation: pass
      ? `contrast ratio ${ratio}:1 meets the minimum ${minimum}:1`
      : `contrast ratio ${ratio}:1 is below the minimum ${minimum}:1`
  };
};

const checkState =
  (state: 'disabled' | 'required', key: 'disabled' | 'required'): CheckEvaluator =>
  ({ evidence, reference }) => {
    const observed = evidence[key];
    const declared = (reference?.states ?? []).some((entry) => entry.toLowerCase() === state);
    if (observed === undefined) return notEvaluated(`the ${state} state was not captured`);

    if (observed === true && !declared) {
      return {
        status: 'FAIL',
        observed: true,
        expected: `${state} is not declared by the reference`,
        explanation: `the element is ${state} but the component does not declare that state`
      };
    }
    return {
      status: 'PASS',
      observed,
      expected: { declared },
      explanation: declared
        ? `the ${state} state is declared by the reference`
        : `the element is not ${state} and the reference does not declare it`
    };
  };

export const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  { id: 'component.matching', category: 'component', check: 'Component match', evaluate: checkComponentMatch },
  { id: 'color.text', category: 'color', check: 'Text color', evaluate: checkColorChannel('color', 'text color') },
  {
    id: 'color.background',
    category: 'color',
    check: 'Background color',
    evaluate: checkColorChannel('backgroundColor', 'background color')
  },
  {
    id: 'color.border',
    category: 'color',
    check: 'Border color',
    evaluate: checkColorChannel('borderColor', 'border color')
  },
  {
    id: 'typography.fontFamily',
    category: 'typography',
    check: 'Font family',
    evaluate: checkFontFamily
  },
  {
    id: 'typography.fontSize',
    category: 'typography',
    check: 'Font size',
    evaluate: checkNumericStyle('fontSize', 'font size')
  },
  {
    id: 'typography.fontWeight',
    category: 'typography',
    check: 'Font weight',
    evaluate: checkNumericStyle('fontWeight', 'font weight')
  },
  {
    id: 'typography.lineHeight',
    category: 'typography',
    check: 'Line height',
    evaluate: checkNumericStyle('lineHeight', 'line height')
  },
  { id: 'spacing.padding', category: 'spacing', check: 'Padding', evaluate: checkBoxStyle('padding', 'padding') },
  { id: 'spacing.margin', category: 'spacing', check: 'Margin', evaluate: checkBoxStyle('margin', 'margin') },
  { id: 'spacing.gap', category: 'spacing', check: 'Gap', evaluate: checkNumericStyle('gap', 'gap') },
  {
    id: 'shape.borderRadius',
    category: 'shape',
    check: 'Border radius',
    evaluate: checkNumericStyle('borderRadius', 'border radius')
  },
  { id: 'shape.border', category: 'shape', check: 'Border', evaluate: checkBorder },
  { id: 'shape.shadow', category: 'shape', check: 'Box shadow', evaluate: checkShadow },
  { id: 'dimensions.height', category: 'dimensions', check: 'Height', evaluate: checkHeight },
  {
    id: 'dimensions.width',
    category: 'dimensions',
    check: 'Width',
    evaluate: checkNumericStyle('width', 'width')
  },
  { id: 'accessibility.role', category: 'accessibility', check: 'Role / native semantics', evaluate: checkRole },
  {
    id: 'accessibility.name',
    category: 'accessibility',
    check: 'Accessible name',
    evaluate: checkAccessibleName
  },
  { id: 'accessibility.label', category: 'accessibility', check: 'Associated label', evaluate: checkLabel },
  { id: 'accessibility.contrast', category: 'accessibility', check: 'Contrast (WCAG)', evaluate: checkContrast },
  {
    id: 'accessibility.disabledState',
    category: 'accessibility',
    check: 'Disabled state',
    evaluate: checkState('disabled', 'disabled')
  },
  {
    id: 'accessibility.required',
    category: 'accessibility',
    check: 'Required state',
    evaluate: checkState('required', 'required')
  }
];

/**
 * Runs every enabled check and returns findings. Findings are serializable, carry their
 * evidence references and are always marked as deterministic (`interpretedByLlm: false`).
 */
export function evaluateRules(input: RuleEvaluationInput, options: RulesEngineOptions = {}): Finding[] {
  const findings: Finding[] = [];

  for (const definition of CHECK_DEFINITIONS) {
    const config: CheckConfig = {
      ...DEFAULT_CHECKS[definition.id],
      ...(options.checks?.[definition.id] ?? {})
    };
    if (!config.enabled) continue;

    const outcome = definition.evaluate(input, config);
    findings.push({
      id: `finding-${definition.id}`,
      category: definition.category,
      status: outcome.status,
      severity: config.severity,
      ruleId: definition.id,
      check: definition.check,
      evidenceRefs: input.evidenceRefs ?? [],
      interpretedByLlm: false,
      ...(outcome.observed !== undefined ? { observed: outcome.observed as JsonValue } : {}),
      ...(outcome.expected !== undefined ? { expected: outcome.expected as JsonValue } : {}),
      ...(outcome.difference !== undefined ? { difference: outcome.difference as JsonValue } : {}),
      ...(outcome.tolerance !== undefined ? { tolerance: outcome.tolerance as JsonValue } : {}),
      ...(input.sourceMcpRefs && input.sourceMcpRefs.length > 0
        ? { sourceMcpRefs: input.sourceMcpRefs }
        : {}),
      ...(input.matchConfidence !== undefined ? { matchConfidence: input.matchConfidence } : {}),
      ...(outcome.explanation ? { explanation: outcome.explanation } : {})
    });
  }

  return findings;
}

export const summarizeFindings = (findings: readonly Finding[]): Record<FindingStatus, number> => {
  const summary: Record<FindingStatus, number> = { PASS: 0, FAIL: 0, REVIEW: 0, NOT_EVALUATED: 0 };
  for (const finding of findings) {
    summary[finding.status] += 1;
  }
  return summary;
};

/** Stateful facade used by the review flow (DS-018) with a profile-bound configuration. */
export class RulesEngine {
  readonly #options: RulesEngineOptions;

  constructor(options: RulesEngineOptions = {}) {
    this.#options = options;
  }

  evaluate(input: RuleEvaluationInput): Finding[] {
    return evaluateRules(input, this.#options);
  }

  /** Returns a new engine with extra check overrides merged in (profile switching). */
  withChecks(checks: Partial<Record<CheckId, CheckConfig>>): RulesEngine {
    return new RulesEngine({ checks: { ...(this.#options.checks ?? {}), ...checks } });
  }
}
