import { describe, expect, test } from 'bun:test';
import {
  getHookPointContract,
  listHookPointContracts,
  parseHookPath,
} from '@pellux/goodvibes-sdk/platform/hooks';

describe('hook point contracts', () => {
  test('lists known contracts', () => {
    const contracts = listHookPointContracts();
    expect(contracts.length).toBeGreaterThan(5);
  });

  test('resolves exact or wildcard contract for a hook path', () => {
    const contract = getHookPointContract('Pre:tool:edit');
    expect(contract).toEqual(expect.objectContaining({
      authority: 'intercept',
      executionMode: 'blocking',
      canDeny: true,
    }));
  });

  test('parses hook path into phase, category, and specific', () => {
    expect(parseHookPath('Lifecycle:workflow:failed')).toEqual({
      phase: 'Lifecycle',
      category: 'workflow',
      specific: 'failed',
    });
  });
});
