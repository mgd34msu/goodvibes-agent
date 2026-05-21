import type { AgentConfig } from '../config.js';
import { GoodVibesDaemonClient } from '../daemon/client.js';
import type { MemoryRecord } from '../store/memory.js';
import type { PersonaRecord } from '../store/personas.js';
import type { SkillRecord } from '../store/skills.js';
import { MemoryStore } from '../store/memory.js';
import { PersonaStore } from '../store/personas.js';
import { SkillStore } from '../store/skills.js';
import { AssistantProfileStore, type AssistantProfileState } from '../store/profile.js';
import { formatDaemonDiagnostics } from '../daemon/diagnostics-format.js';
import type { OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';
import { evaluateActionPolicy } from './policy.js';
import { buildAssistantSystemPrompt } from './system-prompt.js';
import { delegateToTui, shouldDelegateToTui, shouldRequestWrfc, type DelegationResult } from './delegation.js';
import { CompanionChatCoordinator, type CompanionChatStatus, type CompanionChatTurnResult } from './companion-chat.js';
import { resolveProviderModel, type ProviderModelSelection } from './provider-model.js';
import { formatKnowledgeAnswer, formatKnowledgeSearch } from './knowledge-format.js';
import { formatApprovals, formatWorkPlan } from './operator-format.js';
import {
  formatAutomationJobs,
  formatAutomationRuns,
  formatAutomationSnapshot,
  formatCapacity,
  formatHeartbeat,
  formatSchedules,
} from './automation-format.js';
import { formatDelegationReceipt, formatDelegationStatus, loadDelegationStatusSnapshot } from './delegation-status.js';
import { DelegationReceiptStore } from '../store/delegations.js';

export interface AssistantRuntimeOptions {
  readonly config: AgentConfig;
  readonly client?: GoodVibesDaemonClient | undefined;
}

export interface AssistantReply {
  readonly text: string;
  readonly data?: unknown | undefined;
}

export class AssistantRuntime {
  readonly client: GoodVibesDaemonClient;
  readonly memory = new MemoryStore();
  readonly skills = new SkillStore();
  readonly personas = new PersonaStore();
  readonly profile = new AssistantProfileStore();
  readonly delegations = new DelegationReceiptStore();
  readonly providerModel: ProviderModelSelection;
  private readonly companionChat: CompanionChatCoordinator;

  constructor(readonly options: AssistantRuntimeOptions) {
    this.client = options.client ?? new GoodVibesDaemonClient(options.config);
    this.providerModel = resolveProviderModel(options.config);
    this.companionChat = new CompanionChatCoordinator({
      client: this.client,
      title: options.config.defaultChatTitle,
      providerModel: this.providerModel,
      timeoutMs: options.config.companionTimeoutMs,
    });
  }

  async handleUserText(text: string): Promise<AssistantReply> {
    const trimmed = text.trim();
    if (!trimmed) return { text: '' };

    if (trimmed.startsWith('/')) return this.handleSlash(trimmed);

    const policy = evaluateActionPolicy(trimmed);
    if (policy.requiresApproval) {
      return {
        text: `I need approval before doing that. Reason: ${policy.reason}`,
        data: policy,
      };
    }

    const captured = this.options.config.autoRemember
      ? this.memory.autoCaptureFromUserText(trimmed)
      : null;

    if (this.options.config.autoDelegateBuildRequests && shouldDelegateToTui(trimmed)) {
      const result = await this.delegateBuildTask({
        task: trimmed,
        wrfc: shouldRequestWrfc(trimmed),
        reason: 'auto-build-delegation',
      });
      return {
        text: formatDelegationReceipt(result.receipt),
        data: result,
      };
    }

    const result = await this.sendChat(trimmed);
    const response = result.recovered && result.recovery
      ? `Recovered companion chat session ${result.recovery.previousSessionId} -> ${result.recovery.newSessionId}.\n\n${result.text}`
      : result.text;
    return {
      text: captured ? `${response}\n\nRemembered: ${captured.summary}` : response,
    };
  }

  async chat(text: string): Promise<string> {
    return (await this.sendChat(text)).text;
  }

  chatStatus(): CompanionChatStatus {
    return this.companionChat.status();
  }

  private async sendChat(text: string): Promise<CompanionChatTurnResult> {
    const profile = this.profile.current();
    const persona = this.resolveActivePersona(profile);
    const skills = this.resolveActiveSkills(profile);
    const memories = this.memory.search(text, 8);
    return this.companionChat.send(text, buildAssistantSystemPrompt({ persona, memories, skills }));
  }

  async askKnowledge(query: string): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'knowledge.ask'>>('knowledge.ask', {
      query,
      includeSources: true,
      includeConfidence: true,
      metadata: { originProduct: 'goodvibes-agent' },
    });
    return { text: formatKnowledgeAnswer(data), data };
  }

  async searchKnowledge(query: string): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'knowledge.search'>>('knowledge.search', {
      query,
      limit: 12,
      includeSources: true,
      includeNodes: true,
      metadata: { originProduct: 'goodvibes-agent' },
    });
    return { text: formatKnowledgeSearch(data, query), data };
  }

  async getApprovals(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'approvals.list'>>('approvals.list');
    return { text: formatApprovals(data), data };
  }

  async getWorkPlan(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'projectPlanning.workPlan.snapshot'>>('projectPlanning.workPlan.snapshot');
    return { text: formatWorkPlan(data), data };
  }

  async getAutomationSnapshot(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'automation.integration.snapshot'>>('automation.integration.snapshot');
    return { text: formatAutomationSnapshot(data), data };
  }

  async getAutomationJobs(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'automation.jobs.list'>>('automation.jobs.list');
    return { text: formatAutomationJobs(data), data };
  }

  async getAutomationRuns(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'automation.runs.list'>>('automation.runs.list');
    return { text: formatAutomationRuns(data), data };
  }

  async getSchedules(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'schedules.list'>>('schedules.list');
    return { text: formatSchedules(data), data };
  }

  async getAutomationHeartbeat(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'automation.heartbeat.list'>>('automation.heartbeat.list');
    return { text: formatHeartbeat(data), data };
  }

  async getSchedulerCapacity(): Promise<AssistantReply> {
    const data = await this.client.invoke<OperatorMethodOutput<'scheduler.capacity'>>('scheduler.capacity');
    return { text: formatCapacity(data), data };
  }

  async delegateBuildTask(request: {
    readonly task: string;
    readonly wrfc?: boolean | undefined;
    readonly sessionId?: string | undefined;
    readonly title?: string | undefined;
    readonly reason?: string | undefined;
  }): Promise<DelegationResult> {
    if (!request.task.trim()) throw new Error('Delegation task cannot be empty.');
    const result = await delegateToTui(this.client, this.options.config, request);
    this.delegations.save(result.receipt);
    return result;
  }

  async getDelegations(selector?: string | undefined): Promise<AssistantReply> {
    const data = await loadDelegationStatusSnapshot(this.client, this.options.config, this.delegations, selector);
    return { text: formatDelegationStatus(data), data };
  }

  private async handleSlash(command: string): Promise<AssistantReply> {
    const [name = '', ...args] = command.slice(1).split(/\s+/);
    const rest = args.join(' ').trim();
    switch (name) {
      case 'help':
        return { text: slashHelp() };
      case 'status':
        return { text: formatDaemonDiagnostics(await this.client.diagnostics()) };
      case 'policy':
        return { text: formatPolicy(evaluateActionPolicy(rest)), data: evaluateActionPolicy(rest) };
      case 'ask':
        return this.askKnowledge(rest);
      case 'search':
        return this.searchKnowledge(rest);
      case 'remember': {
        const record = this.memory.remember({ summary: rest, source: 'user-command', provenance: [{ kind: 'user', id: 'slash-remember' }] });
        return { text: `Remembered ${record.id}: ${record.summary}`, data: record };
      }
      case 'memory':
        return { text: formatMemory(rest ? this.memory.search(rest) : this.memory.list()) };
      case 'skills':
        return this.handleSkillsSlash(args);
      case 'personas':
        return this.handlePersonasSlash(args);
      case 'delegate': {
        const wrfc = args.includes('--wrfc');
        const task = args.filter((arg) => arg !== '--wrfc').join(' ').trim();
        if (!task) return { text: 'Delegation task cannot be empty.' };
        const result = await this.delegateBuildTask({ task, wrfc, reason: 'slash-command' });
        return { text: formatDelegationReceipt(result.receipt), data: result };
      }
      case 'delegations': {
        return this.getDelegations(rest);
      }
      case 'approvals':
        return this.getApprovals();
      case 'workplan':
        return this.getWorkPlan();
      case 'automation':
        return this.handleAutomationSlash(args);
      case 'schedules':
        return this.getSchedules();
      default:
        return { text: `Unknown command: /${name}\n\n${slashHelp()}` };
    }
  }

  activeProfile(): {
    readonly state: AssistantProfileState;
    readonly persona: PersonaRecord;
    readonly skills: readonly SkillRecord[];
  } {
    const state = this.profile.current();
    return {
      state,
      persona: this.resolveActivePersona(state),
      skills: this.resolveActiveSkills(state),
    };
  }

  private resolveActivePersona(profile: AssistantProfileState): PersonaRecord {
    return this.personas.find(profile.activePersona)
      ?? this.personas.find('operator')
      ?? this.personas.list()[0]
      ?? fallbackPersona();
  }

  private resolveActiveSkills(profile: AssistantProfileState): readonly SkillRecord[] {
    return profile.activeSkills
      .map((idOrName) => this.skills.find(idOrName))
      .filter((skill): skill is SkillRecord => skill !== null);
  }

  private handleSkillsSlash(args: readonly string[]): AssistantReply {
    const [action = '', selector = '', ...rest] = args;
    if (action === 'active') {
      const active = this.activeProfile();
      return { text: formatActiveSkills(active.skills), data: active };
    }
    if (action === 'enable' || action === 'disable' || action === 'review' || action === 'stale') {
      const skill = this.skills.find(selector);
      if (!skill) return { text: `No skill found for ${selector || '(empty)'}.` };
      if (action === 'enable') {
        const profile = this.profile.enableSkill(skill.id);
        return { text: `Enabled skill ${skill.name}.`, data: { profile, skill } };
      }
      if (action === 'disable') {
        const profile = this.profile.disableSkill(skill.id);
        return { text: `Disabled skill ${skill.name}.`, data: { profile, skill } };
      }
      const updated = this.skills.update(skill.id, {
        reviewState: action === 'review' ? 'reviewed' : 'stale',
        reviewedBy: action === 'review' ? 'goodvibes-agent-tui' : undefined,
      });
      return { text: `${action === 'review' ? 'Reviewed' : 'Marked stale'} skill ${updated.name}.`, data: updated };
    }
    const query = [action, selector, ...rest].join(' ').trim();
    return { text: formatSkills(query ? this.skills.search(query) : this.skills.list()) };
  }

  private handlePersonasSlash(args: readonly string[]): AssistantReply {
    const [action = '', selector = '', ...rest] = args;
    if (action === 'active') {
      const active = this.activeProfile();
      return { text: `Active persona: ${active.persona.name}\n${active.persona.description || active.persona.title}`, data: active };
    }
    if (action === 'use' || action === 'review' || action === 'stale') {
      const persona = this.personas.find(selector);
      if (!persona) return { text: `No persona found for ${selector || '(empty)'}.` };
      if (action === 'use') {
        const profile = this.profile.setActivePersona(persona.id);
        return { text: `Using persona ${persona.name}.`, data: { profile, persona } };
      }
      const updated = this.personas.update(persona.id, {
        reviewState: action === 'review' ? 'reviewed' : 'stale',
        reviewedBy: action === 'review' ? 'goodvibes-agent-tui' : undefined,
      });
      return { text: `${action === 'review' ? 'Reviewed' : 'Marked stale'} persona ${updated.name}.`, data: updated };
    }
    const query = [action, selector, ...rest].join(' ').trim();
    return { text: formatPersonas(query ? this.personas.search(query) : this.personas.list()) };
  }

  private async handleAutomationSlash(args: readonly string[]): Promise<AssistantReply> {
    const [action = 'snapshot'] = args;
    switch (action) {
      case '':
      case 'snapshot':
      case 'status':
        return this.getAutomationSnapshot();
      case 'jobs':
        return this.getAutomationJobs();
      case 'runs':
        return this.getAutomationRuns();
      case 'schedules':
        return this.getSchedules();
      case 'heartbeat':
        return this.getAutomationHeartbeat();
      case 'capacity':
        return this.getSchedulerCapacity();
      default:
        return { text: 'Unknown automation view. Use snapshot, jobs, runs, schedules, heartbeat, or capacity.' };
    }
  }
}

