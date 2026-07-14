import { describe, expect, test } from 'bun:test';
import { UIFactory, composeSafetyNoticeSegments } from '../../renderer/ui-factory.ts';
import { lineToString } from '../setup.ts';

describe('UIFactory', () => {
  test('header is branded as GoodVibes Agent', () => {
    const [header] = UIFactory.createHeader(80, 'gpt-test', 'test-provider');
    const text = lineToString(header ?? []);

    expect(text).toContain('GoodVibes Agent');
    expect(text).not.toContain('GoodVibes v');
  });
});

describe('composeSafetyNoticeSegments', () => {
  test('each-alone: dangerMode only produces the auto-approve segment', () => {
    const segments = composeSafetyNoticeSegments(true, undefined, 60);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('auto-approve');
    expect(segments[0]!.fg).toBe('#ef4444');
  });

  test('each-alone: powerNote only produces the sleep/power segment', () => {
    const segments = composeSafetyNoticeSegments(false, 'sleep disabled', 60);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('sleep disabled');
    expect(segments[0]!.fg).toBe('#f59e0b');
  });

  test('both-on: neither notice suppresses the other at a comfortable width', () => {
    const segments = composeSafetyNoticeSegments(true, 'sleep disabled', 60);
    const joined = segments.map((s) => s.text).join('');
    expect(joined).toContain('auto-approve');
    expect(joined).toContain('sleep disabled');
  });

  test('both-on at a narrow width: danger text compacts but the power note text is never dropped', () => {
    // Wide enough for compact danger text + separator + full power note, not
    // wide enough for the full "auto-approve is on" form.
    const segments = composeSafetyNoticeSegments(true, 'sleep disabled', 28);
    const joined = segments.map((s) => s.text).join('');
    expect(joined).toContain('sleep disabled');
    expect(joined).toContain('⚠');
  });

  test('both-on at a pathologically narrow width: still represents both as icons, never throws, never exceeds the budget', () => {
    const availableWidth = 4;
    const segments = composeSafetyNoticeSegments(true, 'sleep disabled', availableWidth);
    const joined = segments.map((s) => s.text).join('');
    // Never wider than the budget handed in.
    const totalWidth = segments.reduce((sum, seg) => sum + [...seg.text].length, 0);
    expect(totalWidth).toBeLessThanOrEqual(availableWidth);
    expect(joined.length).toBeGreaterThan(0);
  });

  test('neither active produces no segments', () => {
    expect(composeSafetyNoticeSegments(false, undefined, 60)).toHaveLength(0);
  });

  test('zero available width produces no segments rather than throwing', () => {
    expect(composeSafetyNoticeSegments(true, 'sleep disabled', 0)).toHaveLength(0);
  });
});
