import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { createShellPathService } from '@/runtime/index.ts';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerQrcodeRuntimeCommands } from '../../input/commands/qrcode-runtime.ts';

function makeContext(out: string[], root: string): CommandContext {
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    workingDir: root,
    homeDir: root,
    configDir: join(root, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT),
  });
  return {
    print: (text: string) => { out.push(text); },
    platform: { configManager },
    workspace: {
      shellPaths: createShellPathService({
        workingDirectory: root,
        homeDirectory: root,
        surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
      }),
    },
  } as unknown as CommandContext;
}

describe('qrcode runtime command', () => {
  test('prints companion pairing details and QR text instead of opening a panel', async () => {
    const registry = new CommandRegistry();
    registerQrcodeRuntimeCommands(registry);
    const command = registry.get('qrcode');
    expect(command).toBeDefined();
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-qrcode-'));
    const tokenDir = join(root, '.goodvibes', 'daemon');
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(join(tokenDir, 'operator-tokens.json'), JSON.stringify({ token: 'existing-connected-host-token' }));
    const out: string[] = [];

    await command!.handler([], makeContext(out, root));

    const text = out.join('\n');
    expect(text).toContain('goodvibes-agent');
    expect(text).toContain('http://127.0.0.1:3421');
    expect(text).not.toContain('QR code panel');
  });

  test('does not create connected-host auth tokens when pairing token is missing', async () => {
    const registry = new CommandRegistry();
    registerQrcodeRuntimeCommands(registry);
    const command = registry.get('qrcode');
    expect(command).toBeDefined();
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-qrcode-missing-'));
    const out: string[] = [];

    await command!.handler([], makeContext(out, root));

    const text = out.join('\n');
    expect(text).toContain('Connected-host operator token is required.');
    expect(text).toContain('Agent does not create or rotate connected-host auth tokens.');
    expect(text).not.toContain('existing-connected-host-token');
  });
});
