import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DesaignSyncHostError } from '@desaignsync/shared-types';

import { assertSecretRef, type SecretBackendKind, type SecretStore } from './secretStore.js';

const execFileAsync = promisify(execFile);

export interface CliRunnerResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (
  file: string,
  args: string[],
  options?: { input?: string }
) => Promise<CliRunnerResult>;

export const defaultCliRunner: CliRunner = async (file, args, options) => {
  try {
    const result = await execFileAsync(file, args, {
      ...(options?.input !== undefined
        ? { input: options.input } as Parameters<typeof execFileAsync>[2]
        : {})
    });
    return { code: 0, stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const err = error as { code?: number | string; stdout?: unknown; stderr?: unknown };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : ''
    };
  }
};

const KEYCHAIN_SERVICE = 'desaignsync';

export interface OsKeychainOptions {
  platform?: NodeJS.Platform;
  runner?: CliRunner;
  service?: string;
}

/**
 * OS credential store backend (DS-009). macOS uses the `security` CLI; Linux uses
 * `secret-tool` (libsecret). Secrets are passed through stdin, never through argv,
 * so they do not leak into the process list.
 */
export const createOsKeychainStore = (options: OsKeychainOptions = {}): SecretStore => {
  const platform = options.platform ?? process.platform;
  const service = options.service ?? KEYCHAIN_SERVICE;
  const run = options.runner ?? defaultCliRunner;

  if (platform !== 'darwin' && platform !== 'linux') {
    throw new DesaignSyncHostError(
      'SECRET_STORE_UNAVAILABLE',
      'No OS credential store backend for this platform; use the encrypted-file fallback.'
    );
  }

  const assertSupported = (): void => {
    if (platform === 'darwin') return; // `security` ships with macOS.
    throw new DesaignSyncHostError(
      'SECRET_STORE_UNAVAILABLE',
      'secret-tool (libsecret) is required for the OS credential store on Linux.'
    );
  };

  return {
    kind: 'os-keychain',
    async get(ref) {
      assertSupported();
      const cleanRef = assertSecretRef(ref);
      if (platform === 'darwin') {
        const result = await run('security', ['find-generic-password', '-s', service, '-a', cleanRef, '-w']);
        if (result.code === 44) return undefined; // item not found
        if (result.code !== 0) {
          throw new DesaignSyncHostError('SECRET_STORE_UNAVAILABLE', 'The OS credential store refused the lookup.');
        }
        return result.stdout.trim() === '' ? undefined : result.stdout.replace(/\n$/, '');
      }
      const result = await run('secret-tool', ['lookup', 'service', service, 'account', cleanRef]);
      if (result.code !== 0) {
        throw new DesaignSyncHostError('SECRET_STORE_UNAVAILABLE', 'The OS credential store refused the lookup.');
      }
      return result.stdout.trim() === '' ? undefined : result.stdout.replace(/\n$/, '');
    },
    async set(ref, value) {
      assertSupported();
      const cleanRef = assertSecretRef(ref);
      if (platform === 'darwin') {
        // `-w` without a value reads the password from stdin (one line).
        const result = await run('security', ['add-generic-password', '-U', '-s', service, '-a', cleanRef, '-w'], {
          input: `${value}\n`
        });
        if (result.code !== 0) {
          throw new DesaignSyncHostError('SECRET_STORE_UNAVAILABLE', 'The OS credential store refused the write.');
        }
        return;
      }
      const result = await run('secret-tool', ['store', 'service', service, 'account', cleanRef], { input: value });
      if (result.code !== 0) {
        throw new DesaignSyncHostError('SECRET_STORE_UNAVAILABLE', 'The OS credential store refused the write.');
      }
    },
    async delete(ref) {
      assertSupported();
      const cleanRef = assertSecretRef(ref);
      if (platform === 'darwin') {
        const result = await run('security', ['delete-generic-password', '-s', service, '-a', cleanRef]);
        if (result.code === 44) return false;
        if (result.code !== 0) {
          throw new DesaignSyncHostError('SECRET_STORE_UNAVAILABLE', 'The OS credential store refused the delete.');
        }
        return true;
      }
      const result = await run('secret-tool', ['clear', 'service', service, 'account', cleanRef]);
      if (result.code !== 0) return false;
      return true;
    },
    async list() {
      // The OS CLIs cannot enumerate our items reliably; callers keep their own ref index.
      return [];
    }
  };
};