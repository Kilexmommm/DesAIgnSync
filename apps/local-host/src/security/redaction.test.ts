import { describe, expect, it } from 'vitest';

import { REDACTED, redactFields, redactString, redactUrl, redactValue } from './redaction.js';

describe('redaction (DS-003 / spec §19)', () => {
  it('masks bearer tokens and known key prefixes in strings', () => {
    expect(redactString('Authorization: Bearer abc123def456')).toContain(REDACTED);
    expect(redactString('key sk-live-1234567890abcdef')).toContain(REDACTED);
    expect(redactString('nothing sensitive here')).toBe('nothing sensitive here');
  });

  it('masks sensitive keys while preserving safe fields', () => {
    const result = redactFields({
      apiKey: 'sk-abcdef123456',
      serverId: 'chrome-devtools',
      nested: { authorization: 'Bearer xyz', port: 8787 }
    });

    expect(result).toEqual({
      apiKey: REDACTED,
      serverId: 'chrome-devtools',
      nested: { authorization: REDACTED, port: 8787 }
    });
  });

  it('strips credentials and token query parameters from URLs', () => {
    const redacted = redactUrl('http://user:pass@127.0.0.1:8787/events?token=deadbeefcafe&mode=audit');
    expect(redacted).not.toContain('deadbeefcafe');
    expect(redacted).not.toContain('pass@');
    expect(redacted).toContain('mode=audit');
  });

  it('redacts long hexadecimal tokens even without a sensitive key', () => {
    const value = redactValue({ sessionId: 'a'.repeat(64) });
    expect(value).toEqual({ sessionId: REDACTED });
  });
});