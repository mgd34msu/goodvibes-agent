import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import type { MemoryConsolidationRunReceipt } from '@pellux/goodvibes-sdk/platform/state';

/**
 * Durable, capped store of idle-consolidation run receipts. Same visible-receipt
 * idiom as the prompt-context and per-phase consolidation receipts: an atomic
 * JSON file under the Agent surface root, newest first, so every autonomous run
 * leaves a record of what it merged, archived, decayed, and proposed.
 */
const RUN_RECEIPT_LIMIT = 50;

export interface MemoryConsolidationReceiptFile {
  readonly version: 1;
  readonly receipts: readonly MemoryConsolidationRunReceipt[];
}

export function memoryConsolidationReceiptPath(shellPaths: ShellPathService): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'learning', 'consolidation-run-receipts.json');
}

function isRunReceipt(value: unknown): value is MemoryConsolidationRunReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.runId === 'string'
    && typeof record.ranAt === 'string'
    && Array.isArray(record.merged)
    && Array.isArray(record.archived)
    && Array.isArray(record.decayed)
    && Array.isArray(record.proposed);
}

export class MemoryConsolidationReceiptStore {
  public constructor(
    private readonly shellPaths: ShellPathService,
    private readonly limit = RUN_RECEIPT_LIMIT,
  ) {}

  public path(): string {
    return memoryConsolidationReceiptPath(this.shellPaths);
  }

  public read(): readonly MemoryConsolidationRunReceipt[] {
    const path = this.path();
    if (!existsSync(path)) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      const receipts = (parsed as Record<string, unknown>).receipts;
      if (!Array.isArray(receipts)) return [];
      return receipts.filter(isRunReceipt);
    } catch {
      return [];
    }
  }

  public list(limit = 20): readonly MemoryConsolidationRunReceipt[] {
    return this.read().slice(0, Math.max(1, Math.min(this.limit, Math.trunc(limit))));
  }

  public latest(): MemoryConsolidationRunReceipt | null {
    return this.read()[0] ?? null;
  }

  public record(receipt: MemoryConsolidationRunReceipt): MemoryConsolidationRunReceipt {
    const path = this.path();
    const next: MemoryConsolidationReceiptFile = {
      version: 1,
      receipts: [receipt, ...this.read()].slice(0, this.limit),
    };
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    renameSync(tmpPath, path);
    return receipt;
  }
}
