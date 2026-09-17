import { describe, expect, it } from 'vitest';

import { evaluateOrigin, type OriginPolicy } from './originPolicy.js';

const basePolicy: OriginPolicy = {
  allowExtensionScheme: true,
  pinnedExtensionOrigins: [],
  allowDevRemoteOrigins: false
};

describe('origin policy (DS-003: rejects unauthorized origins)', () => {
  it('allows requests without an Origin header because they still need a session token', () => {
    expect(evaluateOrigin(undefined, basePolicy)).toEqual({ allowed: true, reason: 'no-origin-header' });
    expect(evaluateOrigin('   ', basePolicy).allowed).toBe(true);
  });

  it('allows chrome-extension origins while the wildcard is enabled', () => {
    const decision = evaluateOrigin('chrome-extension://abcdefghijklmnop', basePolicy);
    expect(decision).toEqual({ allowed: true, reason: 'extension-scheme' });
  });

  it('only allows pinned extensions once a pinning list exists', () => {
    const policy: OriginPolicy = {
      ...basePolicy,
      allowExtensionScheme: false,
      pinnedExtensionOrigins: ['chrome-extension://allowedextensionid']
    };

    expect(evaluateOrigin('chrome-extension://allowedextensionid', policy).allowed).toBe(true);
    expect(evaluateOrigin('chrome-extension://someotherextension', policy)).toEqual({
      allowed: false,
      reason: 'rejected-not-pinned'
    });
  });

  it('allows loopback http origins for local tooling and tests', () => {
    expect(evaluateOrigin('http://127.0.0.1:5173', basePolicy).allowed).toBe(true);
    expect(evaluateOrigin('http://localhost:8787', basePolicy).allowed).toBe(true);
  });

  it('rejects public web origins by default', () => {
    expect(evaluateOrigin('https://evil.example', basePolicy)).toEqual({
      allowed: false,
      reason: 'rejected-scheme'
    });
  });

  it('allows public origins only when the dev escape hatch is explicitly enabled', () => {
    const policy: OriginPolicy = { ...basePolicy, allowDevRemoteOrigins: true };
    expect(evaluateOrigin('https://internal.example', policy)).toEqual({
      allowed: true,
      reason: 'dev-remote-origin'
    });
  });
});