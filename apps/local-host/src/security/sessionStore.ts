import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { DesaignSyncHostError } from '@desaignsync/shared-types';

/**
 * Ephemeral session tokens and one-time pairing codes (DS-003).
 * Tokens are stored as SHA-256 hashes; the raw value only reaches the extension once.
 */

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;

export interface SessionRecord {
  id: string;
  tokenHash: string;
  clientName?: string;
  extensionId?: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export interface IssuedSession {
  session: SessionRecord;
  token: string;
  expiresAt: string;
}

export interface SessionStoreOptions {
  tokenTtlMs: number;
  pairingWindowMs: number;
  maxPairingAttempts?: number;
  now?: () => number;
  randomBytesFn?: (size: number) => Buffer;
  /**
   * Notified when the window is reopened because a client presented an invalid token.
   * The host uses it to print the new code in its terminal and to notify connected panels.
   */
  onPairingWindowOpened?: (code: string, reason: 'reopened') => void;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export const generatePairingCode = (): string => {
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_ALPHABET.charAt(randomInt(PAIRING_ALPHABET.length));
  }
  return code;
};

export class SessionStore {
  #sessions = new Map<string, SessionRecord>();
  #pairingCode: string;
  #pairingOpen: boolean;
  #pairingExpiresAt: number;
  #failedAttempts: number[] = [];
  readonly #tokenTtlMs: number;
  readonly #pairingWindowMs: number;
  readonly #maxPairingAttempts: number;
  readonly #nowFn: () => number;
  readonly #randomBytesFn: (size: number) => Buffer;
  readonly #onPairingWindowOpened: ((code: string, reason: 'reopened') => void) | undefined;

  constructor(options: SessionStoreOptions) {
    this.#tokenTtlMs = options.tokenTtlMs;
    this.#pairingWindowMs = options.pairingWindowMs;
    this.#maxPairingAttempts = Math.max(2, options.maxPairingAttempts ?? 5);
    this.#nowFn = options.now ?? (() => Date.now());
    this.#randomBytesFn = options.randomBytesFn ?? ((size: number) => randomBytes(size));
    this.#onPairingWindowOpened = options.onPairingWindowOpened;
    this.#pairingCode = generatePairingCode();
    this.#pairingOpen = true;
    this.#pairingExpiresAt = this.#now() + options.pairingWindowMs;
  }

  #now(): number {
    return this.#nowFn();
  }

  get pairingCode(): string {
    return this.#pairingCode;
  }

  isPairingOpen(): boolean {
    if (!this.#pairingOpen) return false;
    if (this.#pairingExpiresAt !== 0 && this.#now() >= this.#pairingExpiresAt) {
      this.#pairingOpen = false;
      return false;
    }
    return true;
  }

  /** Re-opens the pairing window with a fresh one-time code (used by the `--pair` CLI flag). */
  reopenPairingWindow(): string {
    this.#pairingCode = generatePairingCode();
    this.#pairingOpen = true;
    this.#failedAttempts = [];
    this.#pairingExpiresAt =
      this.#pairingWindowMs === 0 ? 0 : this.#now() + this.#pairingWindowMs;
    return this.#pairingCode;
  }

  /**
   * Re-opens the pairing window when a client presented a missing/expired token, so the user can
   * pair again without restarting the host (the window closes after the first successful pairing).
   *
   * Security: opening the window grants nothing on its own. The new one-time code is only printed
   * by the host terminal, the pairing rate limit is preserved (no reset of failed attempts) and the
   * window stays time-boxed.
   */
  ensurePairingAvailable(): { reopened: boolean; code: string } {
    if (this.isPairingOpen()) return { reopened: false, code: this.#pairingCode };
    this.#pairingCode = generatePairingCode();
    this.#pairingOpen = true;
    this.#pairingExpiresAt =
      this.#pairingWindowMs === 0 ? 0 : this.#now() + this.#pairingWindowMs;
    this.#onPairingWindowOpened?.(this.#pairingCode, 'reopened');
    return { reopened: true, code: this.#pairingCode };
  }

  closePairingWindow(): void {
    this.#pairingOpen = false;
  }

  #assertAttemptsAllowed(): void {
    const windowStart = this.#now() - 60_000;
    this.#failedAttempts = this.#failedAttempts.filter((attempt) => attempt >= windowStart);
    // Every call counts toward the budget, so a burst of attempts locks the window
    // even when a correct code arrives in the middle of the burst.
    this.#failedAttempts.push(this.#now());
    if (this.#failedAttempts.length >= this.#maxPairingAttempts) {
      throw new DesaignSyncHostError('RATE_LIMITED', 'Too many pairing attempts. Wait a minute and retry.', {
        retryable: true
      });
    }
  }

  pair(pairingCode: string, meta: { clientName?: string; extensionId?: string } = {}): IssuedSession {
    this.#assertAttemptsAllowed();
    if (!this.isPairingOpen()) {
      throw new DesaignSyncHostError(
        'UNAUTHORIZED',
        'The pairing window is closed. Restart the host or run it with --pair.'
      );
    }
    const expected = Buffer.from(this.#pairingCode, 'utf8');
    const provided = Buffer.from((pairingCode ?? '').trim().toUpperCase(), 'utf8');
    const matches = expected.length === provided.length && timingSafeEqual(expected, provided);
    if (!matches) {
      this.#failedAttempts.push(this.#now());
      throw new DesaignSyncHostError('UNAUTHORIZED', 'Invalid pairing code.');
    }
    this.closePairingWindow();
    return this.#issue(meta);
  }

  #issue(meta: { clientName?: string; extensionId?: string }): IssuedSession {
    const rawToken = this.#randomBytesFn(32).toString('hex');
    const now = this.#now();
    const session: SessionRecord = {
      id: this.#randomBytesFn(8).toString('hex'),
      tokenHash: sha256(rawToken).toString('hex'),
      createdAt: now,
      expiresAt: now + this.#tokenTtlMs,
      lastSeenAt: now,
      ...(meta.clientName ? { clientName: meta.clientName } : {}),
      ...(meta.extensionId ? { extensionId: meta.extensionId } : {})
    };
    this.#sessions.set(session.id, session);
    return { session, token: rawToken, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  verify(token: string | undefined): SessionRecord | undefined {
    if (!token) return undefined;
    const candidate = sha256(token);
    const now = this.#now();
    this.pruneExpired();
    for (const session of this.#sessions.values()) {
      const stored = Buffer.from(session.tokenHash, 'hex');
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
        session.lastSeenAt = now;
        return session;
      }
    }
    return undefined;
  }

  renew(token: string | undefined): IssuedSession | undefined {
    const session = this.verify(token);
    if (!session) return undefined;
    this.#sessions.delete(session.id);
    return this.#issue({
      ...(session.clientName ? { clientName: session.clientName } : {}),
      ...(session.extensionId ? { extensionId: session.extensionId } : {})
    });
  }

  revoke(token: string | undefined): boolean {
    const session = this.verify(token);
    if (!session) return false;
    return this.#sessions.delete(session.id);
  }

  list(): SessionRecord[] {
    this.pruneExpired();
    return [...this.#sessions.values()];
  }

  pruneExpired(): void {
    const now = this.#now();
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(id);
      }
    }
  }
}
