import type { AgentConfig } from '../config.js';
import { GoodVibesDaemonClient } from '../daemon/client.js';
import type { MemoryRecord } from '../store/memory.js';
import type { PersonaRecord } from '../store/personas.js';
import type { SkillRecord } from '../store/skills.js';
import { MemoryStore } from '../store/memory.js';
import { PersonaStore } from '../store/personas.js';
import { SkillStore } from '../store/skills.js';
import { formatJson } from '../utils/format.js';
import { classifyPrompt } from './policy.js';
import { buildAssistantSystemPrompt } from './system-prompt.js';
import { delegateToTui, shouldDelegateToTui, shouldRequestWrfc } from './delegation.js';
import { CompanionChatCoordinator, type CompanionChatStatus, type CompanionChatTurnResult } from './companion-chat.js';
import { resolveProviderModel, type ProviderModelSelection } from './provider-model.js';

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

    const captured = this.options.config.autoRemember
      ? this.memory.autoCaptureFromUserText(trimmed)
      : null;

    const safety = classifyPrompt(trimmed);
    if (safety.requiresApproval) {
      return {
        text: `I need approval before doing that. Reason: ${safety.reason}`,
        data: safety,
      };
    }

    if (this.options.config.autoDelegateBuildRequests && shouldDelegateToTui(trimmed)) {
      const result = await delegateToTui(this.client, this.options.config, {
        task: trimmed,
        wrfc: shouldRequestWrfc(trimmed),
        reason: 'auto-build-delegation',
      });
      return {
        text: `Delegated to GoodVibes TUI (${result.mode})${result.sessionId ? ` in session ${result.sessionId}` : ''}.`,
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
    const persona = this.personas.find('operator') ?? this.personas.list()[0]!;
    const memories = this.memory.search(text, 8);
    return this.companionChat.send(text, buildAssistantSystemPrompt({ persona, memories }));
  }

  async askKnowledge(query: string): Promise<AssistantReply> {
    const data = await this.client.invoke('knowledge.ask', {
      query,
      includeSources: true,
      includeConfidence: true,
      metadata: { originProduct: 'goodvibes-agent' },
    });
    return { text: summarizeKnowledgeAnswer(data), data };
  }

  async searchKnowledge(query: string): Promise<AssistantReply> {
    const data = await this.client.invoke('knowledge.search', {
      query,
      limit: 12,
      includeSources: true,
      includeNodes: true,
      metadata: { originProduct: 'goodvibes-agent' },
    });
    return { text: formatJson(data), data };
  }

  private async handleSlash(command: string): Promise<AssistantReply> {
    const [name = '', ...args] = command.slice(1).split(/\s+/);
    const rest = args.join(' ').trim();
    switch (name) {
      case 'help':
        return { text: slashHelp() };
      case 'status':
        return { text: formatJson(await this.client.diagnostics()) };
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
        return { text: formatSkills(rest ? this.skills.search(rest) : this.skills.list()) };
      case 'personas':
        return { text: formatPersonas(this.personas.list()) };
      case 'delegate': {
        const wrfc = args.includes('--wrfc');
        const task = args.filter((arg) => arg !== '--wrfc').join(' ').trim();
        const result = await delegateToTui(this.client, this.options.config, { task, wrfc, reason: 'slash-command' });
        return { text: `Delegated to GoodVibes TUI (${result.mode}).`, data: result };
      }
      case 'approvals':
        return { text: formatJson(await this.client.invoke('approvals.list')) };
      case 'workplan':
        return { text: formatJson(await this.client.invoke('projectPlanning.workPlan.snapshot')) };
      default:
        return { text: `Unknown command: /${name}\n\n${slashHelp()}` };
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

function formatPersonas(records: readonly PersonaRecord[]): string {
  if (records.length === 0) return 'No personas.';
  return records.map((record) => (
    `${record.id} [${record.reviewState}] ${record.name}: ${record.description || record.title}`
  )).join('\n');
}

function summarizeKnowledgeAnswer(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['answer', 'text', 'summary', 'response']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key];
    }
  }
  return formatJson(data);
}

function slashHelp(): string {
  return [
    'Commands:',
    '/status                 Check daemon status',
    '/ask <query>            Ask GoodVibes knowledge',
    '/search <query>         Search GoodVibes knowledge',
    '/remember <fact>        Store durable assistant memory',
    '/memory [query]         List/search assistant memory',
    '/skills [query]         List/search assistant skills',
    '/personas               List assistant personas',
    '/delegate [--wrfc] <t>  Delegate build/fix/review work to GoodVibes TUI',
    '/approvals              List daemon approvals',
    '/workplan               Show project work-plan snapshot',
  ].join('\n');
}
