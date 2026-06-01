import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
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

function text(lines: readonly Line[]): string {
  return lines.map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd()).join('\n');
}

function commandContext(): CommandContext {
  return {
    executeCommand: async () => true,
    print: () => undefined,
  } as unknown as CommandContext;
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

    const output = text(renderAgentWorkspace(workspace, 132, 34));

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
    expect(output).toContain('READY Provider and model -> /model');
    expect(output).toContain('RECOMMENDED Agent Knowledge -> /knowledge status');
    expect(output).toContain('READY Persona -> /personas');
    expect(output).toContain('READY Skills -> /agent-skills');
    expect(output).toContain('READY Routines -> /routines');
    expect(output).toContain('READY Channels -> /pair');
    expect(output).not.toContain('SLACK_BOT_TOKEN');
    expect(output).not.toContain('daemon URL');
    expect(output).not.toContain('External Daemon');
    expect(output).not.toContain('service mode');
    expect(output).not.toContain('HTTP listeners');
    expect(output).not.toContain('tunnel provider setup');
    expect(output).not.toContain('non-Agent assistant segment');
    expect(output).not.toContain('non-Agent graph segment');
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
    expect(output).toContain('Local skills: 1; enabled: 1');
    expect(output).toContain('Local personas: 1; active: Research Analyst');
    expect(output).toContain('open routines');
    expect(output).toContain('open skills');
    expect(output).toContain('open personas');
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
    expect(output).toContain('Procedure *');
    expect(output).toContain('Enter next/save');
    expect(output).toContain('Esc cancel');
  });

  test('renders Agent Knowledge ingest and review workflow without default wiki fallback', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('/api/goodvibes-agent/knowledge');
    expect(output).toContain('no default Knowledge/Wiki or non-Agent fallback');
    expect(output).toContain('Ingest URL');
    expect(output).toContain('/knowledge ingest-url <url> --yes');
    expect(output).toContain('Review queue');
    expect(output).toContain('/knowledge queue');
    expect(output).toContain('Consolidation review');
    expect(output).not.toContain('/api/knowledge');
    expect(output).not.toContain('non-Agent product setup');
  });

  test('renders voice media and browser tool setup posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Voice & Media');
    expect(output).toContain('Voice providers: 2; streaming TTS: 1; STT: 2; realtime: 1.');
    expect(output).toContain('Voice surface: enabled');
    expect(output).toContain('TTS config: provider elevenlabs; voice voice-operator; response model openai-subscriber/gpt-5.5.');
    expect(output).toContain('Media providers: 2; understanding: 1; generation: 1.');
    expect(output).toContain('Browser tools: available; public base URL https://agent.example.test.');
    expect(output).toContain('/config tts');
    expect(output).toContain('/image <path> <prompt>');
    expect(output).toContain('/mcp servers');
    expect(output).not.toContain('/remote list');
  });

  test('renders profile isolation and bundle workflow posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');

    const output = text(renderAgentWorkspace(workspace, 132, 38));

    expect(output).toContain('Profiles');
    expect(output).toContain('Active Agent profile: (default home)');
    expect(output).toContain('Agent profiles under this home: 1');
    expect(output).toContain('Config profiles: 2');
    expect(output).toContain('/profiles');
    expect(output).toContain('Starter authoring guide');
    expect(output).toContain('/agent-profile guide');
    expect(output).toContain('/agent-profile templates');
    expect(output).toContain('/profilesync list');
    expect(output).toContain('/profilesync export <path> --yes');
    expect(output).toContain('/setup transfer export <path> --yes');
    expect(output).toContain('Starter templates: 5; local custom: 0');
    expect(output).toContain('Starter authoring: browse, export, edit, import, and create Agent profiles');
    expect(output).toContain('external GoodVibes runtime remains shared');
  });

  test('renders channel onboarding and delivery safety posture', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Channels');
    expect(output).toContain('Pair companion');
    expect(output).toContain('/pair');
    expect(output).toContain('/communication');
    expect(output).toContain('external delivery');
    expect(output).toContain('explicit policy and user');
    expect(output).toContain('action.');
    expect(output).toContain('Readiness: 2/13 ready; 2 enabled; 1 default target(s) configured.');
    expect(output).toContain('Slack: enabled; ready; default configured; delivery default-ready; risk workspace/group channel.');
    expect(output).toContain('Telegram: enabled; ready; default missing; delivery explicit-target; risk bot DM/group delivery.');
    expect(output).toContain('Disabled channels: Discord, ntfy');
    expect(output).toContain('WhatsApp');
    expect(output).not.toContain('SLACK_BOT_TOKEN');
    expect(output).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  test('renders action feedback and refresh affordance', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'remote-policy');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Action Result');
    expect(output).toContain('Remote runner policy is blocked in Agent');
    expect(output).toContain('/remote dispatch');
    expect(output).toContain('R refresh');
  });
});
