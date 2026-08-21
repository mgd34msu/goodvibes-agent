import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNBOOK_RELATIVE_PATH, renderGoogleSetupRunbook } from '@pellux/goodvibes-sdk/platform/google';

/**
 * docs/google-setup-runbook.md declares itself generated from the SDK's Google
 * setup plan and warns that "the test that compares the two will fail" on
 * divergence. This is that test. It failed to exist for a while, and the
 * checked-in runbook silently drifted a full SDK cycle behind the generator.
 * Run `bun run scripts/generate-google-runbook.ts` to bring the file back in
 * line after an SDK bump or a plan edit.
 */
describe('google setup runbook stays generated', () => {
  test('the checked-in runbook matches the pinned SDK generator byte for byte', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const checkedIn = readFileSync(join(repoRoot, RUNBOOK_RELATIVE_PATH), 'utf-8');
    expect(checkedIn).toBe(renderGoogleSetupRunbook());
  });
});
