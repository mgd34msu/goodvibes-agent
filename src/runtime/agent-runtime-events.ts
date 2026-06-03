import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { ConversationFollowUpItem } from '@pellux/goodvibes-sdk/platform/core';
import type { AgentManager } from '@pellux/goodvibes-sdk/platform/tools';
import type {
  AgentEvent,
  ProviderEvent,
  RuntimeEventBus,
} from '@/runtime/index.ts';
import type { createDomainDispatch } from './store/index.ts';

const AGENT_STATUS_INTERVAL_MS = 30_000;

export interface AgentRuntimeMessageRouter {
  low(message: string): void;
  high(message: string): void;
}

export interface AgentRuntimeEventBridgeOptions {
  readonly runtimeBus: RuntimeEventBus;
  readonly domainDispatch: ReturnType<typeof createDomainDispatch>;
  readonly getSystemMessageRouter: () => AgentRuntimeMessageRouter | null;
  readonly queueConversationFollowUp?: (item: ConversationFollowUpItem) => void;
  readonly requestRender: () => void;
  readonly configManager: ConfigManager;
  readonly agentManager: AgentManager;
}

function withRouter(
  getSystemMessageRouter: () => AgentRuntimeMessageRouter | null,
  action: (router: AgentRuntimeMessageRouter) => void,
): void {
  const router = getSystemMessageRouter();
  if (router) action(router);
}

function formatAgentTask(task: string): string {
  return task.length > 50 ? `${task.slice(0, 50)}...` : task;
}

export function registerAgentRuntimeEvents(options: AgentRuntimeEventBridgeOptions): {
  unsubs: Array<() => void>;
  agentStatusIntervalRef: { value: ReturnType<typeof setInterval> | null };
} {
  const {
    runtimeBus,
    domainDispatch,
    getSystemMessageRouter,
    queueConversationFollowUp,
    requestRender,
    agentManager,
  } = options;
  const unsubs: Array<() => void> = [];

  unsubs.push(runtimeBus.onDomain('turn', (env) => {
    domainDispatch.dispatchTurnEvent(env.payload);
  }));
  unsubs.push(runtimeBus.onDomain('agents', (env) => {
    domainDispatch.dispatchAgentEvent(env.payload);
  }));
  unsubs.push(runtimeBus.onDomain('orchestration', (env) => {
    domainDispatch.dispatchOrchestrationEvent(env.payload);
  }));
  unsubs.push(runtimeBus.onDomain('communication', (env) => {
    domainDispatch.dispatchCommunicationEvent(env.payload);
  }));
  unsubs.push(runtimeBus.onDomain('compaction', (env) => {
    domainDispatch.dispatchCompactionEvent(env.payload);
  }));
  unsubs.push(runtimeBus.onDomain('transport', (env) => {
    domainDispatch.dispatchTransportEvent(env.payload);
  }));

  unsubs.push(runtimeBus.on<Extract<ProviderEvent, { type: 'MODEL_FALLBACK' }>>('MODEL_FALLBACK', ({ payload }) => {
    withRouter(getSystemMessageRouter, (router) => {
      router.high(`[Model] ${payload.from} exhausted across all providers. Automatically falling back to ${payload.to} via ${payload.provider}.`);
    });
    requestRender();
  }));
  unsubs.push(runtimeBus.on<Extract<AgentEvent, { type: 'AGENT_STREAM_DELTA' }>>('AGENT_STREAM_DELTA', () => {
    requestRender();
  }));
  unsubs.push(runtimeBus.on<Extract<AgentEvent, { type: 'AGENT_PROGRESS' }>>('AGENT_PROGRESS', () => {
    requestRender();
  }));
  unsubs.push(runtimeBus.on<Extract<AgentEvent, { type: 'AGENT_COMPLETED' }>>('AGENT_COMPLETED', ({ payload }) => {
    const record = agentManager.getStatus(payload.agentId);
    if (record) {
      const durationSeconds = record.completedAt !== undefined ? Math.round((record.completedAt - record.startedAt) / 1000) : 0;
      const taskSnippet = formatAgentTask(record.task);
      withRouter(getSystemMessageRouter, (router) => {
        router.low(`[Delegated task] ${record.template} ${payload.agentId.slice(-8)} completed in ${durationSeconds}s "${taskSnippet}"`);
      });
      queueConversationFollowUp?.({
        key: `agent:${payload.agentId}:completed`,
        summary: `${record.template} delegated task ${payload.agentId.slice(-8)} completed "${taskSnippet}" in ${durationSeconds}s after ${record.toolCallCount} tool calls.`,
      });
    }
    requestRender();
  }));
  unsubs.push(runtimeBus.on<Extract<AgentEvent, { type: 'AGENT_FAILED' }>>('AGENT_FAILED', ({ payload }) => {
    const record = agentManager.getStatus(payload.agentId);
    if (record && record.status !== 'cancelled') {
      const durationSeconds = record.completedAt !== undefined ? Math.round((record.completedAt - record.startedAt) / 1000) : 0;
      const taskSnippet = formatAgentTask(record.task);
      withRouter(getSystemMessageRouter, (router) => {
        router.low(`[Delegated task] ${record.template} ${payload.agentId.slice(-8)} failed in ${durationSeconds}s ${payload.error.slice(0, 80)}`);
      });
      queueConversationFollowUp?.({
        key: `agent:${payload.agentId}:failed`,
        summary: `${record.template} delegated task ${payload.agentId.slice(-8)} failed while working on "${taskSnippet}" ${payload.error.slice(0, 120)}`,
      });
    }
    requestRender();
  }));

  const agentStatusIntervalRef = { value: null as ReturnType<typeof setInterval> | null };
  agentStatusIntervalRef.value = setInterval(() => {
    const running = agentManager.list().filter((agent) => agent.status === 'running');
    if (running.length === 0) return;
    const lines = running.map((agent) => `  ${agent.id.slice(-8)} ${agent.progress ?? agent.status}`);
    withRouter(getSystemMessageRouter, (router) => {
      router.low(`[Delegated task] ${running.length} running\n${lines.join('\n')}`);
    });
    requestRender();
  }, AGENT_STATUS_INTERVAL_MS);
  agentStatusIntervalRef.value.unref?.();

  return { unsubs, agentStatusIntervalRef };
}
