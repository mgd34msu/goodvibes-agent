import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { MemoryPanel } from '../../panels/memory-panel.ts';
import type { Line } from '../../types/grid.ts';

function linesText(lines: Line[]): string {
  return lines
    .map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd())
    .filter(Boolean)
    .join('\n');
}

describe('MemoryPanel', () => {
  let dir: string;
  let store: MemoryStore;
  let registry: MemoryRegistry;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gv-memory-panel-'));
    const configManager = new ConfigManager({ surfaceRoot: 'agent', configDir: join(dir, '.goodvibes', 'agent'), workingDir: dir });
    store = new MemoryStore(join(dir, 'memory.sqlite'), {
      embeddingRegistry: new MemoryEmbeddingProviderRegistry({ configManager }),
    });
    await store.init();
    registry = new MemoryRegistry(store);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('renders visible Agent memory commands in the empty state', () => {
    const panel = new MemoryPanel(registry);
    const text = linesText(panel.render(120, 16));

    expect(text).toContain('Memory');
    expect(text).toContain('/memory add <class> <summary>');
    expect(text).toContain('/memory add fact <summary>');
    expect(text).toContain('/memory capture incident latest');
    expect(text).toContain('/memory review');
    expect(text).not.toContain('/recall');
  });
});
