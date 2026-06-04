import { describe, expect, test } from 'bun:test';
import { getHookPointContract } from '@pellux/goodvibes-sdk/platform/hooks';

describe('hook contract coverage', () => {
  test('covers permission and transport lifecycle edges', () => {
    const expected = [
      ['Pre:permission:request', 'Pre:permission:request', 'blocking', 15_000, 'fail_open'],
      ['Post:permission:decision', 'Post:permission:decision', 'non_blocking', 15_000, 'log_only'],
      ['Fail:permission:request', 'Fail:permission:request', 'non_blocking', 15_000, 'log_only'],
      ['Lifecycle:transport:connected', 'Lifecycle:transport:*', 'background', 15_000, 'log_only'],
      ['Lifecycle:transport:failed', 'Lifecycle:transport:*', 'background', 15_000, 'log_only'],
      ['Lifecycle:orchestration:graph-created', 'Lifecycle:orchestration:*', 'background', 30_000, 'log_only'],
      ['Lifecycle:orchestration:node-failed', 'Lifecycle:orchestration:*', 'background', 30_000, 'log_only'],
      ['Change:orchestration:recursion-guard', 'Change:orchestration:*', 'background', 30_000, 'log_only'],
      ['Lifecycle:communication:sent', 'Lifecycle:communication:*', 'background', 30_000, 'log_only'],
      ['Lifecycle:communication:delivered', 'Lifecycle:communication:*', 'background', 30_000, 'log_only'],
      ['Change:communication:blocked', 'Change:communication:*', 'background', 30_000, 'log_only'],
    ] as const;

    for (const [path, pattern, executionMode, timeoutMs, failurePolicy] of expected) {
      expect(getHookPointContract(path)).toEqual(expect.objectContaining({
        pattern,
        authority: 'observe',
        executionMode,
        canDeny: false,
        canMutateInput: false,
        canInjectContext: false,
        timeoutMs,
        failurePolicy,
      }));
    }
  });
});
