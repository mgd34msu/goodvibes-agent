/**
 * Conversation-first continuation contract.
 *
 * The shared-session continuation runner (src/runtime/services.ts) used to
 * spawn every follow-up with the write-review-fix-confirm controller
 * attached, so an ordinary message in a session escalated into a review chain
 *, engineer, reviewer, quality gates, and a second agent, when an answer was
 * what was wanted. That decision now comes straight from the SDK's public
 * `continuationChainOptions` (platform/agents/conversation-continuation.ts,
 * public since the 1.21.0 re-pin) rather than a local mirror.
 *
 * This test proves the contract services.ts actually spreads into
 * `agentManager.spawn(...)`: conversation is the default, and a chain opens
 * only for an explicit authorization marker or a follow-up on a local
 * surface.
 */
import { describe, expect, test } from 'bun:test';
import {
  WORK_AUTHORIZED_METADATA_KEY,
  continuationChainOptions,
  decideContinuationEscalation,
  markWorkAuthorized,
} from '@pellux/goodvibes-sdk/platform/agents';

describe('decideContinuationEscalation', () => {
  test('an ordinary follow-up starts no work chain', () => {
    const decision = decideContinuationEscalation({ metadata: {} });
    expect(decision.startsWorkChain).toBe(false);
    expect(decision.reason).toBe('conversation-first');
  });

  test('conversation is the default when there is no metadata at all', () => {
    expect(decideContinuationEscalation(undefined).startsWorkChain).toBe(false);
    expect(decideContinuationEscalation({}).startsWorkChain).toBe(false);
  });

  test('an explicitly authorized input opens a chain', () => {
    const decision = decideContinuationEscalation({
      metadata: { [WORK_AUTHORIZED_METADATA_KEY]: true },
    });
    expect(decision.startsWorkChain).toBe(true);
    expect(decision.reason).toBe('pre-authorized');
  });

  test('the marker survives a JSON hop that stringifies it', () => {
    expect(decideContinuationEscalation({
      metadata: { [WORK_AUTHORIZED_METADATA_KEY]: 'true' },
    }).startsWorkChain).toBe(true);
  });

  test.each([false, 'false', 'yes', 1, 0, null, undefined, {}])(
    'a marker value of %p does not authorize work',
    (value) => {
      expect(decideContinuationEscalation({
        metadata: { [WORK_AUTHORIZED_METADATA_KEY]: value },
      }).startsWorkChain).toBe(false);
    },
  );

  test('an unrelated metadata key never authorizes work', () => {
    expect(decideContinuationEscalation({
      metadata: { workAuthorized: true, authorized: true, approved: true },
    }).startsWorkChain).toBe(false);
  });
});

describe('continuationChainOptions', () => {
  test('a conversational follow-up spawns with the work chain disabled', () => {
    expect(continuationChainOptions({ metadata: {} })).toEqual({
      dangerously_disable_wrfc: true,
      replyStyle: 'conversational',
    });
  });

  test('authorized work spawns with the chain intact and reports as work', () => {
    expect(continuationChainOptions({
      metadata: { [WORK_AUTHORIZED_METADATA_KEY]: true },
    })).toEqual({});
  });

  test('the fragment is spreadable into a spawn input', () => {
    const spawnInput = { mode: 'spawn', task: 'Testing', ...continuationChainOptions(undefined) };
    expect(spawnInput).toEqual({
      mode: 'spawn',
      task: 'Testing',
      dangerously_disable_wrfc: true,
      replyStyle: 'conversational',
    });
  });

  test('a conversational follow-up asks for a reply, not a completion report', () => {
    // Suppressing the chain without changing what the reply LOOKS like is half
    // a fix: the answer still came back as a Summary/Changes/Decisions form.
    expect(continuationChainOptions({ surfaceKind: 'ntfy' }).replyStyle).toBe('conversational');
    expect(continuationChainOptions({ surfaceKind: 'tui' }).replyStyle).toBeUndefined();
  });

  test('a live configReader\'s getCategory can widen the gated-surface list', () => {
    // This is the exact adapter shape services.ts builds from configManager:
    // a scalar-only `get` plus a `getCategory` that returns the full
    // conversationGate settings object, so the surface LIST tracks live
    // config instead of the SDK's shipped defaults.
    const configReader = {
      get: (key: string) => (key === 'conversationGate.mode' ? 'propose' : undefined),
      getCategory: (name: string) =>
        name === 'conversationGate'
          ? { mode: 'propose', proposalTtlMs: 0, maxPendingProposals: 0, gatedSurfaces: ['custom-surface'] }
          : undefined,
    };
    expect(continuationChainOptions({ surfaceKind: 'custom-surface' }, { configReader }).replyStyle).toBe('conversational');
    expect(continuationChainOptions({ surfaceKind: 'unlisted-surface' }, { configReader }).replyStyle).toBeUndefined();
  });
});

describe('markWorkAuthorized', () => {
  test('adds the marker while preserving existing metadata', () => {
    expect(markWorkAuthorized({ source: 'ntfy' })).toEqual({
      source: 'ntfy',
      [WORK_AUTHORIZED_METADATA_KEY]: true,
    });
  });

  test('works from nothing', () => {
    expect(markWorkAuthorized(undefined)).toEqual({ [WORK_AUTHORIZED_METADATA_KEY]: true });
  });

  test('what it writes is what the decision reads', () => {
    expect(decideContinuationEscalation({ metadata: markWorkAuthorized({}) }).startsWorkChain).toBe(true);
  });
});
