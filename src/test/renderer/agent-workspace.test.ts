import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AgentNoteRegistry } from '../../agent/note-registry.ts';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { createAgentRuntimeProfile, setAgentRuntimeProfileSelection } from '../../agent/runtime-profile.ts';
import { routineScheduleReceiptStorePath } from '../../agent/routine-schedule-receipts.ts';
import { AgentWorkspace } from '../../input/agent-workspace.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import { renderAgentWorkspace } from '../../renderer/agent-workspace.ts';
import type { Line } from '../../types/grid.ts';
import { createShellPathService } from '@/runtime/index.ts';
import type { MemoryApi } from '@pellux/goodvibes-sdk/platform/knowledge';
import type { MemoryRecord } from '@pellux/goodvibes-sdk/platform/state';

function text(lines: readonly Line[]): string {
  return lines.map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd()).join('\n');
}

function commandContext(): CommandContext {
  return {
    executeCommand: async () => true,
    print: () => undefined,
  } as unknown as CommandContext;
}

function memoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id: 'mem-preference',
    scope: 'project',
    cls: 'fact',
    summary: 'Prefers concise operator briefings',
    detail: 'Use short summaries before action.',
    tags: ['preference'],
    provenance: [],
    reviewState: 'fresh',
    confidence: 82,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function memoryApi(records: MemoryRecord[] = [memoryRecord()]): MemoryApi {
  return {
    add: async (input) => {
      const record = memoryRecord({
        id: `mem-${records.length + 1}`,
        scope: input.scope ?? 'project',
        cls: input.cls,
        summary: input.summary,
        detail: input.detail,
        tags: [...(input.tags ?? [])],
        provenance: [...(input.provenance ?? [])],
        reviewState: input.review?.state ?? 'fresh',
        confidence: input.review?.confidence ?? 80,
      });
      records.unshift(record);
      return record;
    },
    search: () => records,
    searchSemantic: () => [],
    vectorStats: () => ({
      backend: 'sqlite-vec',
      enabled: false,
      available: false,
      path: '',
      dimensions: 0,
      indexedRecords: 0,
      embeddingProviderId: 'none',
      embeddingProviderLabel: 'None',
    }),
    rebuildVectors: () => ({
      backend: 'sqlite-vec',
      enabled: false,
      available: false,
      path: '',
      dimensions: 0,
      indexedRecords: 0,
      embeddingProviderId: 'none',
      embeddingProviderLabel: 'None',
    }),
    rebuildVectorsAsync: async () => ({
      backend: 'sqlite-vec',
      enabled: false,
      available: false,
      path: '',
      dimensions: 0,
      indexedRecords: 0,
      embeddingProviderId: 'none',
      embeddingProviderLabel: 'None',
    }),
    doctor: async () => ({
      vector: {
        backend: 'sqlite-vec',
        enabled: false,
        available: false,
        dimensions: 0,
        indexedRecords: 0,
      },
      embeddings: {
        activeProviderId: 'none',
        providers: [],
        asyncProviders: [],
        syncProviders: [],
        warnings: [],
      },
      checkedAt: Date.now(),
    }),
    reviewQueue: () => records.filter((record) => record.reviewState !== 'reviewed'),
    exportBundle: () => ({
      schemaVersion: 'v1',
      exportedAt: Date.now(),
      scope: 'all',
      recordCount: records.length,
      linkCount: 0,
      records,
      links: [],
    }),
    importBundle: async () => ({ importedRecords: 0, skippedRecords: 0, importedLinks: 0 }),
    get: (id) => records.find((record) => record.id === id) ?? null,
    getAll: () => records,
    link: async () => null,
    linksFor: () => [],
    update: (id, patch) => {
      const index = records.findIndex((record) => record.id === id);
      const current = records[index];
      if (!current) return null;
      const updated = {
        ...current,
        ...patch,
        updatedAt: Date.now(),
      };
      records[index] = updated;
      return updated;
    },
    review: (id, patch) => {
      const index = records.findIndex((record) => record.id === id);
      const current = records[index];
      if (!current) return null;
      const updated = {
        ...current,
        reviewState: patch.state ?? current.reviewState,
        confidence: patch.confidence ?? current.confidence,
        reviewedBy: patch.reviewedBy ?? current.reviewedBy,
        reviewedAt: Date.now(),
        staleReason: patch.staleReason,
        updatedAt: Date.now(),
      };
      records[index] = updated;
      return updated;
    },
    delete: (id) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
    explain: () => ({
      injections: [],
      prompt: null,
    }),
  };
}

