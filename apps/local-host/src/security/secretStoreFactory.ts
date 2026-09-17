import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { DesaignSyncHostError } from '@desaignsync/shared-types';

import { createEncryptedFileStore, type SecretBackendKind, type SecretStore } from './secretStore.js';
import { createOsKeychainStore } from './secretStoreOs.js';

export * from './secretStore.js';
export { createOsKeychainStore, defaultCliRunner, type CliRunner, type OsKeychainOptions } from './secretStoreOs.js';

export interface CreateSecretStoreOptions {
  dataDir: string;
  /** Prefer the OS credential store when the platform supports it. Default: true. */
  preferOsKeychain?: boolean;
  /** Test seam: platform override for the OS backend selection. */
  platform?: NodeJS.Platform;
  /** Test seam: CLI runner override. */
  runner?: import('./secretStoreOs.js').CliRunner;
}

/**
 * Chooses the strongest available backend (DS-009): OS credential store first,
 * encrypted-file fallback documented as weaker (spec v2.1 §19).
 */
export const createSecretStore = (options: CreateSecretStoreOptions): SecretStore => {
  const preferOs = options.preferOsKeychain !== false;
  if (preferOs) {
    try {
      return createOsKeychainStore({
        ...(options.platform ? { platform: options.platform } : {}),
        ...(options.runner ? { runner: options.runner } : {})
      });
    } catch (error) {
      if (!(error instanceof DesaignSyncHostError)) throw error;
      // fall through to the encrypted-file fallback
    }
  }
  if (!existsSync(options.dataDir)) {
    mkdirSync(options.dataDir, { recursive: true });
  }
  return createEncryptedFileStore({ dir: join(options.dataDir) });
};

export type { SecretBackendKind, SecretStore };