function formatMemory(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return 'No matching memory records.';
  return records.map((record) => (
    `${record.id} [${record.cls}/${record.reviewState}/${record.sensitivity}] ${record.summary}`
  )).join('\n');
}

function formatSkills(records: readonly SkillRecord[]): string {
  if (records.length === 0) return 'No matching skills.';
  return records.map((record) => (
    `${record.id} [${record.reviewState}] ${record.name}: ${record.description || record.title}`
  )).join('\n');
}

function formatActiveSkills(records: readonly SkillRecord[]): string {
  if (records.length === 0) return 'No active skills.';
  return [
    'Active skills:',
    ...records.map((record) => `- ${record.name} [${record.reviewState}]: ${record.description || record.title}`),
  ].join('\n');
}

function formatPersonas(records: readonly PersonaRecord[]): string {
  if (records.length === 0) return 'No personas.';
  return records.map((record) => (
    `${record.id} [${record.reviewState}] ${record.name}: ${record.description || record.title}`
  )).join('\n');
}

function fallbackPersona(): PersonaRecord {
  const now = Date.now();
  return {
    id: 'persona_operator_fallback',
    name: 'operator',
    title: 'Operator',
    description: 'Fallback proactive serial assistant/operator.',
    body: 'Act as a proactive serial GoodVibes assistant. Make ordinary safe progress, use knowledge and memory, and delegate explicit build work to GoodVibes TUI.',
    tags: ['fallback', 'operator'],
    source: 'built-in',
    provenance: ['goodvibes-agent'],
    reviewState: 'reviewed',
    createdAt: now,
    updatedAt: now,
    reviewedAt: now,
    reviewedBy: 'goodvibes-agent',
  };
}

function formatPolicy(policy: ReturnType<typeof evaluateActionPolicy>): string {
  return [
    `Policy: ${policy.category} (${policy.risk})`,
    `Approval required: ${policy.requiresApproval ? 'yes' : 'no'}`,
    `Automatic action: ${policy.allowedAutomatically ? 'yes' : 'no'}`,
    policy.reason,
  ].join('\n');
}

function slashHelp(): string {
  return [
    'Commands:',
    '/status                 Check daemon status',
    '/policy <text>          Explain safe-action policy for a request',
    '/ask <query>            Ask GoodVibes knowledge',
    '/search <query>         Search GoodVibes knowledge',
    '/remember <fact>        Store durable assistant memory',
    '/memory [query]         List/search assistant memory',
    '/skills [query]         List/search assistant skills; active|enable|disable|review|stale',
    '/personas               List assistant personas; active|use|review|stale',
    '/delegate [--wrfc] <t>  Delegate build/fix/review work to GoodVibes TUI',
    '/delegations [id]       Show delegated build receipts and status',
    '/approvals              List daemon approvals',
    '/workplan               Show project work-plan snapshot',
    '/automation [view]      Show read-only automation status',
    '/schedules              Show read-only schedules status',
  ].join('\n');
}
