import { useCallback, useEffect, useState } from 'react';

import type { ProfilesResponse, ReviewRequest, ReviewResult } from '@desaignsync/shared-types';

import { HostRequestError, LocalHostClient } from '../bridge/LocalHostClient.js';
import { getHostUrl, getSessionToken } from '../bridge/extensionStorage.js';

export interface ReviewHookState {
  running: boolean;
  result?: ReviewResult;
  error?: string;
}

const buildClient = async (timeoutMs?: number): Promise<LocalHostClient> => {
  const [baseUrl, token] = await Promise.all([getHostUrl(), getSessionToken()]);
  return new LocalHostClient({ baseUrl, ...(token !== undefined ? { token } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
};

const describeError = (error: unknown): string => {
  if (error instanceof HostRequestError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'The review could not be completed.';
};

/**
 * Runs the full element review through the Local Host (DS-018).
 * The Side Panel only orchestrates the request: evidence, matching, rules and the LLM all run in the host.
 */
export function useReview(): ReviewHookState & {
  run: (request: ReviewRequest) => Promise<ReviewResult | undefined>;
  reset: () => void;
} {
  const [state, setState] = useState<ReviewHookState>({ running: false });

  const run = useCallback(async (request: ReviewRequest): Promise<ReviewResult | undefined> => {
    setState({ running: true });
    try {
      const client = await buildClient(180_000);
      if (!client.token) {
        setState({ running: false, error: 'Pair with the Local Host before running a review.' });
        return undefined;
      }
      const result = await client.review(request);
      setState({ running: false, result });
      return result;
    } catch (error) {
      setState({ running: false, error: describeError(error) });
      return undefined;
    }
  }, []);

  const reset = useCallback(() => setState({ running: false }), []);

  return { ...state, run, reset };
}

/** Loads the available validation profiles (DS-017) so the user can pick one before reviewing. */
export function useProfiles(enabled: boolean): { profiles: ProfilesResponse['profiles'] } {
  const [profiles, setProfiles] = useState<ProfilesResponse['profiles']>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = await buildClient();
        if (!client.token) return;
        const response = await client.profiles();
        if (!cancelled) setProfiles(response.profiles);
      } catch {
        // The panel keeps its default profile when the catalog cannot be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { profiles };
}
