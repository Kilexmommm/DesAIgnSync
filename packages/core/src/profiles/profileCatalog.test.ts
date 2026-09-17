import {
  PROFILE_TEMPLATE_IDS,
  type CheckId,
  type ValidationProfile
} from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import { CLASS_SIGNAL_WEIGHT_CAP } from '../evidence/classNormalizer.js';
import { DEFAULT_MATCHING_WEIGHTS } from '../matching/matchingEngine.js';
import { DEFAULT_CHECKS } from '../rules/rulesEngine.js';
import {
  BUILT_IN_PROFILES,
  PROFILE_CATALOG_VERSION,
  PROFILE_TEMPLATES,
  TIER_EXPOSURE,
  applyTier,
  createProfileFromTemplate,
  duplicateProfile,
  profileRef,
  removeProfileFromList,
  renameProfile,
  resetProfileToDefaults,
  summarizeProfile,
  updateChecks,
  updateMatching,
  validateProfile
} from './profileCatalog.js';

const customProfile = (): ValidationProfile =>
  createProfileFromTemplate({ id: 'my-profile', templateId: 'custom', name: 'My profile' });

describe('profile catalog (DS-017)', () => {
  it('ships the six initial profiles, all valid', () => {
    expect(PROFILE_TEMPLATES.map((template) => template.id)).toEqual([...PROFILE_TEMPLATE_IDS]);
    expect(BUILT_IN_PROFILES).toHaveLength(6);
    for (const profile of BUILT_IN_PROFILES) {
      const validation = validateProfile(profile);
      expect(validation.issues).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(profile.isBuiltIn).toBe(true);
    }
  });

  it('configures each mode: Simple hides technical parameters, Expert exposes matching', () => {
    const simple = createProfileFromTemplate({ id: 'simple-1', templateId: 'design-qa', tier: 'simple' });
    expect(simple.advancedInstructions).toBe('');
    expect(summarizeProfile(simple).exposure).toMatchObject({
      tolerances: false,
      matchingWeights: false,
      advancedInstructions: false
    });

    expect(TIER_EXPOSURE.advanced.matchingWeights).toBe(false);
    expect(TIER_EXPOSURE.expert.matchingWeights).toBe(true);
    expect(TIER_EXPOSURE.expert.llmProviderAndModel).toBe(true);
  });

  it('changes checks as structured configuration without touching the advanced prompt', () => {
    const profile = createProfileFromTemplate({
      id: 'my-profile',
      templateId: 'design-qa',
      name: 'My profile'
    });
    const before = profile.advancedInstructions;
    const updated = updateChecks(profile, {
      'color.text': { enabled: false },
      'spacing.padding': { tolerance: { strategy: 'numeric-absolute', absolute: 0 } }
    });

    expect(updated.advancedInstructions).toBe(before);
    expect(updated.checks['color.text']?.enabled).toBe(false);
    expect(updated.checks['spacing.padding']?.tolerance.absolute).toBe(0);
    const summary = summarizeProfile(updated);
    expect(summary.disabledChecks).toContain('color.text');
    expect(summary.enabledChecks).not.toContain('color.text');
    expect(summary.enabledChecks.length + summary.disabledChecks.length).toBe(Object.keys(DEFAULT_CHECKS).length);
  });

  it('rejects invalid expert values instead of accepting them', () => {
    const invalidWeights = {
      ...customProfile(),
      matching: {
        ...customProfile().matching,
        weights: { ...DEFAULT_MATCHING_WEIGHTS, semantic: 1.5 }
      }
    };
    expect(validateProfile(invalidWeights).issues.join(' ')).toContain('"semantic" must be between 0 and 1');

    const cappedClasses = {
      ...customProfile(),
      matching: {
        ...customProfile().matching,
        weights: { ...DEFAULT_MATCHING_WEIGHTS, classes: CLASS_SIGNAL_WEIGHT_CAP + 0.2 }
      }
    };
    expect(validateProfile(cappedClasses).issues.join(' ')).toContain('cannot exceed');

    const badConfidence = {
      ...customProfile(),
      matching: { ...customProfile().matching, minConfidence: 2 }
    };
    expect(validateProfile(badConfidence).issues.join(' ')).toContain('minimum confidence');

    const badCandidates = {
      ...customProfile(),
      matching: { ...customProfile().matching, maxCandidates: 0 }
    };
    expect(validateProfile(badCandidates).issues.join(' ')).toContain('top candidates');

    const unknownCheck = {
      ...customProfile(),
      checks: { ...customProfile().checks, 'bogus.check': DEFAULT_CHECKS['color.text'] }
    } as unknown as ValidationProfile;
    expect(validateProfile(unknownCheck).issues.join(' ')).toContain('unknown check id');
  });

  it('never stores credentials inside a profile', () => {
    for (const profile of BUILT_IN_PROFILES) {
      expect(JSON.stringify(profile)).not.toMatch(/"(api[-_]?key|secret|token|password)"/i);
    }
    const withSecret = { ...customProfile(), apiKey: 'sk-live-should-not-be-here' } as unknown as ValidationProfile;
    expect(validateProfile(withSecret).issues.join(' ')).toContain('must not store API keys');
  });

  it('duplicates, renames and deletes profiles with the expected guards', () => {
    const original = customProfile();
    const copy = duplicateProfile(original, { id: 'copy-1', name: 'Copy' });

    expect(copy.id).toBe('copy-1');
    expect(copy.name).toBe('Copy');
    expect(copy.isBuiltIn).toBe(false);

    updateChecks(copy, { 'color.text': { enabled: false } });
    expect(original.checks['color.text']?.enabled).toBe(true);

    expect(renameProfile(copy, '  Renamed  ').name).toBe('Renamed');
    expect(renameProfile(copy, '   ').name).toBe('Copy');

    const list = [...BUILT_IN_PROFILES, copy];
    expect(removeProfileFromList(list, 'design-qa')).toHaveLength(list.length);
    expect(removeProfileFromList(list, 'copy-1')).toHaveLength(list.length - 1);
  });

  it('resets a profile to its template defaults', () => {
    const profile = updateMatching(
      updateChecks(customProfile(), { 'color.text': { enabled: false } }),
      { minConfidence: 0.95, maxCandidates: 9 }
    );
    const reset = resetProfileToDefaults({ ...profile, advancedInstructions: 'My own rules' });

    expect(reset.checks['color.text']?.enabled).toBe(true);
    expect(reset.matching.minConfidence).toBe(customProfile().matching.minConfidence);
    expect(reset.matching.maxCandidates).toBe(customProfile().matching.maxCandidates);
    expect(reset.advancedInstructions).toBe('');
  });

  it('keeps built-in profiles reproducible and references them in reports', () => {
    const accessibility = BUILT_IN_PROFILES.find((profile) => profile.id === 'accessibility');
    expect(accessibility?.tier).toBe('advanced');
    expect(accessibility?.checks['dimensions.height']?.enabled).toBe(false);

    const summary = summarizeProfile(accessibility as ValidationProfile);
    expect(summary.disabledChecks).toContain('dimensions.height');
    expect(summary.advancedInstructions.source).toBe('product-default');

    const ref = profileRef(accessibility as ValidationProfile);
    expect(ref).toEqual({
      id: 'accessibility',
      name: 'Accessibility',
      tier: 'advanced',
      catalogVersion: PROFILE_CATALOG_VERSION
    });
    expect(ref.catalogVersion).toBe(1);
  });

  it('switches modes while preserving the structured configuration', () => {
    const expert = {
      ...BUILT_IN_PROFILES.find((profile) => profile.id === 'design-system-compliance')
    } as ValidationProfile;
    const advanced = applyTier(expert, 'advanced');
    expect(advanced.tier).toBe('advanced');
    expect(advanced.matching.minConfidence).toBe(expert.matching.minConfidence);

    const simple = applyTier(expert, 'simple');
    expect(simple.tier).toBe('simple');
    expect(simple.advancedInstructions).toBe('');
    expect(summarizeProfile(simple).advancedInstructions.source).toBe('none');
  });

  it('exposes checks as typed ids only', () => {
    const profile = customProfile();
    const ids = Object.keys(profile.checks) as CheckId[];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.includes('.'))).toBe(true);
  });
});
