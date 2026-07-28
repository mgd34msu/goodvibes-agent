/**
 * Temp-directory sweep for this project's test suite.
 *
 * Two distinct sweeps live here, because they cover two distinct locations
 * with two distinct safety models:
 *
 * 1. `sweepProjectTestTmpRoot` — the in-repo `.test-tmp/` root that
 *    `src/test/helpers/project-temp.ts`'s `makeProjectTempDir` writes under.
 *    This directory is exclusively owned by this project's own test runs
 *    (nothing else writes here), so a full unconditional wipe before and
 *    after each suite run is safe: there is nothing else in there to lose.
 *
 * 2. `sweepStaleRealTmpDirs` — the real system temp directory
 *    (`os.tmpdir()`, typically `/tmp`), which every process on the machine
 *    shares, including other repos' own test runs (each with their own,
 *    differently-prefixed scratch directories under
 *    `~/Projects/.gv-worktrees/*`). A handful of this project's own tests
 *    still create scratch directories directly under `os.tmpdir()` — see
 *    `KNOWN_TMPDIR_PREFIXES` below for exactly which, and why they cannot
 *    use `makeProjectTempDir` instead. When a test process is killed by a
 *    signal (rather than exiting normally), its `finally`/`afterEach`
 *    cleanup never runs, so these directories accumulate in real `/tmp`
 *    forever — this is what exhausted a tmpfs `/tmp`'s inode table.
 *    This sweep only ever removes a directory that BOTH (a) matches one of
 *    this project's own known prefixes exactly, by `startsWith`, and (b)
 *    has an mtime older than `REAL_TMPDIR_STALE_AGE_MS`. It never performs
 *    a blanket sweep of `os.tmpdir()`, and it never touches a directory it
 *    cannot attribute to this project by prefix.
 */
