import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DesaignSyncHostError } from '@desaignsync/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PORT,
  HOST_VERSION,
  LOOPBACK_HOST,
  loadHostConfig,
  resolveConfigPath,
  resolveDataDir
} from './hostConfig.js';

const tempDirs: string[] = [];

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'desaignsync-config-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('host config (DS-003 acceptance criteria)', () => {
  it('defaults to loopback, the default port and no pinned origins', () => {
    const dir = tempDir();
    const config = loadHostConfig({ env: { DESAIGNSYNC_HOME: dir } });

    expect(config.host).toBe(LOOPBACK_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.pinnedExtensionOrigins).toEqual([]);
    expect(config.logLevel).toBe('info');
    expect(config.configPath).toBe(resolveConfigPath(dir));
    expect(HOST_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reads config.json and lets environment variables override it without recompiling', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ port: 9001, logLevel: 'warn' }),
      'utf8'
    );

    expect(loadHostConfig({ env: { DESAIGNSYNC_HOME: dir } }).port).toBe(9001);

    const overridden = loadHostConfig({
      env: { DESAIGNSYNC_HOME: dir, DESAIGNSYNC_PORT: '7333', DESAIGNSYNC_LOG_LEVEL: 'debug' }
    });
    expect(overridden.port).toBe(7333);
    expect(overridden.logLevel).toBe('debug');
  });

  it('refuses to bind anything other than loopback', () => {
    const dir = tempDir();
    expect(() => loadHostConfig({ env: { DESAIGNSYNC_HOME: dir }, overrides: { host: '0.0.0.0' } })).toThrow(
      DesaignSyncHostError
    );
  });

  it('rejects invalid port and log level values instead of silently coercing', () => {
    const dir = tempDir();
    expect(() => loadHostConfig({ env: { DESAIGNSYNC_HOME: dir, DESAIGNSYNC_PORT: 'not-a-port' } })).toThrow(
      /Invalid configuration value/
    );
    expect(() => loadHostConfig({ env: { DESAIGNSYNC_HOME: dir, DESAIGNSYNC_LOG_LEVEL: 'loud' } })).toThrow(
      /Invalid configuration value/
    );
  });

  it('pins extension origins from the env and disables the chrome-extension wildcard', () => {
    const dir = tempDir();
    const config = loadHostConfig({
      env: {
        DESAIGNSYNC_HOME: dir,
        DESAIGNSYNC_EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnop, chrome-extension://ponmlkjihgfedcba'
      }
    });

    expect(config.pinnedExtensionOrigins).toEqual([
      'chrome-extension://abcdefghijklmnop',
      'chrome-extension://ponmlkjihgfedcba'
    ]);
    expect(config.allowExtensionScheme).toBe(false);
  });

  it('resolves the data directory from DESAIGNSYNC_HOME', () => {
    expect(resolveDataDir({ DESAIGNSYNC_HOME: '/tmp/custom' })).toBe('/tmp/custom');
    expect(resolveDataDir({}).endsWith('.desaignsync')).toBe(true);
  });
});