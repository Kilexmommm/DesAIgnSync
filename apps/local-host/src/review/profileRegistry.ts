import {
  DesaignSyncHostError,
  type ProfilesResponse,
  type ValidationProfile
} from '@desaignsync/shared-types';
import { BUILT_IN_PROFILES, summarizeProfile, validateProfile } from '@desaignsync/core';

/** Product default profile when the review request does not pick one. */
export const DEFAULT_PROFILE_ID = 'design-qa';

/**
 * Validation profile registry (DS-017 API surface, spec §13).
 * Built-in profiles are catalog entries and cannot be deleted; custom ones can.
 */
export class ProfileRegistry {
  readonly #profiles = new Map<string, ValidationProfile>();

  constructor(initial: readonly ValidationProfile[] = BUILT_IN_PROFILES) {
    for (const profile of initial) {
      this.#profiles.set(profile.id, profile);
    }
  }

  list(): ValidationProfile[] {
    return [...this.#profiles.values()];
  }

  get(id: string): ValidationProfile | undefined {
    return this.#profiles.get(id);
  }

  getOrDefault(id?: string): ValidationProfile {
    const profile = id !== undefined ? this.#profiles.get(id) : this.#profiles.get(DEFAULT_PROFILE_ID);
    if (profile !== undefined) return profile;
    if (id !== undefined) {
      throw new DesaignSyncHostError('NOT_FOUND', `Unknown validation profile "${id}".`, {
        details: { profileId: id }
      });
    }
    const fallback = this.#profiles.values().next().value;
    if (fallback === undefined) {
      throw new DesaignSyncHostError('CONFIG_INVALID', 'No validation profile is available.');
    }
    return fallback;
  }

  upsert(profile: ValidationProfile): ValidationProfile {
    const validation = validateProfile(profile);
    if (!validation.ok) {
      throw new DesaignSyncHostError(
        'CONFIG_INVALID',
        `Invalid validation profile: ${validation.issues.join('; ')}`,
        { details: { profileId: profile.id } }
      );
    }
    this.#profiles.set(profile.id, profile);
    return profile;
  }

  /** Built-in profiles are protected: they can be reset but not removed. */
  remove(id: string): boolean {
    const profile = this.#profiles.get(id);
    if (profile === undefined || profile.isBuiltIn === true) return false;
    return this.#profiles.delete(id);
  }

  describe(): ProfilesResponse['profiles'] {
    return this.list().map((profile) => {
      const summary = summarizeProfile(profile);
      return {
        id: profile.id,
        name: profile.name,
        tier: profile.tier,
        ...(profile.isBuiltIn === true ? { isBuiltIn: true } : {}),
        enabledCheckCount: summary.enabledChecks.length,
        minConfidence: profile.matching.minConfidence,
        maxCandidates: profile.matching.maxCandidates
      };
    });
  }
}
