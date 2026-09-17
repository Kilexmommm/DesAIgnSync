import type { LogLevel } from '../config/hostConfig.js';
import { redactFields, redactString } from '../security/redaction.js';

/** Structured logger. Everything goes to stderr so stdout stays reserved for the pairing banner. */
export interface Logger {
  readonly level: LogLevel;
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

export interface CreateLoggerOptions {
  level: LogLevel;
  sink?: (line: string) => void;
  bindings?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const bindings = options.bindings ?? {};

  const emit =
    (level: Exclude<LogLevel, 'silent'>) =>
    (message: string, fields?: Record<string, unknown>): void => {
      if (LEVEL_WEIGHT[options.level] < LEVEL_WEIGHT[level]) return;
      const payload = {
        ts: new Date().toISOString(),
        level,
        msg: redactString(message),
        ...(redactFields({ ...bindings, ...(fields ?? {}) }) ?? {})
      };
      sink(JSON.stringify(payload));
    };

  return {
    level: options.level,
    error: emit('error'),
    warn: emit('warn'),
    info: emit('info'),
    debug: emit('debug'),
    child: (extra: Record<string, unknown>) =>
      createLogger({ level: options.level, sink, bindings: { ...bindings, ...extra } })
  };
}