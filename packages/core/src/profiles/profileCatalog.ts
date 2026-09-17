import {
  CHECK_IDS,
  PROFILE_TEMPLATE_IDS,
  type CheckConfig,
  type CheckId,
  type ComparisonStrategy,
  type MatchingConfig,
  type MatchingWeights,
  type ProfileTemplateId,
  type Severity,
  type ValidationProfile,
  type ValidationTier
} from '@desaignsync/shared-types';

import { DEFAULT_MATCHING_CONFIG, resolveMatchingConfig } from '../matching/matchingEngine.js';
import { DEFAULT_ADVANCED_INSTRUCTIONS } from '../prompts/corePrompt.js';
import { CLASS_SIGNAL_WEIGHT_CAP } from '../evidence/classNormalizer.js';
import { DEFAULT_CHECKS } from '../rules/rulesEngine.js';

/**
 * Validation profiles and Simple/Advanced/Expert modes (DS-017, spec §13).
 *
 * Structured configuration (checks, tolerances, severities, matching) is always independent from
 * the free-text advanced prompt, and profiles never store credentials: the API key lives in the
 * host credential store (DS-009) and only the provider id is referenced from the project config.
 */

export const PROFILE_CATALOG_VERSION = 1;

export const SEVERITY_VALUES: readonly Severity[] = ['info', 'minor', 'major', 'critical'];

export const TOLERANCE_STRATEGIES: readonly ComparisonStrategy[] = [
  'exact',
  'numeric-absolute',
  'numeric-relative',
  'color-perceptual'
];

export const MIN_CANDIDATES = 1;
export const MAX_CANDIDATES = 10;

/** Which knobs each mode exposes; Simple deliberately hides every technical parameter. */
export interface TierExposure {
  checks: boolean;
  tolerances: boolean;
  severities: boolean;
  advancedInstructions: boolean;
  matchingWeights: boolean;
  minimumConfidence: boolean;
  topCandidates: boolean;
  llmProviderAndModel: boolean;
}

export const TIER_EXPOSURE: Record<ValidationTier, TierExposure> = {
  simple: {
    checks: true,
    tolerances: false,
    severities: false,
    advancedInstructions: false,
    matchingWeights: false,
    minimumConfidence: false,
    topCandidates: false,
    llmProviderAndModel: false
  },
  advanced: {
    checks: true,
    tolerances: true,
    severities: true,
    advancedInstructions: true,
    matchingWeights: false,
    minimumConfidence: false,
    topCandidates: false,
    llmProviderAndModel: false
  },
  expert: {
    checks: true,
    tolerances: true,
    severities: true,
    advancedInstructions: true,
    matchingWeights: true,
    minimumConfidence: true,
    topCandidates: true,
    llmProviderAndModel: true
  }
};

export interface ProfileTemplate {
  id: ProfileTemplateId;
  name: string;
  description: string;
  tier: ValidationTier;
  disabledChecks: readonly CheckId[];
  matching?: Partial<MatchingConfig>;
  advancedInstructions?: string;
}

/** The six starting profiles from spec §13 / DS-017. */
export const PROFILE_TEMPLATES: readonly ProfileTemplate[] = [
  {
    id: 'design-qa',
    name: 'Design QA',
    description: 'Visual QA against the Design System: colors, typography, spacing and shape.',
    tier: 'advanced',
    disabledChecks: [],
    advancedInstructions:
      'Focus on visual QA. Flag every deviation outside tolerance and always cite the Design System reference for each FAIL.'
  },
  {
    id: 'design-system-compliance',
    name: 'Design System Compliance',
    description: 'Strict component reuse with a high confidence threshold.',
    tier: 'expert',
    disabledChecks: [],
    matching: {
      minConfidence: 0.75,
      maxCandidates: 5,
      weights: { ...DEFAULT_MATCHING_CONFIG.weights, semantic: 0.3, css: 0.15 }
    },
    advancedInstructions:
      'Prioritize reuse of existing components over approximate visual similarity. If the candidate confidence is below 0.75, report REVIEW instead of naming a component.'
  },
  {
    id: 'accessibility',
    name: 'Accessibility',
    description: 'Accessibility-first review: semantics, names, labels, contrast and states.',
    tier: 'advanced',
    disabledChecks: ['shape.shadow', 'dimensions.height', 'dimensions.width', 'spacing.margin'],
    advancedInstructions:
      'Prioritize accessibility. Validate roles, accessible names, associated labels, contrast and disabled/required states. Report non-native semantics as REVIEW.'
  },
  {
    id: 'forms-review',
    name: 'Forms Review',
    description: 'Field-level review: labels, states, error styling and contrast.',
    tier: 'advanced',
    disabledChecks: ['shape.shadow', 'dimensions.width'],
    advancedInstructions:
      'Validate form fields: associated labels, required/disabled states, error styling and contrast. Treat wrappers as containers, not as the control.'
  },
  {
    id: 'ds-migration',
    name: 'DS Migration',
    description: 'Migration review that accepts inferred matches and lists alternatives.',
    tier: 'expert',
    disabledChecks: [],
    matching: { minConfidence: 0.5, maxCandidates: 5 },
    advancedInstructions:
      'Migration review: prefer the closest Design System component, suggest replacements and always list the alternative candidates.'
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Product defaults for a user-defined profile.',
    tier: 'advanced',
    disabledChecks: []
  }
];

