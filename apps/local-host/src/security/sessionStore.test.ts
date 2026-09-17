import { DesaignSyncHostError } from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import { SessionStore } from './sessionStore.js';

let clock = 1_000_000;
const now = (): number => clock;

const createStore = (
  overrides: {
    tokenTtlMs?: number;
    pairingWindowMs?: number;
    maxPairingAttempts?: number;
    onPairingWindowOpened?: (code: string, reason: 'reopened') => void;
  } = {}
) =>
  new SessionStore({
    tokenTtlMs: overrides.tokenTtlMs ?? 60_000,
    pairingWindowMs: overrides.pairingWindowMs ?? 60_000,
    maxPairingAttempts: overrides.maxPairingAttempts ?? 3,
    ...(overrides.onPairingWindowOpened
      ? { onPairingWindowOpened: overrides.onPairingWindowOpened }
      : {}),
    now
  });

describe('session store (DS-003 pairing + ephemeral tokens)', () => {
  it('issues a token for the correct one-time pairing code and never stores it in clear text', () => {
    const store = createStore();
    const issued = store.pair(store.pairingCode, { clientName: 'Test Panel' });

    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.session.tokenHash).not.toContain(issued.token);
    expect(store.verify(issued.token)?.id).toBe(issued.session.id);
  });

  it('normalizes the pairing code and rejects unknown tokens', () => {
    const store = createStore();
    const issued = store.pair(` ${store.pairingCode.toLowerCase()} `);
    expect(store.verify(issued.token)).toBeDefined();
    expect(store.verify('deadbeef')).toBeUndefined();
    expect(store.verify(undefined)).toBeUndefined();
  });

  it('closes the pairing window after a successful pairing', () => {
    const store = createStore();
    expect(store.isPairingOpen()).toBe(true);
    store.pair(store.pairingCode);
    expect(store.isPairingOpen()).toBe(false);
  });

  it('rate limits brute-force pairing attempts with a structured error', () => {
    const store = createStore({ maxPairingAttempts: 2 });
    expect(() => store.pair('WRONGCOD')).toThrow(DesaignSyncHostError);
    expect(() => store.pair('WRONGCOD')).toThrow(/Too many pairing attempts/);
    try {
      store.pair(store.pairingCode);
    } catch (error) {
      expect((error as DesaignSyncHostError).code).toBe('RATE_LIMITED');
    }
  });

  it('expires tokens after the configured TTL', () => {
    const store = createStore({ tokenTtlMs: 1_000 });
    const issued = store.pair(store.pairingCode);
    clock += 1_001;
    expect(store.verify(issued.token)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
    clock -= 1_001;
  });

  it('renews and revokes sessions', () => {
    const store = createStore();
    const issued = store.pair(store.pairingCode);
    const renewed = store.renew(issued.token);

    expect(renewed?.token).not.toBe(issued.token);
    expect(store.verify(issued.token)).toBeUndefined();
    expect(store.revoke(renewed?.token)).toBe(true);
    expect(store.verify(renewed?.token)).toBeUndefined();
  });

  it('reopens the pairing window on demand (lost/expired token) without resetting rate limits', () => {
    const opened: string[] = [];
    const store = createStore({
      maxPairingAttempts: 3,
      onPairingWindowOpened: (code, reason) => opened.push(`${reason}:${code}`)
    });
    const bootCode = store.pairingCode;
    store.pair(store.pairingCode);
    expect(store.isPairingOpen()).toBe(false);

    // Two failed attempts, then a client shows up with an invalid token.
    expect(() => store.pair('WRONGCOD')).toThrow();
    expect(() => store.pair('WRONGCOD')).toThrow();
    const reopened = store.ensurePairingAvailable();
    expect(reopened.reopened).toBe(true);
    expect(reopened.code).not.toBe(bootCode);
    expect(store.isPairingOpen()).toBe(true);
    expect(opened).toEqual([`reopened:${reopened.code}`]);

    // The rate-limit budget is preserved: this attempt reaches the limit instead of resetting it.
    expect(() => store.pair('WRONGCOD')).toThrow(/Too many pairing attempts/);

    // Calling it again while the window is open is a no-op.
    expect(store.ensurePairingAvailable()).toEqual({ reopened: false, code: store.pairingCode });
  });

  it('can reopen the pairing window with a fresh code (--pair flag)', () => {
    const store = createStore();
    const first = store.pairingCode;
    store.closePairingWindow();
    const second = store.reopenPairingWindow();

    expect(second).not.toBe(first);
    expect(store.isPairingOpen()).toBe(true);
  });
});