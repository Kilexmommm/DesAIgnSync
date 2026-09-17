import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DesaignSyncHostError } from '@desaignsync/shared-types';
import type { HostConfigFile } from '@desaignsync/shared-types';

export const HOST_VERSION = '0.1.0';

/** Loopback only. The host never binds a public interface by default (DS-003). */
export const LOOPBACK_HOST = '127.0.0.1';

export const DEFAULT_PORT = 8787;

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface HostRuntimeConfig {
  host: string;
  port: number;
  dataDir: string;
  configPath: string;
  logLevel: LogLevel;
  /** Accept any `chrome-extension://` origin. Pairing code + token stay the real control. */
  allowExtensionScheme: boolean;
  /** When non-empty, only these exact extension origins are accepted (production hardening). */
  pinnedExtensionOrigins: string[];
  tokenTtlMs: number;
  pairingWindowMs: number;
  maxPairingAttempts: number;
  requestBodyLimitBytes: number;
  defaultMcpTimeoutMs: number;
  allowDevRemoteOrigins: boolean;
}

export interface LoadHostConfigOptions {
  configPath?: string | undefined;
  env?: Record<string, string | undefined>;
  overrides?: Partial<HostRuntimeConfig>;
}

const LOG_LEVELS: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];

const invalid = (field: string, value: unknown): DesaignSyncHostError =>
  new DesaignSyncHostError('CONFIG_INVALID', `Invalid configuration value for "${field}".`, {
    details: { field, received: typeof value === 'string' ? value : String(value) }
  });

const parseInteger = (field: string, raw: string): number => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw invalid(field, raw);
  }
  return parsed;
};

const parseBoolean = (field: string, raw: string): boolean => {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw invalid(field, raw);
};

const parseList = (raw: string): string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const resolveDataDir = (env: Record<string, string | undefined>): string =>
  env['DESAIGNSYNC_HOME']?.trim() || join(homedir(), '.desaignsync');

export const resolveConfigPath = (dataDir: string): string => join(dataDir, 'config.json');

/**
 * Reads `~/.desaignsync/config.json` when present and applies environment/CLI overrides,
 * so port and logging can change without recompiling (DS-003 acceptance criteria).
 */
export function loadHostConfig(options: LoadHostConfigOptions = {}): HostRuntimeConfig {
  const env = options.env ?? process.env;
  const dataDir = resolveDataDir(env);
  const configPath = options.configPath ?? resolveConfigPath(dataDir);

  let fileConfig: Partial<HostConfigFile> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<HostConfigFile>;
    } catch (error) {
      throw new DesaignSyncHostError('CONFIG_INVALID', `Cannot parse config file at ${configPath}.`, {
        details: { reason: error instanceof Error ? error.name : 'unknown' }
      });
    }
  }

  const envPort = env['DESAIGNSYNC_PORT'];
  const envLogLevel = env['DESAIGNSYNC_LOG_LEVEL'];
  const envPinned = env['DESAIGNSYNC_EXTENSION_ORIGINS'];
  const envAllowScheme = env['DESAIGNSYNC_ALLOW_EXTENSION_SCHEME'];
  const envDevOrigins = env['DESAIGNSYNC_ALLOW_DEV_REMOTE_ORIGINS'];
  const envTokenTtl = env['DESAIGNSYNC_TOKEN_TTL_MS'];
  const envPairingWindow = env['DESAIGNSYNC_PAIRING_WINDOW_MS'];

  const logLevel = (envLogLevel ?? fileConfig.logLevel ?? 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw invalid('logLevel', logLevel);
  }

  const pinnedExtensionOrigins =
    envPinned !== undefined ? parseList(envPinned) : (fileConfig.pinnedExtensionOrigins ?? []);

  const config: HostRuntimeConfig = {
    host: LOOPBACK_HOST,
    port:
      envPort !== undefined
        ? parseInteger('port', envPort)
        : typeof fileConfig.port === 'number'
          ? fileConfig.port
          : DEFAULT_PORT,
    dataDir,
    configPath,
    logLevel,
    allowExtensionScheme:
      envAllowScheme !== undefined
        ? parseBoolean('allowExtensionScheme', envAllowScheme)
        : pinnedExtensionOrigins.length === 0,
    pinnedExtensionOrigins,
    tokenTtlMs: envTokenTtl !== undefined ? parseInteger('tokenTtlMs', envTokenTtl) : 12 * 60 * 60 * 1000,
    pairingWindowMs:
      envPairingWindow !== undefined ? parseInteger('pairingWindowMs', envPairingWindow) : 10 * 60 * 1000,
    maxPairingAttempts: 5,
    requestBodyLimitBytes: 1024 * 1024,
    defaultMcpTimeoutMs: 20_000,
    allowDevRemoteOrigins: envDevOrigins !== undefined ? parseBoolean('allowDevRemoteOrigins', envDevOrigins) : false
  };

  const merged: HostRuntimeConfig = { ...config, ...stripUndefined(options.overrides) };
  if (merged.host !== LOOPBACK_HOST) {
    throw new DesaignSyncHostError(
      'CONFIG_INVALID',
      'The Local Host only accepts loopback binding addresses (127.0.0.1 or ::1).'
    );
  }
  return merged;
}

const stripUndefined = (value: Partial<HostRuntimeConfig> | undefined): Partial<HostRuntimeConfig> => {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<HostRuntimeConfig>;
};
