import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { JsonStore } from './json-store.js';

export interface DelegationReceipt {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly task: string;
  readonly summary: string;
  readonly requestedWrfc: boolean;
  readonly mode: string;
  readonly sessionId: string;
  readonly surfaceKind: string;
  readonly surfaceId: string;
  readonly checkCommand: string;
  readonly reason?: string | undefined;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly messageId?: string | undefined;
}

export interface DelegationReceiptInput {
  readonly task: string;
  readonly summary: string;
  readonly requestedWrfc: boolean;
  readonly mode: string;
  readonly sessionId: string;
  readonly surfaceKind: string;
  readonly surfaceId: string;
  readonly reason?: string | undefined;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly messageId?: string | undefined;
}

export interface DelegationReceiptState {
  readonly receipts: readonly DelegationReceipt[];
}

const MAX_RECEIPTS = 200;

export class DelegationReceiptStore {
  private readonly store: JsonStore<DelegationReceiptState>;

  constructor(path = join(agentHomeDir(), 'delegations.json')) {
    this.store = new JsonStore(path, { receipts: [] });
  }

  list(limit = 25): readonly DelegationReceipt[] {
    return this.store.read().receipts.slice(0, limit);
  }

  find(selector: string): DelegationReceipt | null {
    const normalized = selector.trim();
    if (!normalized) return null;
    return this.store.read().receipts.find((receipt) => (
      receipt.id === normalized
      || receipt.sessionId === normalized
      || receipt.agentId === normalized
      || receipt.taskId === normalized
      || receipt.messageId === normalized
    )) ?? null;
  }

  record(input: DelegationReceiptInput): DelegationReceipt {
    const now = Date.now();
    const id = createId('del');
    const receipt: DelegationReceipt = {
      id,
      createdAt: now,
      updatedAt: now,
      task: input.task,
      summary: input.summary,
      requestedWrfc: input.requestedWrfc,
      mode: input.mode,
      sessionId: input.sessionId,
      surfaceKind: input.surfaceKind,
      surfaceId: input.surfaceId,
      checkCommand: '',
      reason: input.reason,
      agentId: input.agentId,
      taskId: input.taskId,
      messageId: input.messageId,
    };
    return this.save({ ...receipt, checkCommand: `goodvibes-agent delegations status ${id}` });
  }

  save(receipt: DelegationReceipt): DelegationReceipt {
    this.store.update((state) => ({
      receipts: [
        receipt,
        ...state.receipts.filter((existing) => existing.id !== receipt.id),
      ].slice(0, MAX_RECEIPTS),
    }));
    return receipt;
  }
}