export const getProfileTemplate = (templateId: ProfileTemplateId): ProfileTemplate => {
  const template = PROFILE_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) {
    throw new Error(`Unknown profile template: ${templateId}`);
  }
  return template;
};

export const isProfileTemplateId = (value: string): value is ProfileTemplateId =>
  (PROFILE_TEMPLATE_IDS as readonly string[]).includes(value);

export const isCheckId = (value: string): value is CheckId =>
  (CHECK_IDS as readonly string[]).includes(value);

const buildChecks = (
  disabledChecks: readonly CheckId[],
  overrides?: Partial<Record<CheckId, CheckConfig>>
): Partial<Record<CheckId, CheckConfig>> => {
  const checks: Partial<Record<CheckId, CheckConfig>> = {};
  for (const checkId of CHECK_IDS) {
    checks[checkId] = {
      ...DEFAULT_CHECKS[checkId],
      ...(overrides?.[checkId] ?? {}),
      enabled: !disabledChecks.includes(checkId)
    };
  }
  return checks;
};

export interface CreateProfileInput {
  id: string;
  templateId: ProfileTemplateId;
  name?: string;
  tier?: ValidationTier;
  advancedInstructions?: string;
  isBuiltIn?: boolean;
}

/** Creates a profile from a template. Simple mode never carries free-text instructions. */
export const createProfileFromTemplate = (input: CreateProfileInput): ValidationProfile => {
  const template = getProfileTemplate(input.templateId);
  const tier = input.tier ?? template.tier;
  const matching = resolveMatchingConfig({ ...DEFAULT_MATCHING_CONFIG, ...(template.matching ?? {}) });
  const profile: ValidationProfile = {
    id: input.id,
    name: input.name?.trim() || template.name,
    tier,
    checks: buildChecks(template.disabledChecks),
    matching,
    advancedInstructions:
      tier === 'simple' ? '' : (input.advancedInstructions ?? template.advancedInstructions ?? '')
  };
  if (input.isBuiltIn === true) profile.isBuiltIn = true;
  return profile;
};

export const BUILT_IN_PROFILES: readonly ValidationProfile[] = PROFILE_TEMPLATES.map((template) =>
  createProfileFromTemplate({ id: template.id, templateId: template.id, isBuiltIn: true })
);

export const duplicateProfile = (
  profile: ValidationProfile,
  options: { id: string; name?: string }
): ValidationProfile => {
  const clone: ValidationProfile = {
    ...structuredClone(profile),
    id: options.id,
    name: options.name?.trim() || `${profile.name} (copy)`,
    isBuiltIn: false
  };
  return clone;
};

export const renameProfile = (profile: ValidationProfile, name: string): ValidationProfile => ({
  ...profile,
  name: name.trim() === '' ? profile.name : name.trim()
});

export const resetProfileToDefaults = (profile: ValidationProfile): ValidationProfile =>
  createProfileFromTemplate({
    id: profile.id,
    name: profile.name,
    templateId: isProfileTemplateId(profile.id) ? profile.id : 'custom',
    isBuiltIn: profile.isBuiltIn === true
  });

/** Built-in profiles cannot be deleted; the catalog simply ignores them. */
export const removeProfileFromList = (
  profiles: readonly ValidationProfile[],
  profileId: string
): ValidationProfile[] => {
  const target = profiles.find((profile) => profile.id === profileId);
  if (!target || target.isBuiltIn === true) return [...profiles];
  return profiles.filter((profile) => profile.id !== profileId);
};

/**
 * Structured edits only: toggling checks or tolerances never rewrites the advanced prompt
 * (DS-017 AC: "changing checks updates structured configuration without editing the prompt").
 */
export const updateChecks = (
  profile: ValidationProfile,
  changes: Partial<Record<CheckId, Partial<CheckConfig>>>
): ValidationProfile => {
  const checks: Partial<Record<CheckId, CheckConfig>> = { ...profile.checks };
  for (const [checkId, change] of Object.entries(changes) as Array<[CheckId, Partial<CheckConfig>]>) {
    if (!isCheckId(checkId)) continue;
    const current = checks[checkId] ?? DEFAULT_CHECKS[checkId];
    checks[checkId] = { ...current, ...change };
  }
  return { ...profile, checks, advancedInstructions: profile.advancedInstructions };
};

export const updateMatching = (
  profile: ValidationProfile,
  matching: Partial<MatchingConfig>
): ValidationProfile => ({
  ...profile,
  matching: resolveMatchingConfig({ ...profile.matching, ...matching })
});

export const applyTier = (profile: ValidationProfile, tier: ValidationTier): ValidationProfile =>
  tier === 'simple'
    ? { ...profile, tier, advancedInstructions: '' }
    : { ...profile, tier, advancedInstructions: profile.advancedInstructions || DEFAULT_ADVANCED_INSTRUCTIONS };

