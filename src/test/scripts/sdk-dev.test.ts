// ---------------------------------------------------------------------------
// sdk-dev.test.ts
//
// Unit-tests the pure lifecycle helpers of scripts/sdk-dev.ts (the local-SDK
// overlay dev tool): the three status states (overlay active, clean npm), the
// devDependencies pin reader, and the restore version-agreement check. The
// link/restore filesystem+build side effects are intentionally NOT exercised
// here (they require a real SDK build); this covers the decision logic that
// decides what those commands report and when they fail.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { overlayStatus, readSdkPin, restoreVersionIssue } from '../../../scripts/sdk-dev.ts';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('sdk-dev overlayStatus', () => {
  test('reports OVERLAY ACTIVE with exit code 2 when the marker exists', () => {
    const marker = JSON.stringify({ sdkGit: 'main@abc1234 (dirty)', overlaidAt: '2026-07-04T00:00:00.000Z', sourcePath: '/x/goodvibes-sdk' });
    const s = overlayStatus(marker, '0.38.0');
    expect(s.active).toBe(true);
    expect(s.exitCode).toBe(2);
    expect(s.line).toContain('OVERLAY ACTIVE');
    expect(s.line).toContain('main@abc1234');
  });

  test('reports clean npm state with exit code 0 when no marker exists', () => {
    const s = overlayStatus(null, '0.38.0');
    expect(s.active).toBe(false);
    expect(s.exitCode).toBe(0);
    expect(s.line).toContain('clean');
    expect(s.line).toContain('0.38.0');
  });
});

describe('sdk-dev restoreVersionIssue', () => {
  test('returns null when the restored version equals the pin', () => {
    expect(restoreVersionIssue('0.38.0', '0.38.0')).toBeNull();
  });

  test('returns an issue string when the restored version differs from the pin', () => {
    const issue = restoreVersionIssue('0.37.2', '0.38.0');
    expect(issue).not.toBeNull();
    expect(issue).toContain('0.37.2');
    expect(issue).toContain('0.38.0');
  });
});

describe('sdk-dev readSdkPin', () => {
  test('reads the pin from devDependencies (the Agent bundles the SDK)', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-sdk-pin-'));
    created.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@pellux/goodvibes-sdk': '0.38.0' } }));
    expect(readSdkPin(root)).toBe('0.38.0');
  });

  test('falls back to dependencies when not in devDependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-sdk-pin-'));
    created.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@pellux/goodvibes-sdk': '0.38.0' } }));
    expect(readSdkPin(root)).toBe('0.38.0');
  });
});
