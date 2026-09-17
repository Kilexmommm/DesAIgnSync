/**
 * Origin policy for the loopback API (DS-003).
 * The extension is the only browser client we expect; requests without an Origin header
 * (CLI, tests, native tooling) are allowed because they still need a session token.
 */

export const EXTENSION_SCHEME_PREFIX = 'chrome-extension://';

export interface OriginPolicy {
  /** Accept any `chrome-extension://` origin when no pinning list is configured. */
  allowExtensionScheme: boolean;
  /** Exact origins (e.g. `chrome-extension://abcdefghijklmnop`) allowed to talk to the host. */
  pinnedExtensionOrigins: string[];
  /** Dev-only escape hatch for http:// origins. */
  allowDevRemoteOrigins: boolean;
}

export interface OriginDecision {
  allowed: boolean;
  reason:
    | 'no-origin-header'
    | 'pinned-origin'
    | 'extension-scheme'
    | 'loopback-origin'
    | 'dev-remote-origin'
    | 'rejected-scheme'
    | 'rejected-not-pinned';
}

const normalize = (value: string): string => value.trim().replace(/\/$/, '').toLowerCase();

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

export function evaluateOrigin(origin: string | undefined, policy: OriginPolicy): OriginDecision {
  if (origin === undefined || origin.trim() === '') {
    return { allowed: true, reason: 'no-origin-header' };
  }

  const candidate = normalize(origin);
  const pinned = policy.pinnedExtensionOrigins.map(normalize);

  if (pinned.length > 0) {
    return pinned.includes(candidate)
      ? { allowed: true, reason: 'pinned-origin' }
      : { allowed: false, reason: 'rejected-not-pinned' };
  }

  if (candidate.startsWith(EXTENSION_SCHEME_PREFIX)) {
    return policy.allowExtensionScheme
      ? { allowed: true, reason: 'extension-scheme' }
      : { allowed: false, reason: 'rejected-not-pinned' };
  }

  if (isLoopbackOrigin(candidate)) {
    return { allowed: true, reason: 'loopback-origin' };
  }

  if (policy.allowDevRemoteOrigins) {
    return { allowed: true, reason: 'dev-remote-origin' };
  }

  return { allowed: false, reason: 'rejected-scheme' };
}