function liveCommandContext(options: { readonly includePersonalOpsNote?: boolean } = {}): CommandContext {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-render-'));
  const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  const tokenDir = join(root, '.goodvibes', 'daemon');
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(join(tokenDir, 'operator-tokens.json'), JSON.stringify({ token: 'goodvibes-agent-test-token' }));
  createAgentRuntimeProfile(root, 'household');
  setAgentRuntimeProfileSelection(root, 'household');
  const configValues = new Map<string, unknown>([
    ['controlPlane.host', '127.0.0.1'],
    ['controlPlane.port', 3421],
    ['surfaces.slack.enabled', true],
    ['surfaces.slack.botToken', 'goodvibes://secrets/goodvibes/SLACK_BOT_TOKEN'],
    ['surfaces.slack.signingSecret', 'goodvibes://secrets/goodvibes/SLACK_SIGNING_SECRET'],
    ['surfaces.slack.defaultChannel', 'ops-alerts'],
    ['surfaces.telegram.enabled', true],
    ['surfaces.telegram.botToken', 'goodvibes://secrets/goodvibes/TELEGRAM_BOT_TOKEN'],
    ['tts.provider', 'elevenlabs'],
    ['tts.voice', 'voice-operator'],
    ['tts.llmProvider', 'openai-subscriber'],
    ['tts.llmModel', 'gpt-5.5'],
    ['ui.voiceEnabled', true],
    ['web.enabled', true],
    ['web.publicBaseUrl', 'https://agent.example.test'],
  ]);
  const personas = AgentPersonaRegistry.fromShellPaths(shellPaths);
  personas.create({
    name: 'Research Analyst',
    description: 'Source-backed research posture.',
    body: 'Prefer checked sources and clear unknowns.',
  });
  personas.setActive('research-analyst');
  const skills = AgentSkillRegistry.fromShellPaths(shellPaths);
  skills.create({
    name: 'Briefing',
    description: 'Summarize state before action.',
    procedure: 'Review current daemon, tasks, and approvals first.',
    requirements: [{ kind: 'env', name: 'GOODVIBES_AGENT_TEST_MISSING_TOKEN' }],
    enabled: true,
  });
  skills.createBundle({
    name: 'Operator Pack',
    description: 'Use the core operator procedures together.',
    skillIds: ['briefing'],
    enabled: true,
  });
  const routines = AgentRoutineRegistry.fromShellPaths(shellPaths);
  routines.create({
    name: 'Daily Brief',
    description: 'Summarize operator state.',
    steps: 'Review current daemon, tasks, approvals, and Agent Knowledge status first.',
    requirements: [{ kind: 'env', name: 'GOODVIBES_AGENT_TEST_MISSING_ROUTINE_TOKEN' }],
    enabled: true,
  });
  if (options.includePersonalOpsNote === true) {
    AgentNoteRegistry.fromShellPaths(shellPaths).create({
      title: 'Follow-up queue',
      body: 'Track replies, calendar holds, and reminder ideas.',
      tags: ['personal-ops'],
      source: 'agent',
      provenance: 'test',
    });
  }
  return {
    executeCommand: async () => true,
    print: () => undefined,
    session: {
      runtime: {
        model: 'openai:gpt-5.5',
        provider: 'openai-subscriber',
        sessionId: 'agent-session-1',
        debugMode: false,
        systemPrompt: '',
        reasoningEffort: 'medium',
      },
      sessionMemoryStore: { list: () => [{ id: 'mem-1', text: 'remembered preference' }] },
    },
    provider: {
      providerRegistry: {
        getCurrentModel: () => ({
          id: 'gpt-5.5',
          provider: 'openai-subscriber',
          displayName: 'GPT-5.5',
          registryKey: 'openai:gpt-5.5',
          contextWindow: 256000,
        }),
      },
    },
    workspace: {
      shellPaths,
      profileManager: {
        list: () => [
          { name: 'operator', timestamp: Date.now() },
          { name: 'travel', timestamp: Date.now() - 1000 },
        ],
      },
    },
    clients: {
      agentKnowledgeApi: {
        memory: memoryApi(),
      },
      mcpApi: {
        listServerSecurity: () => [
          {
            name: 'filesystem',
            connected: true,
            role: 'filesystem',
            trustMode: 'constrained',
            schemaFreshness: 'fresh',
            allowedPaths: ['/home/buzzkill/Projects'],
            allowedHosts: [],
          },
          {
            name: 'browser',
            connected: false,
            role: 'browser',
            trustMode: 'allow-all',
            schemaFreshness: 'quarantined',
            allowedPaths: [],
            allowedHosts: ['docs.example.test'],
          },
        ],
      },
    },
    platform: {
      configManager: {
        get: (key: string) => configValues.get(key),
      },
      voiceProviderRegistry: {
        list: () => [
          { id: 'elevenlabs', label: 'ElevenLabs', capabilities: ['tts-stream', 'stt', 'realtime'] },
          { id: 'deepgram', label: 'Deepgram', capabilities: ['stt'] },
        ],
      },
      mediaProviderRegistry: {
        list: () => [
          { id: 'builtin:image-understanding', label: 'Image Understanding', capabilities: ['understand'] },
          { id: 'fal', label: 'Fal', capabilities: ['generate'] },
        ],
      },
    },
  } as unknown as CommandContext;
}

