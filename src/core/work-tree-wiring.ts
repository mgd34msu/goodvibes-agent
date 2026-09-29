/**
 * work-tree-wiring.ts, connecting the conversation work tree to the live
 * runtime: the timing store fed by tool and turn events, agent lanes read
 * from the agent manager (WRFC chains from the chain controller, cost from
 * the fleet read model), the call a permission prompt is holding, and the
 * per-session fold state.
 *
 * One call from main.ts; everything the work tree reads at render time goes
 * through the WorkTreeSources this installs.
 *
 * Fold restore: the Agent reaches a session through several paths (the
 * /session resume command, the startup resume handler, the session picker),
 * so rather than hooking each one, syncSession() (called once per frame)
 * restores a session's saved folds the first frame after the runtime session
 * id changes.
 */

import type { AgentManager } from '@pellux/goodvibes-sdk/platform/tools';
import type { WrfcChain } from '@pellux/goodvibes-sdk/platform/agents';
import type { ProcessNode } from '@pellux/goodvibes-sdk/platform/runtime/fleet';
import type { ConversationMessageSnapshot } from '@pellux/goodvibes-sdk/platform/core';
import type { UiRuntimeEvents } from '@/runtime/index.ts';
import type { ConversationManager } from './conversation.ts';
import { WorkTreeTimingStore, type AgentLaneInfo, type WrfcPhaseInfo } from './work-tree-sources.ts';
import { loadWorkTreeFolds, saveWorkTreeFolds, sweepOrphanWorkTreeFolds } from './work-tree-fold-store.ts';
import { onSemanticSummaryReady } from '../renderer/lane-graph/semantic-memo.ts';

type AgentRecord = ReturnType<AgentManager['list']>[number];

export interface WorkTreeWiringDeps {
  readonly conversation: ConversationManager;
  readonly events: UiRuntimeEvents;
  readonly agentManager: Pick<AgentManager, 'getStatus' | 'getConversationSnapshot'>;
  readonly listChains: () => readonly WrfcChain[];
  readonly fleetNodes: () => readonly ProcessNode[];
  /** The call id a permission prompt is holding, if any. */
  readonly pendingCallId: () => string | undefined;
  readonly turnActive: () => boolean;
  readonly sessionsDir: string;
  readonly sessionId: () => string;
  /** Repaint (a ◈ summary of an opened edit landed). */
  readonly requestRender: () => void;
}

