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

  test('finds background process controls by process, PTY, and sudo wording', () => {
    const processModes = listHarnessModes({ query: 'background process', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = processModes.modes.map((mode) => mode.id);
    expect(ids).toContain('background_processes');
    expect(ids).toContain('background_process');
    expect(ids).toContain('run_background_process');
    expect(processModes.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);

    const pty = listHarnessModes({ query: 'pty', limit: 10 }) as {
      readonly modes: readonly { readonly id: string }[];
    };
    expect(pty.modes.map((mode) => mode.id)).toContain('run_background_process');
    const sudo = listHarnessModes({ query: 'sudo', limit: 10 }) as {
      readonly modes: readonly { readonly id: string }[];
    };
    expect(sudo.modes.map((mode) => mode.id)).toContain('run_background_process');

    const processTool = listHarnessModes({ query: 'process tool session id poll kill write', includeParameters: true, limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly parameters?: readonly string[] }[];
    };
    const runBackgroundProcess = processTool.modes.find((mode) => mode.id === 'run_background_process');
    expect(runBackgroundProcess?.parameters).toEqual(expect.arrayContaining([
      'processAction',
      'action',
      'sessionId',
      'session_id',
      'processSessionId',
      'data',
    ]));
  });

  test('finds Personal Ops by natural user task wording', () => {
    const personalOps = listHarnessModes({ query: 'email calendar tasks reminders', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = personalOps.modes.map((mode) => mode.id);
    expect(ids).toContain('personal_ops');
    expect(ids).toContain('personal_ops_intake');
    expect(ids).toContain('personal_ops_lane');
    expect(personalOps.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
  });

  test('finds memory posture by recall and external memory provider wording', () => {
    const memory = listHarnessModes({ query: 'memory recall Honcho Mem0 Supermemory', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = memory.modes.map((mode) => mode.id);
    expect(ids).toContain('memory_posture');
    expect(ids).toContain('memory_provider');
    expect(memory.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
  });

  test('finds setup posture by first-run always-on wording', () => {
    const setup = listHarnessModes({ query: 'first-run always-on setup', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = setup.modes.map((mode) => mode.id);
    expect(ids).toContain('setup_posture');
    expect(ids).toContain('setup_item');
    expect(setup.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);

    const smoke = listHarnessModes({ query: 'run setup smoke', includeParameters: true, limit: 5 }) as {
      readonly modes: readonly { readonly id: string; readonly requiresConfirmation?: boolean; readonly parameters?: readonly string[] }[];
    };
    expect(smoke.modes[0]?.id).toBe('run_setup_smoke');
    expect(smoke.modes[0]?.requiresConfirmation).toBe(true);
    expect(smoke.modes[0]?.parameters).toEqual(expect.arrayContaining(['confirm', 'explicitUserRequest']));

    const auth = listHarnessModes({ query: 'connected host token provision', includeParameters: true, limit: 5 }) as {
      readonly modes: readonly { readonly id: string; readonly requiresConfirmation?: boolean; readonly parameters?: readonly string[] }[];
    };
    expect(auth.modes[0]?.id).toBe('provision_connected_host_token');
    expect(auth.modes[0]?.requiresConfirmation).toBe(true);
    expect(auth.modes[0]?.parameters).toEqual(expect.arrayContaining(['confirm', 'explicitUserRequest']));
  });

  test('finds project context files by AGENTS, Hermes, Claude, and Cursor wording', () => {
    const context = listHarnessModes({ query: 'AGENTS.md .hermes.md CLAUDE.md cursor rules', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = context.modes.map((mode) => mode.id);
    expect(ids).toContain('project_context');
    expect(ids).toContain('project_context_file');
    expect(context.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
  });

  test('finds channel delivery receipts by outcome wording', () => {
    const deliveries = listHarnessModes({ query: 'channel delivery receipts sent outcomes', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = deliveries.modes.map((mode) => mode.id);
    expect(ids).toContain('channel_deliveries');
    expect(deliveries.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
  });

  test('finds channel triage by inbox, error, and retry wording', () => {
    const triage = listHarnessModes({ query: 'channel inbox pending messages errors delivery retries', includeParameters: true, limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly parameters?: readonly string[]; readonly summary: string }[];
    };
    const ids = triage.modes.map((mode) => mode.id);
    expect(ids).toContain('channel_triage');
    expect(triage.modes.find((mode) => mode.id === 'channel_triage')?.parameters).toEqual(expect.arrayContaining(['limit']));
    expect(triage.modes.filter((mode) => mode.summary.length > 96)).toEqual([]);
  });

  test('finds visible Agent orchestration by subagent and batch-spawn wording', () => {
    const orchestration = listHarnessModes({ query: 'subagent batch-spawn multi-agent cancellable agents', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = orchestration.modes.map((mode) => mode.id);
    expect(ids).toContain('agent_orchestration');
    expect(ids).toContain('agent_orchestration_agent');
    expect(orchestration.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
  });

  test('finds Document Ops by uploads, artifacts, and blind compare wording', () => {
    const documentOps = listHarnessModes({ query: 'document upload artifact blind model compare', limit: 10 }) as {
      readonly modes: readonly { readonly id: string; readonly summary: string }[];
    };
    const ids = documentOps.modes.map((mode) => mode.id);
    expect(ids).toContain('document_ops');
    expect(ids).toContain('document_ops_lane');
    expect(documentOps.modes.filter((mode) => mode.summary.length > 72)).toEqual([]);
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
