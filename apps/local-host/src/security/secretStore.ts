import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DesaignSyncHostError } from '@desaignsync/shared-types';

/**
 * Secret storage for the Local MCP Host (DS-009, spec v2.1 §19).
 * Values never leave the host process: the Side Panel only ever receives secret *references*.
 */
export type SecretBackendKind = 'os-keychain' | 'encrypted-file';

export interface SecretStore {
  readonly kind: SecretBackendKind;
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<boolean>;
  /** Returns references only. Never values. */
  list(): Promise<string[]>;
}

export const assertSecretRef = (ref: string): string => {
  const trimmed = ref.trim();
  if (trimmed === '' || /\s/.test(trimmed) || trimmed.length > 128) {
    throw new DesaignSyncHostError('CONFIG_INVALID', 'Secret references must be 1..128 chars without whitespace.');
  }
  return trimmed;
};

interface EncryptedItem {
  iv: string;
  tag: string;
  data: string;
}

interface EncryptedFilePayload {
  version: 1;
  items: Record<string, EncryptedItem>;
}

const KEY_FILE = 'secrets.key';
const DATA_FILE = 'secrets.enc.json';

const loadKey = (dir: string): Buffer => {
  const keyPath = join(dir, KEY_FILE);
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath);
    if (key.length !== 32) {
      throw new DesaignSyncHostError('SECRET_STORE_UNAVAILABLE', 'Local secret key file is corrupted.');
    }
    return key;
  }
  mkdirSync(dir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return key;
};

const readPayload = (dataPath: string): EncryptedFilePayload => {
  if (!existsSync(dataPath)) return { version: 1, items: {} };
  try {
    const parsed = JSON.parse(readFileSync(dataPath, 'utf8')) as EncryptedFilePayload;
    if (parsed.version !== 1 || typeof parsed.items !== 'object' || parsed.items === null) {
      throw new Error('bad payload');
    }
    return parsed;
  } catch {
    throw new DesaignSyncHostError(
      'SECRET_STORE_UNAVAILABLE',
      'The local encrypted secret file is corrupted and cannot be read.'
    );
  }
};

const writePayloadAtomic = (dir: string, dataPath: string, payload: EncryptedFilePayload): void => {
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${dataPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload), { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, dataPath);
};

/**
 * AES-256-GCM encrypted file store. Weaker than the OS credential store (the key lives
 * next to the data), so it is only a documented fallback when no OS store is available.
 */
export const createEncryptedFileStore = (options: { dir: string }): SecretStore => {
  const dir = options.dir;
  const dataPath = join(dir, DATA_FILE);
  const key = loadKey(dir);

  const encrypt = (value: string): EncryptedItem => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  };

  const decrypt = (item: EncryptedItem): string => {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8');
  };

  return {
    kind: 'encrypted-file',
    async get(ref) {
      const cleanRef = assertSecretRef(ref);
      const payload = readPayload(dataPath);
      const item = payload.items[cleanRef];
      if (!item) return undefined;
      try {
        return decrypt(item);
      } catch {
        throw new DesaignSyncHostError(
          'SECRET_STORE_UNAVAILABLE',
          `Cannot decrypt the secret referenced by "${cleanRef}".`
        );
      }
    },
    async set(ref, value) {
      const cleanRef = assertSecretRef(ref);
      const payload = readPayload(dataPath);
      payload.items[cleanRef] = encrypt(value);
      writePayloadAtomic(dir, dataPath, payload);
    },
    async delete(ref) {
      const cleanRef = assertSecretRef(ref);
      const payload = readPayload(dataPath);
      if (!(cleanRef in payload.items)) return false;
      delete payload.items[cleanRef];
      writePayloadAtomic(dir, dataPath, payload);
      return true;
    },
    async list() {
      return Object.keys(readPayload(dataPath).items);
    }
  };
};