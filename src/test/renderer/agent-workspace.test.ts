import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { createAgentRuntimeProfile } from '../../agent/runtime-profile.ts';
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

function liveCommandContext(): CommandContext {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-render-'));
  const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  createAgentRuntimeProfile(root, 'household');
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
    enabled: true,
  });
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
    expect(output).toContain('Setup checklist');
    expect(output).toContain('open setup');
    expect(output).toContain('Memory, skills, routines');
    expect(output).toContain('open memory');
    expect(output).toContain('Choose model');
    expect(output).toContain('/model');
    expect(output).toContain('Agent workspace');
    expect(output).toContain('Enter open/action');
  });

  test('renders build delegation as an explicit TUI handoff area', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');

    const output = text(renderAgentWorkspace(workspace, 130, 34));

    expect(output).toContain('Build Delegation');
    expect(output).toContain('GoodVibes TUI');
    expect(output).toContain('WRFC only when explicitly requested');
    expect(output).not.toContain('coding transcript');
  });

  test('renders live Agent context from the command runtime', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    const output = text(renderAgentWorkspace(workspace, 132, 50));

    expect(output).toContain('Live Agent Context');
    expect(output).toContain('openai-subscriber / GPT-5.5');
    expect(output).toContain('agent-session-1');
    expect(output).toContain('serial-proactive');
  });

  test('renders setup checklist in the setup workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    const output = text(renderAgentWorkspace(workspace, 132, 44));

    expect(output).toContain('Setup Checklist');
    expect(output).toContain('Connection: http://127.0.0.1:3421');
    expect(output).toContain('Agent role: interactive operator TUI');
    expect(output).toContain('setup changes here are Agent-local');
    expect(output).toContain('READY Provider and model -> /model');
    expect(output).toContain('RECOMMENDED Agent Knowledge -> /knowledge status');
    expect(output).toContain('READY Persona -> /personas');
    expect(output).toContain('READY Skills -> /agent-skills');
    expect(output).toContain('READY Routines -> /routines');
    expect(output).toContain('READY Channels -> /pair');
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

  test('renders discovered behavior files as first-run setup actions', () => {
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
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    const output = text(renderAgentWorkspace(workspace, 150, 52));

    expect(output).toContain('RECOMMENDED Agent profile -> /agent-profile guide');
    expect(output).toContain('3 discovered behavior file(s) can seed an isolated Agent profile');
    expect(output).toContain('RECOMMENDED Persona -> /personas discover');
    expect(output).toContain('RECOMMENDED Skills -> /agent-skills discover');
    expect(output).toContain('RECOMMENDED Routines -> /routines discover');
    expect(output).toContain('Discovered Behavior Files');
    expect(output).toContain('Discovered personas: 1 discovered; project 1; global 0.');
    expect(output).toContain('Research Operator');
    expect(output).toContain('Discovered skills: 1 discovered; project 1; global 0.');
    expect(output).toContain('Daily Brief Skill');
    expect(output).toContain('Discovered routines: 1 discovered; project 1; global 0.');
    expect(output).toContain('Evening Review');
    expect(output).not.toContain('default Knowledge/Wiki');
  });

  test('renders first-run setup actions for skills and routines', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    const output = text(renderAgentWorkspace(workspace, 150, 48));

    expect(output).toContain('Skills');
    expect(output).toContain('/agent-skills');
    expect(output).toContain('Routines');
    expect(output).toContain('/routines');
    expect(output).toContain('Agent Knowledge');
    expect(output).toContain('/knowledge status');
    expect(output).toContain('Voice and media');
    expect(output).toContain('/config tts');
  });

  test('renders local persona posture in the memory workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Local routines: 1; enabled: 1');
    expect(output).toContain('Local skills: 1; enabled: 1; bundles: 1; active skills: 1');
    expect(output).toContain('Local personas: 1; active: Research Analyst');
    expect(output).toContain('Agent memory: 1; prompt-active: 0; review queue: 1');
    expect(output).toContain('Create memory');
    expect(output).toContain('Edit selected memory');
    expect(output).toContain('Prefers concise operator briefings');
  });

  test('renders in-workspace local library editor controls', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Create Skill');
    expect(output).toContain('Name *');
    expect(output).toContain('more field(s) below');
    workspace.moveEditorField(2);
    const procedureOutput = text(renderAgentWorkspace(workspace, 132, 38));
    expect(procedureOutput).toContain('Procedure *');
    expect(procedureOutput).toContain('more field(s) above');
    expect(output).toContain('Enter next/save');
    expect(output).toContain('Esc cancel');
  });

  test('renders local skill bundles in the skills workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');

    const output = text(renderAgentWorkspace(workspace, 132, 42));

    expect(output).toContain('Skills: 1; enabled: 1; bundles: 1; enabled bundles: 1; active skills: 1');
    expect(output).toContain('Skill bundles');
    expect(output).toContain('/agent-skills bundle list');
    expect(output).toContain('Create bundle');
    expect(output).toContain('edit skill-bundle');
    expect(output).toContain('Skill Bundles');
    expect(output).toContain('operator-pack: Operator Pack');
    expect(output).toContain('Skills: briefing');
  });

  test('renders Agent Knowledge ingest and review workflow without default wiki fallback', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-url');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('/api/goodvibes-agent/knowledge');
    expect(output).toContain('no default Knowledge/Wiki or non-Agent fallback');
    expect(output).toContain('Search Agent knowledge');
    expect(output).toContain('edit knowledge-search');
    expect(output).toContain('Ingest URL');
    expect(output).toContain('edit knowledge-url');
    expect(output).toContain('Import bookmarks');
    expect(output).toContain('edit knowledge-bookmarks');
    expect(output).toContain('in-workspace form');
    expect(output).toContain('Review queue');
    expect(output).toContain('/knowledge queue');
    expect(output).toContain('Source library');
    expect(output).toContain('/knowledge list --kind sources');
    expect(output).toContain('Ask Agent knowledge');
    expect(output).toContain('edit knowledge-ask');
    expect(output).not.toContain('/knowledge search <query>');
    expect(output).not.toContain('Consolidation review');
    expect(output).not.toContain('/knowledge candidates');
    expect(output).not.toContain('/api/knowledge');
    expect(output).not.toContain('non-Agent product setup');
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
    expect(askOutput).toContain('another wiki');
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
    expect(deliveryOutput).toContain('more field(s) below');
    workspace.moveEditorField(2);
    const confirmOutput = text(renderAgentWorkspace(workspace, 132, 44));
    expect(confirmOutput).toContain('Confirm *');
    expect(output).not.toContain('<routine-id>');
    expect(output).not.toContain('<expr>');
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
      expect(output).toContain('Voice providers: 2; streaming TTS: 1; STT: 2; realtime: 1.');
      expect(output).toContain('Voice interaction: enabled; ready providers 0/2.');
      expect(output).toContain('TTS config: provider elevenlabs; voice voice-operator; response model openai-subscriber/gpt-5.5.');
      expect(output).toContain('Selected TTS readiness: ElevenLabs -> needs-secret; voice configured; response route configured.');
      expect(output).toContain('Media providers: 2; understanding: 1; generation: 1.');
      expect(output).toContain('Ready media providers: 1/2.');
      expect(output).toContain('Browser tools: public-url; public base URL https://agent.example.test.');
      expect(output).toContain('ElevenLabs: selected; needs-secret; tts-stream, stt, realtime; needs');
      expect(output).toContain('ELEVENLABS_API_KEY|XI_API_KEY.');
      expect(output).toContain('Fal: needs-secret; generate; needs FAL_KEY|FAL_API_KEY.');
      expect(output).toContain('No secret values are rendered.');
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
    expect(output).toContain('/mcp config');
    expect(output).toContain('edit mcp-server');
    expect(output).toContain('typed confirmation');
    expect(output).toContain('allow-all');

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

  test('renders profile isolation and bundle workflow posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Profiles');
    expect(output).toContain('Active Agent profile: (default home)');
    expect(output).toContain('Agent profiles under this home: 1');
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
    expect(output).toContain('Starter templates: 5; local custom: 0');
    expect(output).toContain('Starter ids: household, research, travel, operations, personal-productivity');
    expect(output).toContain('Agent Profiles');
    expect(output).toContain('household starter=none');
    expect(output).toContain('Starter Templates');
    expect(output).toContain('separate assistants for household');
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
  });

  test('renders channel onboarding and delivery safety posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Channels');
    expect(output).toContain('Pair companion');
    expect(output).toContain('/pair');
    expect(output).toContain('Channel readiness');
    expect(output).toContain('/channels');
    expect(output).toContain('/notify list');
    expect(output).toContain('edit notify-webhook');
    expect(output).toContain('edit notify-webhook-remove');
    expect(output).toContain('edit notify-webhook-test');
    expect(output).toContain('/health review');
    expect(output).toContain('Safety: no secret values; sends and public exposure require explicit user action and Agent');
    expect(output).toContain('policy.');
    expect(output).toContain('Readiness: 2/13 ready; 2 enabled; 1 default target(s) configured.');
    expect(output).toContain('Ready channels: Slack, Telegram.');
    expect(output).toContain('Needs default target: Telegram -> surfaces.telegram.defaultChatId.');
    expect(output).toContain('Needs config: none.');
    expect(output).toContain('Slack: ready; ready; target configured; delivery default-ready; risk group.');
    expect(output).toContain('Telegram: needs-target; ready; target missing; delivery explicit-target; risk dm.');
    expect(output).toContain('Discord: disabled; 3 missing; target missing; delivery disabled; risk group.');
    expect(output).toContain('Disabled channels: Discord, ntfy, Google Chat, Signal, WhatsApp, iMessage, +5 more.');
    expect(output).toContain('WhatsApp');
    expect(output).not.toContain('SLACK_BOT_TOKEN');
    expect(output).not.toContain('TELEGRAM_BOT_TOKEN');
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
});
