import { spawn } from 'node:child_process';

import { DesaignSyncHostError } from '@desaignsync/shared-types';

import { assertSecretRef, type SecretBackendKind, type SecretStore } from './secretStore.js';

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

/**
 * Runs an OS credential-store CLI. Secrets travel through stdin (never argv) and every call is
 * bounded by a timeout: a misbehaving CLI must never hang the host.
 */
export const defaultCliRunner: CliRunner = (file, args, options) =>
  new Promise<CliRunnerResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CliRunnerResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
      finish({ code: 124, stdout, stderr: `${stderr}\ncredential store CLI timed out` });
    }, 10_000);
    timer.unref?.();

    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => finish({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));

    if (options?.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });

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