function firstLines(text: string | undefined, n: number): string | undefined {
  if (!text) return undefined;
  const lines = text.split('\n').filter((l) => l.trim().length > 0).slice(0, n);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/** A finished agent's transcript never changes: read it once. */
interface SnapshotMemo { readonly stamp: string; readonly messages: readonly ConversationMessageSnapshot[] }

export interface WorkTreeWiring {
  readonly timings: WorkTreeTimingStore;
  readonly unsubs: Array<() => void>;
  /** Restore the saved folds of a session the runtime just switched to (call once per frame). */
  readonly syncSession: () => void;
}

export function wireWorkTree(deps: WorkTreeWiringDeps): WorkTreeWiring {
  const timings = new WorkTreeTimingStore();
  const unsubs: Array<() => void> = [];
  const { conversation, events } = deps;

  unsubs.push(events.tools.on('TOOL_EXECUTING', (ev) => timings.callStarted(ev.callId, ev.startedAt)));
  unsubs.push(events.tools.on('TOOL_SUCCEEDED', (ev) => timings.callSettled(ev.callId, ev.durationMs, Date.now())));
  unsubs.push(events.tools.on('TOOL_FAILED', (ev) => timings.callSettled(ev.callId, ev.durationMs, Date.now())));
  unsubs.push(events.tools.on('TOOL_CANCELLED', (ev) => timings.callSettled(ev.callId, undefined, Date.now())));
  unsubs.push(events.turns.on('TURN_SUBMITTED', () => {
    const snapshot = conversation.getMessageSnapshot();
    for (let i = snapshot.length - 1; i >= 0; i--) {
      if (snapshot[i]!.role === 'user') { timings.turnStarted(i, Date.now()); break; }
    }
  }));
  for (const end of ['TURN_COMPLETED', 'TURN_ERROR', 'TURN_CANCEL'] as const) {
    unsubs.push(events.turns.on(end, () => timings.turnEnded(Date.now())));
  }

  const snapshots = new Map<string, SnapshotMemo>();
  const messagesOf = (record: AgentRecord): readonly ConversationMessageSnapshot[] => {
    const finished = record.status !== 'running' && record.status !== 'pending';
    const stamp = `${record.status}:${record.completedAt ?? ''}:${record.toolCallCount}`;
    const memo = snapshots.get(record.id);
    if (finished && memo && memo.stamp === stamp) return memo.messages;
    const messages = deps.agentManager.getConversationSnapshot(record.id);
    if (finished) snapshots.set(record.id, { stamp, messages });
    return messages;
  };

  const costOf = (agentId: string): number | undefined => {
    const node = deps.fleetNodes().find((n) => n.id === agentId);
    // Only a real reading: an unpriced node has no cost to state.
    return node && node.costState !== 'unpriced' && typeof node.costUsd === 'number' ? node.costUsd : undefined;
  };

  const wrfcPhases = (record: AgentRecord): { phases: WrfcPhaseInfo[]; passed: boolean | undefined } | undefined => {
    const chain = deps.listChains().find((c) => c.ownerAgentId === record.id || (c.engineerAgentId === record.id && c.ownerAgentId === c.engineerAgentId));
    if (!chain) return undefined;
    const phases: WrfcPhaseInfo[] = [];
    for (const id of chain.allAgentIds) {
      if (id === chain.ownerAgentId && id !== chain.engineerAgentId) continue;
      const phase = deps.agentManager.getStatus(id);
      if (!phase) continue;
      const role = (phase.wrfcRole ?? (id === chain.engineerAgentId ? 'engineer' : id === chain.reviewerAgentId ? 'reviewer' : id === chain.fixerAgentId ? 'fixer' : 'engineer')) as WrfcPhaseInfo['role'];
      const latestReview = role === 'reviewer' && id === chain.reviewerAgentId ? chain.reviewerReport : undefined;
      phases.push({
        agentId: id,
        role,
        task: phase.task,
        status: phase.status,
        startedAt: phase.startedAt,
        completedAt: phase.completedAt,
        findings: latestReview?.issues.map((issue) => issue.description),
        passed: latestReview ? (chain.lastReviewVerdict?.passed ?? latestReview.passed) : undefined,
        output: firstLines(phase.fullOutput, 6),
      });
    }
    phases.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const passed = chain.state === 'passed' ? true : chain.state === 'failed' ? false : undefined;
    return { phases, passed };
  };

  const agent = (agentId: string): AgentLaneInfo | null => {
    const record = deps.agentManager.getStatus(agentId);
    if (!record) return null;
    const wrfc = wrfcPhases(record);
    return {
      id: record.id,
      name: record.template,
      task: record.task,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      toolCallCount: record.toolCallCount,
      costUsd: costOf(record.id),
      error: record.error,
      messages: wrfc ? [] : messagesOf(record),
      wrfcPhases: wrfc?.phases,
      wrfcPassed: wrfc?.passed,
    };
  };

  conversation.setWorkTreeSources({
    callTiming: (callId) => timings.callTiming(callId),
    turnTiming: (index) => timings.turnTiming(index),
    agent,
    waitingCallIds: () => {
      const id = deps.pendingCallId();
      return id ? new Set([id]) : new Set<string>();
    },
    turnActive: deps.turnActive,
    now: () => Date.now(),
  });

  // Fold decisions persist per session, beside the session file.
  conversation.workTree.onFoldChange(() => saveWorkTreeFolds(deps.sessionsDir, deps.sessionId(), conversation.workTree.foldState()));
  sweepOrphanWorkTreeFolds(deps.sessionsDir);
  unsubs.push(onSemanticSummaryReady(() => { conversation.workTree.invalidate(); deps.requestRender(); }));
  // Starts unset so the first frame restores the session the app started on.
  let syncedSession: string | undefined;
  const syncSession = (): void => {
    const current = deps.sessionId();
    if (current === syncedSession) return;
    syncedSession = current;
    restoreWorkTreeFolds(conversation, deps.sessionsDir, current);
  };
  return { timings, unsubs, syncSession };
}

/** Restore a resumed session's fold decisions (called by the resume routine). */
export function restoreWorkTreeFolds(conversation: ConversationManager, sessionsDir: string, sessionId: string): number {
  const entries = loadWorkTreeFolds(sessionsDir, sessionId);
  conversation.workTree.restoreFoldState(entries);
  return entries.length;
}
