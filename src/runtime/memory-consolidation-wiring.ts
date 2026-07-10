import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import {
  resolveMemoryConsolidationConfig,
  runMemoryConsolidation,
  type MemoryRegistry,
  type MemoryConsolidationUsageLookup,
} from '@pellux/goodvibes-sdk/platform/state';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { ShellPathService } from '@/runtime/index.ts';
import { MemoryConsolidationReceiptStore } from '../agent/memory-consolidation-receipts.ts';
import { MemoryConsolidationScheduler } from './memory-consolidation-scheduler.ts';

/**
 * Assemble the idle-time memory consolidation scheduler from its runtime deps.
 * Kept out of bootstrap so the run callback (config read → run → persist receipt)
 * lives next to the rest of the consolidation module rather than inline in the
 * boot sequence.
 */
export interface MemoryConsolidationWiringInput {
  readonly configManager: Pick<ConfigManager, 'getRaw'>;
  readonly memoryRegistry: MemoryRegistry;
  readonly shellPaths: ShellPathService;
  /** Real-state idleness: no turn in flight. */
  readonly isIdle: () => boolean;
  /** Optional usage instrumentation so never-referenced records decay first. */
  readonly usageLookup?: MemoryConsolidationUsageLookup;
}

export function createMemoryConsolidationScheduler(input: MemoryConsolidationWiringInput): MemoryConsolidationScheduler {
  const receipts = new MemoryConsolidationReceiptStore(input.shellPaths);
  return new MemoryConsolidationScheduler({
    isEnabled: () => resolveMemoryConsolidationConfig(input.configManager).enabled,
    isIdle: input.isIdle,
    minIntervalMs: () => resolveMemoryConsolidationConfig(input.configManager).intervalMs,
    now: () => Date.now(),
    run: (trigger) => {
      try {
        const config = resolveMemoryConsolidationConfig(input.configManager);
        if (!config.enabled) return null;
        const receipt = runMemoryConsolidation({
          memoryRegistry: input.memoryRegistry,
          config,
          now: Date.now(),
          trigger,
          idle: input.isIdle(),
          ...(input.usageLookup ? { usageLookup: input.usageLookup } : {}),
        });
        receipts.record(receipt);
        return receipt;
      } catch (error) {
        logger.debug('Idle memory consolidation run failed', { error: summarizeError(error) });
        return null;
      }
    },
  });
}
