import { describe, expect, it } from 'bun:test';
import { REDACTED_VALUE, redactConfig, redactText } from '../../cli/redaction.ts';

describe('redactText', () => {
  it('redacts assignment-form sensitive keywords', () => {
    expect(redactText('token=abc123xyz')).toBe(`token=${REDACTED_VALUE}`);
    expect(redactText('api_key=sk-abc123')).toBe(`api_key=${REDACTED_VALUE}`);
    expect(redactText('api-key=sk-abc123')).toBe(`api-key=${REDACTED_VALUE}`);
    expect(redactText('secret=my-secret')).toBe(`secret=${REDACTED_VALUE}`);
    expect(redactText('password=hunter2')).toBe(`password=${REDACTED_VALUE}`);
    expect(redactText('access_token=eyJhbGci')).toBe(`access_token=${REDACTED_VALUE}`);
  });

  it('redacts colon-form sensitive keywords', () => {
    expect(redactText('token: abc123xyz')).toBe(`token: ${REDACTED_VALUE}`);
    expect(redactText('api_key: sk-abc123')).toBe(`api_key: ${REDACTED_VALUE}`);
    expect(redactText('secret: my-secret')).toBe(`secret: ${REDACTED_VALUE}`);
    expect(redactText('password: hunter2')).toBe(`password: ${REDACTED_VALUE}`);
  });

  it('does NOT redact false-positive keyword substrings (monkey=, donkey=, keyboard=)', () => {
    expect(redactText('monkey=foo')).toBe('monkey=foo');
    expect(redactText('donkey=bar')).toBe('donkey=bar');
    expect(redactText('keyboard=qwerty')).toBe('keyboard=qwerty');
    expect(redactText('hotkey=ctrl+s')).toBe('hotkey=ctrl+s');
  });

  it('redacts token that starts at a word boundary without preceding letter', () => {
    // e.g. in a query string or log line
    expect(redactText('?token=abc&other=val')).toContain(REDACTED_VALUE);
    expect(redactText('?token=abc&other=val')).not.toContain('abc');
  });

  it('does not disturb text without sensitive keywords', () => {
    const safe = 'hello world, status=ok, count=42';
    expect(redactText(safe)).toBe(safe);
  });
});

describe('shouldRedactValue (via redactConfig)', () => {
  // Redaction rule: on a sensitive path, redact non-empty strings (not goodvibes:// refs),
  // and truthy non-string values. Do NOT redact false, 0, null, undefined, or empty string.
  it('redacts a non-empty string value on a sensitive path', () => {
    const { value } = redactConfig({ token: 'abc123' });
    expect((value as { token: unknown }).token).toBe(REDACTED_VALUE);
  });

  it('does not redact false on a sensitive path (falsy non-string)', () => {
    const { value } = redactConfig({ token: false });
    expect((value as { token: unknown }).token).toBe(false);
  });

  it('does not redact 0 on a sensitive path (falsy non-string)', () => {
    const { value } = redactConfig({ token: 0 });
    expect((value as { token: unknown }).token).toBe(0);
  });

  it('does not redact empty string on a sensitive path', () => {
    const { value } = redactConfig({ token: '' });
    expect((value as { token: unknown }).token).toBe('');
  });

  it('redacts a truthy number on a sensitive path', () => {
    // Non-zero numbers on sensitive paths are redacted (truthy non-string).
    // Rationale: a numeric token/port stored as number under a secret key is a real secret.
    // isSensitiveConfigPath('.token') => true; value is 4242 (truthy) => redacted.
    const { value } = redactConfig({ token: 4242 });
    expect((value as { token: unknown }).token).toBe(REDACTED_VALUE);
  });
});