import { readdirSync, rmSync, statSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_TEST_TMP_ROOT = join(process.cwd(), '.test-tmp');

/**
 * Prefixes this project's tests use when creating a scratch directory
 * directly under the real system temp directory instead of the sanctioned
 * `makeProjectTempDir` helper (which places everything under the in-repo
 * `.test-tmp/`, itself swept unconditionally by `sweepProjectTestTmpRoot`).
 *
 * One entry is load-bearing and still created today, by design:
 *   - `gv-agent-identifier-gate-norepo-`
 *     (src/test/scripts/internal-identifier-gate.test.ts): needs a
 *     directory that is guaranteed NOT inside any git repository, AND
 *     guaranteed to bypass the TMPDIR/TMP/TEMP redirection
 *     `scripts/run-tests.ts` sets for the child test process (which points
 *     inside this repo) — an `os.tmpdir()`-based directory would silently
 *     resolve back inside this git tree during a normal suite run,
 *     defeating the "non-repo root" premise the test checks. See the
 *     comment at that call site. (`src/test/git/service.test.ts`'s
 *     `makeExternalDir` needs the same "not inside any repo" guarantee, but
 *     for exactly the same TMPDIR-redirection reason it deliberately does
 *     NOT use `os.tmpdir()` either — it targets the parent of this repo's
 *     own directory instead, so it never creates anything here.)
 *
 * Every other entry below is historical: every other call site that used
 * to create scratch directories under real `os.tmpdir()` was migrated onto
 * `makeProjectTempDir` on 2026-07-27, so these prefixes are never created
 * again from this point forward. They stay on this list purely so this
 * sweep also reclaims directories earlier (pre-migration) suite runs
 * already left behind in real `/tmp` — a killed test process never ran its
 * own cleanup. Once a repo-wide check confirms none of these remain on a
 * given machine, this legacy block can be pruned; leaving it is harmless
 * (it only ever matches directories that also pass the age gate).
 */
export const KNOWN_TMPDIR_PREFIXES: readonly string[] = [
  // Ongoing — still created today; see the comment above.
  'gv-agent-identifier-gate-norepo-',
  // Historical / legacy — see the comment above. `gv-agent-git-` is here
  // too (rather than "ongoing"): an earlier revision of this migration
  // briefly routed git/service.test.ts's makeExternalDir through
  // os.tmpdir() with this prefix before the TMPDIR-redirection problem
  // above was caught and reverted, so it stays as a one-time cleanup
  // target for anything that run may have left behind.
  'gv-agent-git-',
  'accounts-tool-',
  'agent-sdk-dev-',
  'agent-shutdown-home-',
  'agent-shutdown-wiring-',
  'agent-shutdown-work-',
  'cal-export-test-',
  'exec-test-',
  'git-test-',
  'goodvibes-agent-artifact-archive-',
  'goodvibes-agent-artifact-export-',
  'goodvibes-agent-artifact-package-',
  'goodvibes-agent-auth-block-',
  'goodvibes-agent-autonomy-tool-',
  'goodvibes-agent-brief-',
  'goodvibes-agent-calendar-',
  'goodvibes-agent-channels-home-',
  'goodvibes-agent-channels-token-',
  'goodvibes-agent-channel-tool-receipts-',
  'goodvibes-agent-composition-parity-',
  'goodvibes-agent-consolidation-',
  'goodvibes-agent-documents-',
  'goodvibes-agent-documents-corrupt-',
  'goodvibes-agent-documents-tool-',
  'goodvibes-agent-draft-runner-',
  'goodvibes-agent-empty-personas-cli-',
  'goodvibes-agent-entrypoint-profile-',
  'goodvibes-agent-export-',
  'goodvibes-agent-harness-tool-',
  'goodvibes-agent-import-cli-',
  'goodvibes-agent-knowledge-ingest-tool-',
  'goodvibes-agent-knowledge-tool-',
  'goodvibes-agent-learning-consolidation-',
  'goodvibes-agent-legacy-fold-',
  'goodvibes-agent-local-library-cli-',
  'goodvibes-agent-local-library-flag-values-',
  'goodvibes-agent-local-registry-tool-',
  'goodvibes-agent-memory-bundle-',
  'goodvibes-agent-memory-canonical-',
  'goodvibes-agent-memory-cli-',
  'goodvibes-agent-memory-flow-',
  'goodvibes-agent-memory-home-',
  'goodvibes-agent-memory-path-',
  'goodvibes-agent-memory-prompt-',
  'goodvibes-agent-memory-prompt-disabled-index-',
  'goodvibes-agent-memory-workspace-',
  'goodvibes-agent-npm-auth-',
  'goodvibes-agent-onboarding-finish-',
  'goodvibes-agent-operator-action-',
  'goodvibes-agent-operator-briefing-',
  'goodvibes-agent-persona-command-',
  'goodvibes-agent-personas-',
  'goodvibes-agent-personas-cli-',
  'goodvibes-agent-personas-discovery-cli-',
  'goodvibes-agent-power-composition-',
  'goodvibes-agent-profile-direct-discovery-',
  'goodvibes-agent-profile-discovery-workspace-',
  'goodvibes-agent-profile-home-',
  'goodvibes-agent-profiles-cli-',
  'goodvibes-agent-profiles-custom-starter-',
  'goodvibes-agent-profiles-default-',
  'goodvibes-agent-profiles-direct-discovered-',
  'goodvibes-agent-profiles-discovered-',
  'goodvibes-agent-profile-secret-',
  'goodvibes-agent-profiles-json-',
  'goodvibes-agent-profiles-starter-',
  'goodvibes-agent-profiles-starter-error-',
  'goodvibes-agent-profile-vibe-workspace-',
  'goodvibes-agent-project-context-',
  'goodvibes-agent-prompt-receipts-',
  'goodvibes-agent-qrcode-',
  'goodvibes-agent-qrcode-env-',
  'goodvibes-agent-qrcode-manual-',
  'goodvibes-agent-qrcode-missing-',
  'goodvibes-agent-receipts-',
  'goodvibes-agent-receipts-work-',
  'goodvibes-agent-relay-cli-',
  'goodvibes-agent-relay-cli-work-',
  'goodvibes-agent-reminder-tool-',
  'goodvibes-agent-research-adapter-',
  'goodvibes-agent-research-runner-',
  'goodvibes-agent-research-runner-confirm-',
  'goodvibes-agent-research-runs-',
  'goodvibes-agent-research-runs-tool-',
  'goodvibes-agent-research-sources-',
  'goodvibes-agent-research-sources-tool-',
  'goodvibes-agent-routine-command-',
  'goodvibes-agent-routines-',
  'goodvibes-agent-schedule-edit-tool-',
  'goodvibes-agent-schedule-tool-',
  'goodvibes-agent-service-posture-',
  'goodvibes-agent-settings-import-tool-',
  'goodvibes-agent-setup-review-',
  'goodvibes-agent-skill-command-',
  'goodvibes-agent-skill-local-alias-',
  'goodvibes-agent-skills-',
  'goodvibes-agent-skills-cli-',
  'goodvibes-agent-skills-discovery-cli-',
  'goodvibes-agent-test-daemon-home-',
  'goodvibes-agent-triage-no-token-',
  'goodvibes-agent-triage-token-',
  'goodvibes-agent-triggers-',
  'goodvibes-agent-usage-',
  'goodvibes-agent-usage-wiring-',
  'goodvibes-agent-vibe-',
  'goodvibes-agent-vibe-command-',
  'goodvibes-agent-vibe-migration-',
  'goodvibes-agent-vibe-tool-',
  'goodvibes-agent-voice-cohesion-',
  'goodvibes-agent-voice-cross-surface-',
  'goodvibes-agent-voice-memory-composition-',
  'goodvibes-agent-work-plan-tool-',
  'goodvibes-agent-workspace-config-',
  'goodvibes-agent-workspace-delete-library-',
  'goodvibes-agent-workspace-discovery-',
  'goodvibes-agent-workspace-edit-library-',
  'goodvibes-agent-workspace-editor-',
  'goodvibes-agent-workspace-learned-behavior-',
  'goodvibes-agent-workspace-learned-reject-',
  'goodvibes-agent-workspace-live-routine-',
  'goodvibes-agent-workspace-live-routine-delete-',
  'goodvibes-agent-workspace-live-routine-failure-',
  'goodvibes-agent-workspace-local-libraries-',
  'goodvibes-agent-workspace-profile-duplicate-',
  'goodvibes-agent-workspace-profile-form-',
  'goodvibes-agent-workspace-profiles-',
  'goodvibes-agent-workspace-registration-',
  'goodvibes-agent-workspace-registration-eligible-worktree-',
  'goodvibes-agent-workspace-registration-other-',
  'goodvibes-agent-workspace-registration-tui-',
  'goodvibes-agent-workspace-registration-work-',
  'goodvibes-agent-workspace-registration-worktree-',
  'goodvibes-agent-workspace-render-',
  'goodvibes-agent-workspace-routine-form-',
  'goodvibes-agent-workspace-schedule-receipts-',
  'goodvibes-agent-workspaces-cli-',
  'goodvibes-agent-workspaces-cli-work-',
  'goodvibes-agent-workspace-selected-library-',
  'goodvibes-agent-workspace-starter-author-',
  'goodvibes-audio-',
  'goodvibes-autonomy-test-',
  'goodvibes-capability-',
  'goodvibes-channel-policy-',
  'goodvibes-cli-bundle-',
  'goodvibes-cli-bundle-import-',
  'goodvibes-cli-bundle-redaction-',
  'goodvibes-cli-config-',
  'goodvibes-cli-config-invalid-',
  'goodvibes-cli-endpoint-',
  'goodvibes-cli-provider-posture-',
  'goodvibes-cli-runtime-url-',
  'goodvibes-cli-runtime-url-invalid-',
  'goodvibes-cli-secret-redaction-',
  'goodvibes-config-persistence-',
  'goodvibes-config-reset-',
  'goodvibes-editor-routing-',
  'goodvibes-last-seen-',
  'goodvibes-live-verifier-',
  'goodvibes-skill-standard-',
  'goodvibes-spine-fold-',
  'goodvibes-watchers-',
  'google-verify-',
  'gv-agent-admin-cmd-',
  'gv-agent-blocking-input-',
  'gv-agent-blocking-input-recovery-home-',
  'gv-agent-blocking-input-recovery-work-',
  'gv-agent-blocking-input-work-',
  'gv-agent-channel-profiles-cli-',
  'gv-agent-ci-cli-',
  'gv-agent-device-settings-',
  'gv-agent-fleet-cli-',
  'gv-agent-identifier-gate-',
  'gv-agent-knowledge-cli-',
  'gv-agent-phone-',
  'gv-agent-policy-',
  'gv-agent-principals-cli-',
  'gv-agent-provider-launch-',
  'gv-agent-release-artifacts-',
  'gv-agent-routines-cli-',
  'gv-agent-routing-',
  'gv-agent-startup-wiring-reg-broad-',
  'gv-agent-startup-wiring-reg-home-',
  'gv-agent-startup-wiring-reg-work-',
  'gv-agent-store-snapshots-',
  'gv-agent-trigger-settings-',
  'gv-archetypes-test-',
  'gv-artifacts-',
  'gv-auth-',
  'gv-automation-foundation-',
  'gv-automation-manager-',
  'gv-automation-service-',
  'gv-automation-store-',
  'gv-bm-test-',
  'gv-child-failure-',
  'gv-comms-',
  'gv-config-test-',
  'gv-context-cap-',
  'gv-context-window-ui-',
  'gv-custom-providers-',
  'gv-delete-confirm-',
  'gv-delivery-artifacts-',
  'gv-delivery-config-',
  'gv-delivery-extended-config-',
  'gv-delivery-router-',
  'gv-delivery-router-slack-',
  'gv-distributed-runtime-',
  'gv-drafts-',
  'gv-export-confirm-',
  'gv-fc-test-',
  'gv-feature-overrides-',
  'gv-fetch-auth-',
  'gv-file-undo-',
  'gv-fleet-steer-',
  'gv-fw-test-',
  'gv-hook-api-',
  'gv-hook-workbench-',
  'gv-http-auth-',
  'gv-http-transport-',
  'gv-image-input-',
  'gv-keybinding-overrides-',
  'gv-knowledge-',
  'gv-knowledge-command-',
  'gv-knowledge-graphql-',
  'gv-knowledge-projection-',
  'gv-kv-dispose-',
  'gv-kv-race-',
  'gv-kv-test-',
  'gv-markdown-disclosure-',
  'gv-mcp-bare-',
  'gv-mcp-command-',
  'gv-mcp-workspace-policy-',
  'gv-media-artifacts-',
  'gv-memory-cli-wire-',
  'gv-memory-embeddings-',
  'gv-memory-handoff-',
  'gv-memory-spine-agent-',
  'gv-memory-spine-daemon-',
  'gv-memory-spine-transport-',
  'gv-modal-search-focus-',
  'gv-mode-confirm-',
  'gv-model-limits-',
  'gv-model-picker-',
  'gv-model-picker-overlay-',
  'gv-multimodal-',
  'gv-network-inbound-',
  'gv-network-outbound-',
  'gv-notifier-',
  'gv-offswitch-',
  'gv-onboarding-apply-',
  'gv-onboarding-features-',
  'gv-onboarding-login-finish-',
  'gv-onboarding-login-ready-',
  'gv-onboarding-recap-',
  'gv-onboarding-resume-nav-',
  'gv-onboarding-snapshot-',
  'gv-onboarding-stale-index-',
  'gv-onboarding-test-',
  'gv-openai-codex-',
  'gv-orchestration-listener-',
  'gv-orchestration-listener-a-',
  'gv-orchestration-listener-b-',
  'gv-parity-',
  'gv-permission-audit-',
  'gv-pi-dir1-',
  'gv-pi-dir2-',
  'gv-pi-dispose-',
  'gv-pi-norm-',
  'gv-pi-test-',
  'gv-playbook-',
  'gv-pm-test-',
  'gv-prompt-receipt-journal-',
  'gv-provider-accounts-',
  'gv-provider-api-command-',
  'gv-provider-api-image-',
  'gv-provider-expansion-',
  'gv-provider-runtime-',
  'gv-realtime-transport-',
  'gv-recall-',
  'gv-recall-handoff-import-',
  'gv-recall-import-',
  'gv-remote-',
  'gv-remote-artifacts-',
  'gv-replay-root-',
  'gv-routine-schedule-receipts-',
  'gv-sdk-gate-',
  'gv-session-intents-',
  'gv-session-orch-',
  'gv-settings-list-flags-',
  'gv-settings-plane-',
  'gv-side-effects-',
  'gv-sub-',
  'gv-subscription-provider-',
  'gv-surface-domain-',
  'gv-tool-breadth-',
  'gv-tool-breadth-init-',
  'gv-tool-registry-',
  'gv-turn-budget-',
  'gv-voice-test-',
  'gv-work-plan-',
  'gv-work-plan-housekeeping-',
  'memory-config-',
  'memory-registry-config-',
  'memory-test-config-',
  'orch-test-',
  'overflow-test-',
  'owner-state-',
  'prompt-loader-test-',
  'vibe-migration-config-',
];

/**
 * Age gate for the real-`os.tmpdir()` sweep: 1 hour.
 *
 * This project's full suite runs in ~2-3 minutes end to end (measured:
 * ~160s for 706 files / ~9600 tests), and every individual test that still
 * creates a directory under real `os.tmpdir()` (see `KNOWN_TMPDIR_PREFIXES`
 * above) completes in well under a second. A directory's mtime advances
 * every time a direct child entry is created or removed inside it, so an
 * actively-used scratch directory — including one belonging to a suite run
 * currently in progress on this same machine — always has a recent mtime
 * and is never touched. One hour is roughly 20-30x the full suite's
 * measured runtime, which comfortably covers a slow CI runner, a debugger
 * attached mid-test, or two overlapping manual runs, while still reclaiming
 * space within the same working session rather than letting debris survive
 * indefinitely (which is the exact failure mode that exhausted `/tmp`'s
 * inode table). It does not need to match the in-repo `.test-tmp/` sweep's
 * behavior, because that sweep has no age gate at all — `.test-tmp/` is
 * exclusively owned by this project's own runs, so wiping it unconditionally
 * before and after every run is safe in a way that wiping shared real
 * `/tmp` unconditionally would not be.
 */
export const REAL_TMPDIR_STALE_AGE_MS = 60 * 60 * 1000;

/** Unconditionally empties the in-repo `.test-tmp/` root (see file header). */
export function sweepProjectTestTmpRoot(): void {
  try {
    for (const entry of readdirSync(PROJECT_TEST_TMP_ROOT, { withFileTypes: true })) {
      rmSync(join(PROJECT_TEST_TMP_ROOT, entry.name), { recursive: true, force: true });
    }
  } catch {
    // .test-tmp may not exist yet; that is fine.
  }
}

export type StaleTmpSweepResult = {
  /** Absolute paths of directories removed by this sweep. */
  readonly swept: readonly string[];
  /** Total entries seen directly under os.tmpdir() during the scan. */
  readonly scanned: number;
};

/**
 * Removes this project's own stale scratch directories from the real
 * system temp directory. Only ever removes an entry that matches one of
 * `KNOWN_TMPDIR_PREFIXES` by `startsWith` AND has an mtime older than
 * `ageMs`. Never performs a blanket sweep of `os.tmpdir()` — every other
 * repo's own worktrees (and every other process on the machine) keep their
 * unrelated temp directories untouched.
 */
export function sweepStaleRealTmpDirs(
  ageMs: number = REAL_TMPDIR_STALE_AGE_MS,
  now: number = Date.now(),
): StaleTmpSweepResult {
  const root = tmpdir();
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { swept: [], scanned: 0 };
  }

  const swept: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!KNOWN_TMPDIR_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;

    const fullPath = join(root, entry.name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(fullPath).mtimeMs;
    } catch {
      continue; // vanished between readdir and stat; nothing to do.
    }
    if (now - mtimeMs < ageMs) continue; // still fresh; leave it alone.

    try {
      rmSync(fullPath, { recursive: true, force: true });
      swept.push(fullPath);
    } catch {
      // Best-effort; another process may hold it open. Leave it for the
      // next sweep rather than fail the run over cleanup.
    }
  }

  return { swept, scanned: entries.length };
}