describe('renderAgentWorkspace', () => {
  test('renders the operator workspace with categories, actions, and footer controls', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    const output = text(renderAgentWorkspace(workspace, 120, 32));

    expect(output).toContain('GoodVibes Agent / Operator Workspace');
    expect(output).toContain('Operator Areas');
    expect(output).toContain('Home');
    expect(output).toContain('Onboarding');
    expect(output).toContain('open area');
    expect(output).toContain('Choose model');
    expect(output).toContain('/model');
    expect(output).toContain('Interaction mode');
    expect(output).toContain('Agent workspace');
    expect(output).toContain('Enter open/action');
  });

  test('renders workspace action search as a TUI-native finder', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);
    workspace.beginActionSearch();
    workspace.appendActionSearchText('doctor');

    const output = text(renderAgentWorkspace(workspace, 120, 32));

    expect(output).toContain('Search actions');
    expect(output).toContain('Action Search');
    expect(output).toContain('Query: doctor');
    expect(output).toContain('Home / Doctor diagnostics');
    expect(output).toContain('/doctor');
    expect(output).toContain('type filter');
    expect(output).toContain('Esc clear');
  });

  test('renders build delegation as an explicit TUI handoff area', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');

    const output = text(renderAgentWorkspace(workspace, 130, 34));

    expect(output).toContain('Build Delegation');
    expect(output).toContain('GoodVibes TUI');
    expect(output).toContain('Delegated review policy: explicit-build-delegation-only');
    expect(output).not.toContain('coding transcript');
  });

  test('renders live Agent context from the command runtime', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    const output = text(renderAgentWorkspace(workspace, 132, 50));

    expect(output).toContain('Chat route: openai-subscriber / GPT-5.5');
    expect(output).toContain('openai-subscriber / GPT-5.5');
    expect(output).toContain('agent-session-1');
    expect(output).toContain('serial-proactive');
    expect(output).not.toContain('goodvibes-agent-test-token');
  });

  test('renders real onboarding actions in the Start workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Selected: Import GoodVibes settings');
    expect(output).toContain('Onboarding');
    expect(output).toContain('7/12 ready; 3 recommended; 2 optional; 0 blocked.');
    expect(output).toContain('Chat: openai-subscriber / GPT-5.5.');
    expect(output).toContain('Local: 1 personas, 1 skills, 1 routines, 1 memories.');
    expect(output).toContain('Next: Agent Knowledge (recommended)');
    expect(output).toContain('Import GoodVibes settings');
    expect(output).toContain('Choose main model');
    expect(output).toContain('Start subscription login');
    expect(output).toContain('Store secret');
    expect(output).not.toContain('->');
    expect(output).not.toContain('SLACK_BOT_TOKEN');
    expect(output).not.toContain('daemonBaseUrl');
    expect(output).not.toContain('daemon URL');
    expect(output).not.toContain('External Daemon');
    expect(output).not.toContain('service mode');
    expect(output).not.toContain('HTTP listeners');
    expect(output).not.toContain('tunnel provider setup');
    expect(output).not.toContain('non-Agent assistant segment');
    expect(output).not.toContain('non-Agent graph segment');
  });

  test('renders Personal Ops as one daily operations surface', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext({ includePersonalOpsNote: true }), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personal-ops');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Personal Ops');
    expect(output).toContain('Personal Ops: notes 1; routines 1/1');
    expect(output).toContain('Email/calendar: connector setup needed');
    expect(output).toContain('Create reminder');
    expect(output).toContain('Delivery channels');
    expect(output).toContain('agent_harness mode:"personal_ops"');
  });

  test('renders Documents & Compare as a visible artifact and compare surface', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'documents');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Documents & Compare');
    expect(output).toContain('Document route: openai-subscriber / GPT-5.5');
    expect(output).toContain('Files: attach, paste, source ingest, and export');
    expect(output).toContain('Saved artifact browser plus compare review/judgment, analytics, export, and route update');
    expect(output).toContain('document editor/history remains a gap.');
    expect(output).toContain('Browse artifacts');
    expect(output).toContain('Show artifact');
    expect(output).toContain('Run blind compare');
    expect(output).toContain('Review saved compare');
    expect(output).toContain('Save compare judgment');
    expect(output).toContain('Compare analytics');
    expect(output).toContain('agent_harness mode:"document_ops"');
  });

  test('keeps onboarding context compact enough to show setting actions', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined, 'setup');

    const output = text(renderAgentWorkspace(workspace, 132, 37));

    expect(output).toContain('Selected: Import GoodVibes settings');
    expect(output).toContain('Next: Provider and model (blocked)');
    expect(output).toContain('Choose main model');
    expect(output).toContain('Save history');
    expect(output).not.toContain('Setup Checklist');
    expect(output).not.toContain('RECOMMENDED');
    expect(output).not.toContain('->');
  });

  test('keeps every Agent workspace category on the compact top-pane split', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    for (const category of workspace.categories) {
      const categoryWorkspace = new AgentWorkspace();
      categoryWorkspace.open(commandContext(), () => undefined, category.id);
      const output = text(renderAgentWorkspace(categoryWorkspace, 132, 37));
      const lines = output.split('\n');
      const contextSeparatorRow = lines.findIndex((line, index) => index > 2 && line.includes('────'));

      expect(contextSeparatorRow).toBeGreaterThan(0);
      expect(contextSeparatorRow).toBeLessThanOrEqual(16);
      expect(output).toContain(category.label);
      expect(output).toContain('Action');
    }
  });

  test('renders shared provider and model picker actions in account onboarding', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'account-model');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-use');
    let output = text(renderAgentWorkspace(workspace, 132, 44));
    expect(output).toContain('Choose provider and model');
    expect(output).toContain('provider/model picker');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'account-main-model');
    output = text(renderAgentWorkspace(workspace, 132, 44));
    expect(output).toContain('Choose main model');
    expect(output).toContain('model picker');
  });

  test('renders support bundle actions in the host workspace when selected', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'host');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-support-bundle-export');
    const exportOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(exportOutput).toContain('Export support bundle');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-support-bundle-inspect');
    const inspectOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(inspectOutput).toContain('Inspect support bundle');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-support-bundle-import');
    const importOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(importOutput).toContain('Import support bundle');
  });

  test('renders provider subscription login forms in the setup workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-login-start');

    const actionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(actionOutput).toContain('Start subscription login');
    expect(actionOutput).toContain('edit subscription-login-start');

    workspace.activateSelected();
    const editorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(editorOutput).toContain('Start Provider Subscription Login');
    expect(editorOutput).toContain('Provider *');
    workspace.moveEditorField(1);
    const browserOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(browserOutput).toContain('Start Provider Subscription Login');
    expect(browserOutput).toContain('Open browser');
    workspace.moveEditorField(1);
    const confirmOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(confirmOutput).toContain('Editing: Confirm (required)');
  });

  test('renders provider maintenance forms from workspace actions', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'host');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-provider-detail');
    const inspectActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(inspectActionOutput).toContain('Provider detail');
    expect(inspectActionOutput).toContain('edit provider-inspect');

    workspace.activateSelected();
    const inspectEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(inspectEditorOutput).toContain('Inspect Provider');
    expect(inspectEditorOutput).toContain('Provider id *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-provider-routes');
    const routesActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(routesActionOutput).toContain('Provider routes');
    expect(routesActionOutput).toContain('edit provider-routes');

    workspace.activateSelected();
    const routesEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(routesEditorOutput).toContain('Inspect Provider Routes');
    expect(routesEditorOutput).toContain('Provider id *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-provider-repair');
    const accountRepairActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(accountRepairActionOutput).toContain('Provider repair guidance');
    expect(accountRepairActionOutput).toContain('edit provider-account-repair');

    workspace.activateSelected();
    const accountRepairEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(accountRepairEditorOutput).toContain('Review Provider Account Repair');
    expect(accountRepairEditorOutput).toContain('Provider id *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-add');
    const addActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(addActionOutput).toContain('Add custom provider');
    expect(addActionOutput).toContain('edit provider-add');

    workspace.activateSelected();
    const addEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(addEditorOutput).toContain('Add Custom Provider');
    expect(addEditorOutput).toContain('Provider name *');
    workspace.moveEditorField(2);
    const addKeyOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(addKeyOutput).toContain('API key');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'account-model');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-remove');
    const removeActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(removeActionOutput).toContain('Remove custom provider');
    expect(removeActionOutput).toContain('edit provider-remove');
  });

  test('renders auth trust subscription and voice bundle forms in the workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'host');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-auth-bundle-export');
    workspace.activateSelected();
    const authOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(authOutput).toContain('Export Auth Review Bundle');
    expect(authOutput).toContain('Output path *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'host');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'host-subscription-bundle-inspect');
    workspace.activateSelected();
    const subscriptionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(subscriptionOutput).toContain('Inspect Subscription Bundle');
    expect(subscriptionOutput).toContain('Bundle path *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'trust-bundle-export');
    workspace.activateSelected();
    const trustOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(trustOutput).toContain('Export Trust Bundle');
    expect(trustOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'voice-enable');
    workspace.activateSelected();
    const voiceOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(voiceOutput).toContain('Enable Voice Interaction');
    expect(voiceOutput).toContain('Confirm *');
  });

  test('renders discovered behavior files as context onboarding actions', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-discovery-'));
    mkdirSync(join(root, '.goodvibes', 'agent', 'personas'), { recursive: true });
    mkdirSync(join(root, '.goodvibes', 'agent', 'skills', 'daily-brief'), { recursive: true });
    mkdirSync(join(root, '.goodvibes', 'agent', 'routines'), { recursive: true });
    writeFileSync(join(root, '.goodvibes', 'agent', 'personas', 'research.md'), [
      '---',
      'name: Research Operator',
      'description: Source-backed research posture.',
      '---',
      'Prefer checked sources and clear unknowns.',
    ].join('\n'));
    writeFileSync(join(root, '.goodvibes', 'agent', 'skills', 'daily-brief', 'SKILL.md'), [
      '---',
      'name: Daily Brief Skill',
      'description: Build a concise operator brief.',
      '---',
      'Review work plans, approvals, routines, and Agent Knowledge before summarizing.',
    ].join('\n'));
    writeFileSync(join(root, '.goodvibes', 'agent', 'routines', 'evening.md'), [
      '---',
      'name: Evening Review',
      'description: Review open work before shutdown.',
      '---',
      'Review work plan, approvals, routines, and Agent Knowledge status.',
    ].join('\n'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const context = {
      ...commandContext(),
      workspace: { shellPaths },
      session: { runtime: { provider: 'openai-subscriber', model: 'openai:gpt-5.5', sessionId: 'setup-discovery-session' } },
      platform: { configManager: { get: (key: string) => key === 'controlPlane.host' ? '127.0.0.1' : key === 'controlPlane.port' ? 3421 : undefined } },
    } as unknown as CommandContext;
    const workspace = new AgentWorkspace();
    workspace.open(context, () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'onboarding-context');

    const output = text(renderAgentWorkspace(workspace, 150, 52));

    expect(output).toContain('Context');
    expect(output).toContain('Create/import memory, personas, skills, routines, notes, and Knowledge.');
    expect(output).toContain('Profile from discovered files');
    expect(output).toContain('edit profile-from-discovered');
    expect(output).toContain('Import persona files');
    expect(output).toContain('edit persona-discovery-import');
    expect(output).toContain('Import skill files');
    expect(output).toContain('edit skill-discovery-import');
    expect(output).toContain('Import routine files');
    expect(output).toContain('edit routine-discovery-import');
    expect(output).toContain('Create starter memory');
    expect(output).toContain('Ingest URL');
    expect(output).not.toContain('RECOMMENDED Agent profile -> Profiles');
    expect(output).not.toContain('RECOMMENDED Persona -> Personas');
    expect(output).not.toContain('Discovered Behavior Files');
    expect(output).not.toContain('default knowledge');
  });

  test('renders context onboarding actions for skills routines and knowledge', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'onboarding-context');

    const expectSetupAction = (id: string, label: string, command: string) => {
      workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === id);
      const output = text(renderAgentWorkspace(workspace, 150, 48));
      expect(output).toContain(label);
      expect(output).toContain(command);
      expect(output).not.toContain('->');
    };

    expectSetupAction('context-create-skill', 'Create skill', 'edit skill');
    expectSetupAction('context-create-routine', 'Create routine', 'edit routine');
    expectSetupAction('context-knowledge-url', 'Ingest URL', 'edit knowledge-url');
    expectSetupAction('context-knowledge-file', 'Ingest file', 'edit knowledge-file');
  });

  test('renders local persona posture in the memory workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Memory: 1; prompt 0; queue 1; session 1.');
    expect(output).toContain('Notes: 0; skills 1/1; routines 1/1; personas 1.');
    expect(output).toContain('Active persona: Research Analyst.');
    expect(output).toContain('Agent Memory: 1; selected Prefers concise operator briefings');
    expect(output).toContain('Create memory');
    expect(output).toContain('Search memory');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-promote');
    const maintenanceOutput = text(renderAgentWorkspace(workspace, 132, 34));

    expect(maintenanceOutput).toContain('Edit selected memory');
    expect(maintenanceOutput).toContain('Promote memory');
    expect(maintenanceOutput).toContain('Export memory bundle');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-handoff-inspect');
    const handoffOutput = text(renderAgentWorkspace(workspace, 132, 34));

    expect(handoffOutput).toContain('Inspect handoff bundle');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-vector-rebuild');
    const vectorOutput = text(renderAgentWorkspace(workspace, 132, 34));

    expect(vectorOutput).toContain('Rebuild vector index');
  });

  test('renders in-workspace local library editor controls', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    const personasOutput = text(renderAgentWorkspace(workspace, 132, 38));
    const normalizedPersonasOutput = personasOutput.replace(/\s+/g, ' ');
    expect(normalizedPersonasOutput).toContain('Personas shape the serial main-conversation assistant.');
    expect(normalizedPersonasOutput).toContain('Persona Library: 1; selected Research Analyst');
    expect(normalizedPersonasOutput).not.toContain('not separate workers');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-search');
    workspace.activateSelected();
    const personaSearchOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(personaSearchOutput).toContain('Search Personas');
    expect(personaSearchOutput).toContain('Search query');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-show');
    workspace.activateSelected();
    const personaShowOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(personaShowOutput).toContain('Show Persona');
    expect(personaShowOutput).toContain('Persona id *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-search');
    workspace.activateSelected();
    const skillSearchOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(skillSearchOutput).toContain('Search Skills');
    expect(skillSearchOutput).toContain('Search query');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-show');
    workspace.activateSelected();
    const skillShowOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(skillShowOutput).toContain('Show Skill');
    expect(skillShowOutput).toContain('Skill id *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Create Skill');
    expect(output).toContain('Name *');
    expect(output).toContain('more field(s) below');
    workspace.moveEditorField(2);
    const procedureOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(procedureOutput).toContain('Procedure *');
    expect(output).toContain('Enter next/save');
    expect(output).toContain('Esc cancel');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-search');
    workspace.activateSelected();
    const routineSearchOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(routineSearchOutput).toContain('Search Routines');
    expect(routineSearchOutput).toContain('Search query');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-show');
    workspace.activateSelected();
    const routineShowOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(routineShowOutput).toContain('Show Routine');
    expect(routineShowOutput).toContain('Routine id *');
  });

  test('renders local skill bundles in the skills workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');

    const output = text(renderAgentWorkspace(workspace, 132, 42));

    expect(output).toContain('Skills: 1; enabled: 1; bundles: 1; enabled bundles: 1; active skills: 1');
    expect(output).toContain('Skill bundles');
    expect(output).toContain('/skills bundle list');
    expect(output).toContain('Needs setup');
    expect(output).toContain('Create bundle');
    expect(output).toContain('Bundle setup gaps');
    expect(output).toContain('/skills bundle attention');
    expect(output).toContain('edit skill-bundle');
    expect(output).toContain('Skill Bundles: 1; selected Operator Pack');
    expect(output).toContain('Skill Library: 1; selected Briefing');
    expect(output).toContain('needs 1/1');
    expect(output).toContain('Missing setup: env:GOODVIBES_AGENT_TEST_MISSING_TOKEN');
  });

  test('renders skill bundle lifecycle forms in the skills workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-update-bundle');
    workspace.activateSelected();
    const updateOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(updateOutput).toContain('Update Skill Bundle');
    expect(updateOutput).toContain('Bundle id *');
    workspace.moveEditorField(3);
    const updateSkillsOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(updateSkillsOutput).toContain('Skill ids');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-stale-bundle');
    workspace.activateSelected();
    const staleOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(staleOutput).toContain('Mark Skill Bundle Stale');
    expect(staleOutput).toContain('Reason *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-delete-bundle');
    workspace.activateSelected();
    const deleteOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(deleteOutput).toContain('Delete Skill Bundle');
    expect(deleteOutput).toContain('Confirm *');
  });

  test('renders routine setup readiness in the routines workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');

    const output = text(renderAgentWorkspace(workspace, 132, 42));

    expect(output).toContain('Routines: 1; enabled: 1');
    expect(output).toContain('Schedule-ready routines: 0; setup gaps: 1; review needed: 1');
    expect(output).toContain('Next routine action: Needs setup for daily-brief before it can be trusted for schedule promotion.');
    expect(output).toContain('Promotion receipts: 0; none created yet.');
    expect(output).toContain('Repeatable workflows with setup readiness');
    expect(output).toContain('Needs setup');
    expect(output).toContain('Routine Library: 1; selected Daily Brief');
    expect(output).toContain('needs 1/1');
    expect(output).toContain('Missing setup: env:GOODVIBES_AGENT_TEST_MISSING_ROUTINE_TOKEN');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-receipt');
    const receiptActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(receiptActionOutput).toContain('Show promotion receipt');
    expect(receiptActionOutput).toContain('edit routine-receipt');

    workspace.activateSelected();
    const receiptEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(receiptEditorOutput).toContain('Show Routine Promotion Receipt');
    expect(receiptEditorOutput).toContain('Receipt id *');
  });

  test('renders Agent Knowledge ingest and review workflow without default knowledge fallback', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-url');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('/api/goodvibes-agent/knowledge');
    expect(output).toContain('isolation agent-only');
    expect(output).toContain('Ingest requires explicit confirmation');
    expect(output).toContain('Search Agent knowledge');
    expect(output).toContain('edit knowledge-search');
    expect(output).toContain('Ingest URL');
    expect(output).toContain('edit knowledge-url');
    expect(output).toContain('Import URL list');
    expect(output).toContain('edit knowledge-urls');
    expect(output).toContain('Import bookmarks');
    expect(output).toContain('edit knowledge-bookmarks');
    expect(output).toContain('Connector inventory');
    expect(output).toContain('/knowledge connectors');
    expect(output).toContain('more action(s) below');
    expect(output).not.toContain('/knowledge search <query>');
    expect(output).not.toContain('/api/knowledge');
    expect(output).not.toContain('non-Agent product setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-review-queue');
    const reviewOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(reviewOutput).toContain('Review queue');
    expect(reviewOutput).toContain('/knowledge queue');
    expect(reviewOutput).toContain('Source library');
    expect(reviewOutput).toContain('/knowledge list --kind sources');
    expect(reviewOutput).toContain('Node library');
    expect(reviewOutput).toContain('/knowledge list --kind nodes');
    expect(reviewOutput).toContain('Issue library');
    expect(reviewOutput).toContain('/knowledge list --kind issues');
    expect(reviewOutput).not.toContain('/api/knowledge');
  });

  test('renders Agent Knowledge query forms with focused input fields', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-search');
    workspace.activateSelected();
    const searchOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(searchOutput).toContain('Search Agent Knowledge');
    expect(searchOutput).toContain('Search query *');
    expect(searchOutput).toContain('Results come from Agent-owned sources only');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ask');
    workspace.activateSelected();
    const askOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(askOutput).toContain('Ask Agent Knowledge');
    expect(askOutput).toContain('Question *');
    expect(askOutput).toContain('fails closed instead of using');
  });

  test('renders Agent Knowledge maintenance forms from the workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-review-issue');
    workspace.activateSelected();
    const reviewOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(reviewOutput).toContain('Review Agent Knowledge Issue');
    expect(reviewOutput).toContain('Issue id *');
    expect(reviewOutput).toContain('Action *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-packet');
    workspace.activateSelected();
    const packetOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(packetOutput).toContain('Build Prompt Packet');
    expect(packetOutput).toContain('Task *');
    expect(packetOutput).toContain('Scopes');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-consolidate');
    workspace.activateSelected();
    const consolidateOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(consolidateOutput).toContain('Consolidate Agent Knowledge');
    expect(consolidateOutput).toContain('Confirm *');
  });

  test('renders bookmark media and skill bundle command forms with concrete fields', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-import-bookmarks');
    workspace.activateSelected();
    const bookmarkOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(bookmarkOutput).toContain('Import Bookmarks into Agent Knowledge');
    expect(bookmarkOutput).toContain('Bookmark export path *');
    expect(bookmarkOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'image-attach');
    workspace.activateSelected();
    const imageOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(imageOutput).toContain('Attach Image Input');
    expect(imageOutput).toContain('Image path *');
    expect(imageOutput).toContain('Prompt');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create-bundle');
    workspace.activateSelected();
    const bundleOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(bundleOutput).toContain('Create Skill Bundle');
    expect(bundleOutput).toContain('Bundle name *');
    workspace.moveEditorField(2);
    const bundleSkillsOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(bundleSkillsOutput).toContain('Skill ids *');
  });

  test('renders Agent Knowledge URL-list and reindex forms with confirmation fields', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-import-urls');
    workspace.activateSelected();
    const urlListOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(urlListOutput).toContain('Import URL List into Agent Knowledge');
    expect(urlListOutput).toContain('URL list path *');
    expect(urlListOutput).toContain('Allow private hosts');
    expect(urlListOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-reindex');
    workspace.activateSelected();
    const reindexOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(reindexOutput).toContain('Reindex Agent Knowledge');
    expect(reindexOutput).toContain('Confirm *');
  });

  test('renders routine schedule promotion as an in-workspace form', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-promote-routine');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Promote Routine to Schedule');
    expect(output).toContain('Routine id *');
    expect(output).toContain('daily-brief');
    expect(output).toContain('Schedule value *');
    expect(output).toContain('more field(s) below');
    workspace.moveEditorField(5);
    const deliveryOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(deliveryOutput).toContain('Delivery channel');
    expect(deliveryOutput).toContain('more field(s) above');
    workspace.moveEditorField(2);
    const confirmOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(confirmOutput).toContain('Confirm *');
    expect(output).not.toContain('<routine-id>');
    expect(output).not.toContain('<expr>');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-receipt');
    const receiptActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(receiptActionOutput).toContain('Show receipt');
    expect(receiptActionOutput).toContain('edit schedule-receipt');

    workspace.activateSelected();
    const receiptEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(receiptEditorOutput).toContain('Show Schedule Receipt');
    expect(receiptEditorOutput).toContain('Receipt id *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'health-repair');
    const healthActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(healthActionOutput).toContain('Health repair guidance');
    expect(healthActionOutput).toContain('edit health-repair');

    workspace.activateSelected();
    const healthEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(healthEditorOutput).toContain('Show Health Repair Guidance');
    expect(healthEditorOutput).toContain('Domain *');
  });

  test('renders automation next action and local schedule receipt state', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-schedule-receipts-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const routines = AgentRoutineRegistry.fromShellPaths(shellPaths);
    routines.create({
      name: 'Daily Brief',
      description: 'Summarize operator state.',
      steps: 'Review current daemon, tasks, approvals, and Agent Knowledge status first.',
      enabled: true,
    });
    routines.markReviewed('daily-brief');
    const receiptPath = routineScheduleReceiptStorePath(shellPaths);
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify({
      version: 1,
      receipts: [
        {
          id: 'daily-brief-20260602',
          createdAt: '2026-06-02T12:00:00.000Z',
          routineId: 'daily-brief',
          routineName: 'Daily Brief',
          route: '/api/automation/schedules',
          method: 'schedules.create',
          status: 'created',
          daemonBaseUrl: 'http://127.0.0.1:3421',
          scheduleId: 'schedule-1',
          scheduleStatus: 'enabled',
          scheduleName: 'Daily Brief',
          scheduleKind: 'cron',
          scheduleValue: '0 9 * * *',
          enabled: true,
          target: { kind: 'surface', surfaceKind: 'tui' },
          deliveryMode: 'surface',
        },
      ],
    }, null, 2)}\n`);
    const workspace = new AgentWorkspace();
    workspace.open({
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext, () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');

    const output = text(renderAgentWorkspace(workspace, 150, 44));

    expect(output).toContain('Automation: 1 schedule-ready routine(s); receipts 1.');
    expect(output).toContain('Next automation action: Reconcile schedules to compare local receipts with the connected host.');
    expect(output).toContain('Promotion receipts: 1; latest created daily-brief.');
    expect(output).toContain('Reminders and routine promotion require confirmation.');
  });

  test('renders voice media and browser tool setup posture', () => {
    const keys = ['ELEVENLABS_API_KEY', 'XI_API_KEY', 'FAL_KEY', 'FAL_API_KEY'] as const;
    const previous = new Map(keys.map((key) => [key, process.env[key]] as const));
    for (const key of keys) delete process.env[key];
    const workspace = new AgentWorkspace();
    try {
      workspace.open(liveCommandContext(), () => undefined);
      workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');

      const output = text(renderAgentWorkspace(workspace, 132, 54));

      expect(output).toContain('Voice & Media');
      expect(output).toContain('Voice: 0/2 ready; TTS elevenlabs; voice voice-operator.');
      expect(output).toContain('Media: 1/2 ready; generation 1.');
      expect(output).toContain('Browser: public-url; public URL https://agent.example.test.');
      expect(output).toContain('Secrets hidden; voice, browser, and media side effects require explicit action.');
      expect(output).toContain('/config tts');
      expect(output).toContain('edit tts-prompt');
      expect(output).toContain('edit image-input');
      expect(output).toContain('/mcp servers');
      expect(output).toContain('/mcp tools');
      expect(output).not.toContain('/remote list');
    } finally {
      for (const key of keys) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('renders Tools and MCP setup posture with confirmed add form', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Tools & MCP');
    expect(output).toContain('MCP servers: 1/2 connected; quarantined 1; allow-all 1.');
    expect(output).toContain('Open MCP workspace');
    expect(output).toContain('/mcp review');
    expect(output).toContain('/mcp tools');
    expect(output).toContain('Server tool inventory');
    expect(output).toContain('/mcp config');
    expect(output).toContain('edit mcp-server');
    expect(output).toContain('Repair guidance');
    expect(output).toContain('edit mcp-repair');
    expect(output).toContain('require confirmation');
    expect(output).toContain('allow-all');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-tools-server');
    const toolsActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(toolsActionOutput).toContain('Server tool inventory');
    expect(toolsActionOutput).toContain('edit mcp-tools-server');

    workspace.activateSelected();
    const toolsEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(toolsEditorOutput).toContain('Show MCP Server Tools');
    expect(toolsEditorOutput).toContain('Server name *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-repair');
    const repairActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(repairActionOutput).toContain('Repair guidance');
    expect(repairActionOutput).toContain('edit mcp-repair');

    workspace.activateSelected();
    const repairEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(repairEditorOutput).toContain('Show MCP Repair Guidance');
    expect(repairEditorOutput).toContain('Server name *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'security-attack-paths');
    const attackPathOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(attackPathOutput).toContain('MCP attack paths');
    expect(attackPathOutput).toContain('/security attack-paths');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'security-tokens');
    const tokenOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(tokenOutput).toContain('Token audit');
    expect(tokenOutput).toContain('/security tokens');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-add-server');
    workspace.activateSelected();
    const editorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(editorOutput).toContain('Add MCP Server');
    expect(editorOutput).toContain('Server name *');
    expect(editorOutput).toContain('Command *');
    workspace.moveEditorField(9);
    const confirmOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(confirmOutput).toContain('Confirm *');
  });

  test('renders secret setup forms without exposing raw secret field values', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'secret-set');

    workspace.activateSelected();
    workspace.appendEditorText('OPENAI_API_KEY');
    workspace.submitEditorFieldOrForm();
    workspace.appendEditorText('sk-render-secret-value');
    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Store Secret Value');
    expect(output).toContain('Secret value *');
    expect(output).toContain('************');
    expect(output).not.toContain('sk-render-secret-value');
  });

  test('renders profile isolation and bundle workflow posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Profiles');
    expect(output).toContain('Profiles: active (default home); default household.');
    expect(output).toContain('Local profiles: 1; starters 5; custom 0.');
    expect(output).not.toContain('Config profiles:');
    expect(output).not.toContain('/profiles');
    expect(output).toContain('Starter authoring guide');
    expect(output).toContain('/agent-profile guide');
    expect(output).toContain('/agent-profile templates');
    expect(output).toContain('/agent-profile list');
    expect(output).toContain('edit profile-template-export');
    expect(output).toContain('edit profile-template-import');
    expect(output).toContain('Use as default profile');
    expect(output).toContain('edit profile-default');
    expect(output).not.toContain('/profilesync');
    expect(output).not.toContain('/setup transfer');
    expect(output).toContain('Starter ids: household, research, travel, operations, personal-productivity');
    expect(output).toContain('Profiles isolate local Agent config');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-clear-default');
    const clearOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(clearOutput).toContain('Clear default profile');
    expect(clearOutput).toContain('edit profile-default-clear');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-delete');
    const deleteOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(deleteOutput).toContain('Delete Agent profile');
    expect(deleteOutput).toContain('edit profile-delete');
  });

  test('renders profile starter export and import forms with concrete fields', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-export');
    workspace.activateSelected();
    const exportOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(exportOutput).toContain('Export Agent Starter Template');
    expect(exportOutput).toContain('Starter id *');
    expect(exportOutput).toContain('Output path *');
    workspace.moveEditorField(2);
    const exportConfirmOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(exportConfirmOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-import');
    workspace.activateSelected();
    const importOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(importOutput).toContain('Import Agent Starter Template');
    expect(importOutput).toContain('Template path *');
    expect(importOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-show');
    workspace.activateSelected();
    const previewOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(previewOutput).toContain('Preview Agent Starter Template');
    expect(previewOutput).toContain('Starter id *');
  });

  test('renders channel onboarding and delivery safety posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Channels');
    expect(output).toContain('Setup path');
    expect(output).toContain('Companion: goodvibes-agent; token ready sha256:');
    expect(output).not.toContain('goodvibes-agent-test-token');
    expect(output).toContain('Channels: 2/14 ready; 2 enabled; 1 target(s).');
    expect(output).toContain('Next: Telegram');
    expect(output).toContain('Pair companion');
    expect(output).toContain('/pair');
    expect(output).toContain('Channel readiness');
    expect(output).toContain('/channels');
    expect(output).toContain('Needs attention');
    expect(output).toContain('/channels attention');
    expect(output).toContain('Channel accounts');
    expect(output).toContain('/channels accounts');
    expect(output).toContain('Channel policies');
    expect(output).toContain('/channels policies');
    expect(output).toContain('Live channel status');
    expect(output).toContain('/channels status');
    expect(output).toContain('Show channel detail');
    expect(output).toContain('edit channel-show');
    expect(output).toContain('Run channel doctor');
    expect(output).toContain('edit channel-doctor');
    expect(output).toContain('/notify list');
    expect(output).toContain('edit notify-send');
    expect(output).toContain('Secrets hidden; sends require explicit action.');
    expect(output).not.toContain('SLACK_BOT_TOKEN');
    expect(output).not.toContain('TELEGRAM_BOT_TOKEN');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'channel-setup');
    const setupOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(setupOutput).toContain('Setup guidance');
    expect(setupOutput).toContain('edit channel-setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'notification-clear-webhooks');
    const notificationOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(notificationOutput).toContain('edit notify-webhook');
    expect(notificationOutput).toContain('edit notify-webhook-clear');
    expect(notificationOutput).toContain('edit notify-webhook-test');
    expect(notificationOutput).toContain('edit notify-send');
  });

  test('renders action feedback and refresh affordance', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'delegation-status');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Action Result');
    expect(output).toContain('Opening Delegation status');
    expect(output).toContain('/delegate status');
    expect(output).toContain('R refresh');
  });

  test('renders build delegation form as a confirmed TUI workflow', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'delegate-task');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Delegate Build Work to GoodVibes TUI');
    expect(output).toContain('Original task *');
    expect(output).toContain('Request delegated review');
    expect(output).toContain('Confirm *');
    expect(output).toContain('editing delegate-task');
  });

  test('renders work plan edit actions in the TUI workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Add work item');
    expect(output).toContain('edit workplan-add');
    expect(output).toContain('Show work plan detail');
    expect(output).toContain('edit workplan-show');
    expect(output).toContain('Update work item status');
    expect(output).toContain('edit workplan-status');
    expect(output).toContain('Remove work item');
    expect(output).toContain('edit workplan-delete');
    expect(output).toContain('Clear completed work');
    expect(output).toContain('edit workplan-clear-completed');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan-show');
    const workPlanDetailOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(workPlanDetailOutput).toContain('Show work plan detail');
    expect(workPlanDetailOutput).toContain('edit workplan-show');

    workspace.activateSelected();
    const workPlanEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(workPlanEditorOutput).toContain('Show Work Plan Detail');
    expect(workPlanEditorOutput).toContain('Format');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-seed');
    const seedActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(seedActionOutput).toContain('Seed planning goal');
    expect(seedActionOutput).toContain('edit plan-seed');

    workspace.activateSelected();
    const seedEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(seedEditorOutput).toContain('Seed Planning Goal');
    expect(seedEditorOutput).toContain('Planning goal *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-show');
    const planOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(planOutput).toContain('Show saved plan');
    expect(planOutput).toContain('edit plan-show');

    workspace.activateSelected();
    const planEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(planEditorOutput).toContain('Show Saved Plan');
    expect(planEditorOutput).toContain('Plan id *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-approve');
    const approveActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(approveActionOutput).toContain('Approve planning state');
    expect(approveActionOutput).toContain('edit plan-approve');

    workspace.activateSelected();
    const approveEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(approveEditorOutput).toContain('Approve Planning State');
    expect(approveEditorOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-override');
    const overrideActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(overrideActionOutput).toContain('Override planning strategy');
    expect(overrideActionOutput).toContain('edit plan-override');

    workspace.activateSelected();
    const overrideEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(overrideEditorOutput).toContain('Override Planning Strategy');
    expect(overrideEditorOutput).toContain('Strategy *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-clear');
    const clearActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(clearActionOutput).toContain('Clear planning state');
    expect(clearActionOutput).toContain('edit plan-clear');

    workspace.activateSelected();
    const clearEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(clearEditorOutput).toContain('Clear Planning State');
    expect(clearEditorOutput).toContain('Confirm *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'approval-review');
    const approvalActionOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(approvalActionOutput).toContain('Review approval class');
    expect(approvalActionOutput).toContain('edit approval-review');

    workspace.activateSelected();
    const approvalEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(approvalEditorOutput).toContain('Review Approval Class');
    expect(approvalEditorOutput).toContain('Approval kind *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tasks-filter');
    const taskFilterOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(taskFilterOutput).toContain('Filter host tasks');
    expect(taskFilterOutput).toContain('edit task-list-filter');

    workspace.activateSelected();
    const taskFilterEditorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(taskFilterEditorOutput).toContain('Filter Host Tasks');
    expect(taskFilterEditorOutput).toContain('Status or kind');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'task-show');
    const taskOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(taskOutput).toContain('Inspect host task');
    expect(taskOutput).toContain('edit task-show');
    expect(taskOutput).toContain('Show task output');
    expect(taskOutput).toContain('edit task-output');

    workspace.activateSelected();
    const editorOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(editorOutput).toContain('Inspect Host Task');
    expect(editorOutput).toContain('Task id *');
  });

  test('renders session continuity and interaction mode forms in the workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mode-preset');
    workspace.activateSelected();
    const modeOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(modeOutput).toContain('Set Interaction Mode');
    expect(modeOutput).toContain('Preset *');

    workspace.cancelLocalEditor();
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-export');
    workspace.activateSelected();
    const exportOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(exportOutput).toContain('Export Conversation');
    expect(exportOutput).toContain('Output path *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-events');
    workspace.activateSelected();
    const eventsOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(eventsOutput).toContain('Show Transcript Events');
    expect(eventsOutput).toContain('Event kind');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-groups');
    workspace.activateSelected();
    const groupsOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(groupsOutput).toContain('Show Transcript Groups');
    expect(groupsOutput).toContain('Event kind');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-find');
    workspace.activateSelected();
    const findOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(findOutput).toContain('Find Transcript Text');
    expect(findOutput).toContain('Search query *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-load');
    workspace.activateSelected();
    const loadOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(loadOutput).toContain('Load Session');
    expect(loadOutput).toContain('Session name *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-rename');
    workspace.activateSelected();
    const renameOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(renameOutput).toContain('Rename Current Session');
    expect(renameOutput).toContain('New session name *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-fork');
    workspace.activateSelected();
    const forkOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(forkOutput).toContain('Fork Current Session');
    expect(forkOutput).toContain('Fork name');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-resume');
    workspace.activateSelected();
    const resumeOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(resumeOutput).toContain('Resume Saved Session');
    expect(resumeOutput).toContain('Session id or name *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-info');
    workspace.activateSelected();
    const infoOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(infoOutput).toContain('Inspect Saved Session');
    expect(infoOutput).toContain('Session id or name *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-graph');
    workspace.activateSelected();
    const graphOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(graphOutput).toContain('Inspect Session Graph');
    expect(graphOutput).toContain('Session id');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-export-saved');
    workspace.activateSelected();
    const savedExportOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(savedExportOutput).toContain('Export Saved Session');
    expect(savedExportOutput).toContain('Format *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-search');
    workspace.activateSelected();
    const searchOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(searchOutput).toContain('Search Saved Sessions');
    expect(searchOutput).toContain('Search query *');

    workspace.cancelLocalEditor();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-delete');
    workspace.activateSelected();
    const deleteOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(deleteOutput).toContain('Delete Saved Session');
    expect(deleteOutput).toContain('Confirm *');
  });
});
