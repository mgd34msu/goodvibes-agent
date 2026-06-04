import { describe, expect, test } from 'bun:test';
import { AGENT_HARNESS_MODES } from '../../tools/agent-harness-tool-schema.ts';
import {
  describeHarnessMode,
  HARNESS_MODE_DESCRIPTORS,
  listHarnessModes,
} from '../../tools/agent-harness-mode-catalog.ts';

describe('agent_harness mode catalog', () => {
  test('stays in sync with the public tool schema and keeps effect modes confirmation-gated', () => {
    const schemaModes = [...AGENT_HARNESS_MODES].sort();
    const catalogModes = HARNESS_MODE_DESCRIPTORS.map((descriptor) => descriptor.id).sort();

    expect(new Set(catalogModes).size).toBe(catalogModes.length);
    expect(catalogModes).toEqual(schemaModes);

    const unsafeEffects = HARNESS_MODE_DESCRIPTORS
      .filter((descriptor) => descriptor.kind === 'effect')
      .filter((descriptor) => (
        descriptor.requiresConfirmation !== true
        || !descriptor.parameters?.includes('confirm')
        || !descriptor.parameters?.includes('explicitUserRequest')
      ))
      .map((descriptor) => descriptor.id);

    expect(unsafeEffects).toEqual([]);
  });

  test('supports compact discovery by task phrase with opt-in parameter detail', () => {
    const compact = listHarnessModes({ query: 'run slash command' }) as {
      readonly modes: readonly { readonly id: string; readonly parameters?: readonly string[]; readonly route?: string }[];
    };
    expect(compact.modes[0]?.id).toBe('run_command');
    expect(compact.modes.map((mode) => mode.id)).toContain('run_command');
    expect(compact.modes.filter((mode) => mode.parameters !== undefined || mode.route !== undefined)).toEqual([]);

    const detailed = listHarnessModes({ query: 'args explicitUserRequest', includeParameters: true, limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly parameters?: readonly string[]; readonly route?: string }[];
    };
    const runCommand = detailed.modes.find((mode) => mode.id === 'run_command');
    expect(runCommand).toMatchObject({
      id: 'run_command',
      route: 'agent_harness mode:"run_command"',
    });
    expect(runCommand?.parameters).toEqual(expect.arrayContaining(['confirm', 'explicitUserRequest']));
  });

  test('finds connected-host daemon aliases by GoodVibes daemon wording', () => {
    const daemon = listHarnessModes({ query: 'goodvibes-daemon', limit: 5 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = daemon.modes.map((mode) => mode.id);
    expect(ids).toContain('daemon');
    expect(ids).toContain('daemon_status');
    expect(daemon.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
  });

  test('returns exact, ambiguous, and missing inspection outcomes without guessing', () => {
    expect(describeHarnessMode({ target: 'SET_SETTING' })).toMatchObject({
      status: 'found',
      mode: {
        id: 'set_setting',
        lookup: { resolvedBy: 'case-insensitive-id' },
      },
    });

    const ambiguous = describeHarnessMode({ query: 'setting' });
    expect(ambiguous.status).toBe('ambiguous');
    if (ambiguous.status !== 'ambiguous') throw new Error('expected ambiguous settings lookup');
    expect(ambiguous.candidates.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([
      'settings',
      'get_setting',
      'set_setting',
      'reset_setting',
    ]));

    expect(describeHarnessMode({ query: 'definitely-not-a-mode' })).toMatchObject({
      status: 'missing_lookup',
    });
  });
});
