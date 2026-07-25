/**
 * Conversation-first continuation.
 *
 * The agent's session continuation runner used to spawn every follow-up with
 * the WRFC controller attached, so an ordinary message in a session escalated
 * into a write-review-fix-confirm chain — engineer, reviewer, quality gates,
 * and a second agent — when an answer was what was wanted.
 *
 * The rule: conversation is the default; a chain opens only when the input
 * carries an explicit authorization marker, set either by the confirmation the
 * owner gave over the channel or by the schedule/trigger that was confirmed
 * when it was created.
 */
import { describe, expect, test } from 'bun:test';
import {
  WORK_AUTHORIZED_METADATA_KEY,
  continuationChainOptions,
  decideContinuationEscalation,
  markWorkAuthorized,
} from '../../runtime/conversation-first-continuation.js';

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
    expect(continuationChainOptions({ metadata: {} })).toEqual({ dangerously_disable_wrfc: true });
  });

  test('authorized work spawns with the chain intact', () => {
    expect(continuationChainOptions({
      metadata: { [WORK_AUTHORIZED_METADATA_KEY]: true },
    })).toEqual({});
  });

  test('the fragment is spreadable into a spawn input', () => {
    const spawnInput = { mode: 'spawn', task: 'Testing', ...continuationChainOptions(undefined) };
    expect(spawnInput).toEqual({ mode: 'spawn', task: 'Testing', dangerously_disable_wrfc: true });
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