export interface ProfileValidation {
  ok: boolean;
  issues: string[];
}

const SECRET_KEY_PATTERN = /"(api[-_]?key|apikey|secret|token|password|credential)"\s*:/i;

/** Validates a profile and enforces the "no secrets in profiles" rule (DS-017 AC). */
export const validateProfile = (profile: ValidationProfile): ProfileValidation => {
  const issues: string[] = [];

  if (profile.name.trim() === '') issues.push('profile name is required');
  if (!['simple', 'advanced', 'expert'].includes(profile.tier)) {
    issues.push(`unknown tier: ${String(profile.tier)}`);
  }

  for (const checkId of Object.keys(profile.checks)) {
    if (!isCheckId(checkId)) issues.push(`unknown check id: ${checkId}`);
  }
  for (const [checkId, config] of Object.entries(profile.checks) as Array<[CheckId, CheckConfig]>) {
    if (!isCheckId(checkId)) continue;
    if (typeof config.enabled !== 'boolean') issues.push(`${checkId}: enabled must be a boolean`);
    if (!SEVERITY_VALUES.includes(config.severity)) issues.push(`${checkId}: invalid severity`);
    if (!TOLERANCE_STRATEGIES.includes(config.tolerance.strategy)) {
      issues.push(`${checkId}: invalid tolerance strategy`);
    }
    for (const key of ['absolute', 'relative', 'perceptual'] as const) {
      const value = config.tolerance[key];
      if (value !== undefined && (typeof value !== 'number' || value < 0)) {
        issues.push(`${checkId}: tolerance.${key} must be a non-negative number`);
      }
    }
  }

  const weights = profile.matching.weights;
  const weightEntries = Object.entries(weights) as Array<[keyof MatchingWeights, number]>;
  let weightSum = 0;
  for (const [name, value] of weightEntries) {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
      issues.push(`matching weight "${name}" must be between 0 and 1`);
      continue;
    }
    weightSum += value;
  }
  if (weightSum <= 0) issues.push('at least one matching weight must be greater than 0');
  if (weights.classes > CLASS_SIGNAL_WEIGHT_CAP) {
    issues.push(`matching weight "classes" cannot exceed ${CLASS_SIGNAL_WEIGHT_CAP}`);
  }
  if (profile.matching.minConfidence < 0 || profile.matching.minConfidence > 1) {
    issues.push('minimum confidence must be between 0 and 1');
  }
  if (
    !Number.isInteger(profile.matching.maxCandidates) ||
    profile.matching.maxCandidates < MIN_CANDIDATES ||
    profile.matching.maxCandidates > MAX_CANDIDATES
  ) {
    issues.push(`top candidates must be an integer between ${MIN_CANDIDATES} and ${MAX_CANDIDATES}`);
  }

  if (SECRET_KEY_PATTERN.test(JSON.stringify(profile))) {
    issues.push('profiles must not store API keys or other secrets');
  }

  return { ok: issues.length === 0, issues };
};

export interface ProfileSummary {
  id: string;
  name: string;
  tier: ValidationTier;
  catalogVersion: number;
  enabledChecks: CheckId[];
  disabledChecks: CheckId[];
  advancedInstructions: { custom: boolean; source: 'custom' | 'product-default' | 'none' };
  matching: { minConfidence: number; maxCandidates: number; weights: MatchingWeights };
  exposure: TierExposure;
}

export const summarizeProfile = (profile: ValidationProfile): ProfileSummary => {
  const enabledChecks: CheckId[] = [];
  const disabledChecks: CheckId[] = [];
  for (const checkId of CHECK_IDS) {
    const config = profile.checks[checkId];
    if (!config || config.enabled) enabledChecks.push(checkId);
    else disabledChecks.push(checkId);
  }
  const templateDefault = isProfileTemplateId(profile.id)
    ? (getProfileTemplate(profile.id).advancedInstructions ?? DEFAULT_ADVANCED_INSTRUCTIONS)
    : DEFAULT_ADVANCED_INSTRUCTIONS;
  const hasText = profile.advancedInstructions.trim() !== '';
  const custom = hasText && profile.advancedInstructions.trim() !== templateDefault.trim();
  return {
    id: profile.id,
    name: profile.name,
    tier: profile.tier,
    catalogVersion: PROFILE_CATALOG_VERSION,
    enabledChecks,
    disabledChecks,
    advancedInstructions: {
      custom,
      source: profile.tier === 'simple' ? 'none' : custom ? 'custom' : 'product-default'
    },
    matching: {
      minConfidence: profile.matching.minConfidence,
      maxCandidates: profile.matching.maxCandidates,
      weights: profile.matching.weights
    },
    exposure: TIER_EXPOSURE[profile.tier]
  };
};

export interface ProfileRef {
  id: string;
  name: string;
  tier: ValidationTier;
  catalogVersion: number;
}

/** Embedded in every report so the analysis can be reproduced (DS-017 AC, DS-020). */
export const profileRef = (profile: ValidationProfile): ProfileRef => ({
  id: profile.id,
  name: profile.name,
  tier: profile.tier,
  catalogVersion: PROFILE_CATALOG_VERSION
});
