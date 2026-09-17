/**
 * Secret redaction used by logs, error payloads and (later) LLM payloads.
 * Rule: secrets never appear in logs, reports, exports, prompts or browser storage (spec v2.1 §19).
 */

export const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|apikey|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|credential|cookie|set-cookie|private[-_]?key|session[-_]?id|mcp[-_]?session[-_]?id)/i;

const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi;
const KNOWN_KEY_PATTERN = /\b(sk|pk|rk|ghp|gho|ghs|xoxb|xoxp|AIza)[-_A-Za-z0-9]{8,}\b/g;
const LONG_HEX_PATTERN = /\b[A-Fa-f0-9]{32,}\b/g;

export function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `$1${REDACTED}`)
    .replace(KNOWN_KEY_PATTERN, REDACTED)
    .replace(LONG_HEX_PATTERN, REDACTED);
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return redactString(rawUrl);
  }
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1);
  }
  return result;
}

/** Redacts a plain field bag (used by the structured logger). */
export function redactFields(
  fields: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  return redactValue(fields) as Record<string, unknown>;
}