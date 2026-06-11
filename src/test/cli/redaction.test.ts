import { describe, expect, it } from 'bun:test';
import { REDACTED_VALUE, redactText } from '../../cli/redaction.ts';

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
