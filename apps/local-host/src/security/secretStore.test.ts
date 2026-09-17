import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createEncryptedFileStore,
  createSecretStore
} from './secretStoreFactory.js';
import { createOsKeychainStore } from './secretStoreOs.js';

describe('encrypted-file secret store (DS-009 fallback)', () => {
  it('round-trips secrets and lists references only, never values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'desaignsync-secrets-'));
    const store = createEncryptedFileStore({ dir });

    await store.set('openai.key', 'sk-fixture-1234567890');
    expect(await store.get('openai.key')).toBe('sk-fixture-1234567890');
    expect(await store.list()).toEqual(['openai.key']);

    const onDisk = readFileSync(join(dir, 'secrets.enc.json'), 'utf8');
    expect(onDisk).not.toContain('sk-fixture-1234567890');
    expect(existsSync(join(dir, 'secrets.key'))).toBe(true);
  });

  it('deletes secrets and reports missing refs as undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'desaignsync-secrets-'));
    const store = createEncryptedFileStore({ dir });

    await store.set('anthropic.key', 'ak-live-abcdef');
    expect(await store.delete('anthropic.key')).toBe(true);
    expect(await store.delete('anthropic.key')).toBe(false);
    expect(await store.get('anthropic.key')).toBeUndefined();
  });

  it('rejects invalid references instead of passing them through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'desaignsync-secrets-'));
    const store = createEncryptedFileStore({ dir });
    await expect(store.get('has space')).rejects.toThrow(/Secret references/);
  });
});

describe('OS keychain backend (DS-009) with an injected CLI runner', () => {
  it('builds macOS security commands and passes the secret through stdin', async () => {
    const calls: Array<{ file: string; args: string[]; input?: string }> = [];
    const store = createOsKeychainStore({
      platform: 'darwin',
      runner: async (file, args, options) => {
        calls.push({ file, args, ...(options?.input ? { input: options.input } : {}) });
        if (args[0] === 'find-generic-password') {
          return { code: 44, stdout: '', stderr: 'not found' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
    });

    await store.set('openai.key', 'sk-new-secret');
    expect(calls[0]?.file).toBe('security');
    expect(calls[0]?.args).toContain('-w');
    expect(calls[0]?.args).not.toContain('sk-new-secret');
    expect(calls[0]?.input).toBe('sk-new-secret\n');
    expect(await store.get('openai.key')).toBeUndefined();
  });

  it('returns the stored value for a successful lookup', async () => {
    const store = createOsKeychainStore({
      platform: 'darwin',
      runner: async (_file, args) => {
        if (args[0] === 'find-generic-password') {
          return { code: 0, stdout: 'sk-found-value\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
    });
    expect(await store.get('openai.key')).toBe('sk-found-value');
  });

  it('is unavailable on unsupported platforms', () => {
    expect(() => createOsKeychainStore({ platform: 'win32' })).toThrow(/No OS credential store backend/);
  });
});

describe('secret store factory (DS-009)', () => {
  it('prefers the OS keychain when the platform supports it', () => {
    const store = createSecretStore({ dataDir: mkdtempSync(join(tmpdir(), 'ds-factory-')), platform: 'darwin' });
    expect(store.kind).toBe('os-keychain');
  });

  it('falls back to the encrypted file when the platform has no OS backend', () => {
    const store = createSecretStore({
      dataDir: mkdtempSync(join(tmpdir(), 'ds-factory-')),
      platform: 'win32'
    });
    expect(store.kind).toBe('encrypted-file');
  });
});