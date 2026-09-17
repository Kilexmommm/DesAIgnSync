import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  DesaignSyncHostError,
  type HostConfigFile,
  type LlmProviderConfig,
  type McpServerConfig,
  type ValidationProfile
} from '@desaignsync/shared-types';

import type { Logger } from '../logging/logger.js';

export const HOST_CONFIG_FILE_VERSION = 1;

const SECRET_KEY_PATTERN = /"(api[-_]?key|apikey|secret|password|passwd)":/i;

/**
 * Persists host settings in `~/.desaignsync/config.json` (DS-028).
 *
 * Security rules (spec v2.1 §19): the file only ever stores *references* to secrets
 * (`apiKeySecretRef`, `envRefs`), never values. A defensive check refuses to write anything
 * that looks like a secret key so a future field cannot leak one by accident.
 */
export class ConfigStore {
  readonly #path: string;
  readonly #logger: Logger;

  constructor(options: { configPath: string; logger: Logger }) {
    this.#path = options.configPath;
    this.#logger = options.logger;
  }

  get path(): string {
    return this.#path;
  }

  /** Reads the file as a partial config: a missing file is a valid first run. */
  read(): Partial<HostConfigFile> {
    if (!existsSync(this.#path)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.#path, 'utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed as Partial<HostConfigFile>;
    } catch {
      throw new DesaignSyncHostError(
        'CONFIG_INVALID',
        `Cannot parse the host config file at ${this.#path}. Fix or remove it and restart the host.`
      );
    }
  }

  #write(next: Partial<HostConfigFile>): void {
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    if (SECRET_KEY_PATTERN.test(serialized)) {
      throw new DesaignSyncHostError(
        'CONFIG_INVALID',
        'Refusing to persist secret-looking fields in the host config file.'
      );
    }
    mkdirSync(dirname(this.#path), { recursive: true });
    const tmpPath = `${this.#path}.tmp`;
    writeFileSync(tmpPath, serialized, { mode: 0o600 });
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, this.#path);
  }

  /** Read-modify-write so sections owned by other components are preserved. */
  update(patch: Partial<HostConfigFile>): Partial<HostConfigFile> {
    const next: Partial<HostConfigFile> = { ...this.read(), ...patch, version: HOST_CONFIG_FILE_VERSION };
    this.#write(next);
    this.#logger.debug('Host config persisted', { path: this.#path, sections: Object.keys(patch) });
    return next;
  }

  saveMcpServers(servers: readonly McpServerConfig[]): void {
    this.update({ mcpServers: [...servers] });
  }

  saveLlmProviders(providers: readonly LlmProviderConfig[]): void {
    this.update({ llmProviders: [...providers] });
  }

  /** Only custom profiles are persisted: built-ins come from the catalog (DS-017). */
  saveProfiles(profiles: readonly ValidationProfile[]): void {
    this.update({ profiles: profiles.filter((profile) => profile.isBuiltIn !== true) });
  }
}
