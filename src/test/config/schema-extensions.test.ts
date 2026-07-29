import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { DEFAULT_CONFIG } from '@pellux/goodvibes-sdk/platform/config';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = makeProjectTempDir(`gv-cfg-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return dir;
}

function createConfigManager(workingDir: string): ConfigManager {
  return new ConfigManager({ surfaceRoot: 'tui',
    workingDir,
    homeDir: workingDir,
    configDir: join(workingDir, '.goodvibes', 'global-tui'),
  });
}

// fleet.maxSize (schema-domain-fleet.ts, the orchestration.maxActiveAgents
// rename) is a first-class member of the published ConfigKey union since sdk
// 89690d07 completed the union (with a drift gate so a new domain can never
// fall out of it again) — the ConfigKey cast workaround this file carried
// while the union lagged the runtime schema is deleted: get/set below use
// the plain key string, cast-free. These thin helpers remain only to keep
// the many call sites short.
function getFleetMaxSize(mgr: ConfigManager): number {
  return mgr.get('fleet.maxSize');
}
function setFleetMaxSize(mgr: ConfigManager, value: number): void {
  mgr.set('fleet.maxSize', value);
}
// One narrower gap remains at 89690d07, distinct from the ConfigKey union:
// the GoodVibesConfig INTERFACE gains its `fleet` property only via the
// `declare module` augmentation in schema-domain-fleet.d.ts, and the public
// type graph never loads that file (schema.d.ts imports the domain module
// for VALUES only, so d.ts emission elides the import). A direct
// DEFAULT_CONFIG.fleet property read therefore still fails to typecheck in
// consumers even though the value is real at runtime — this one structural
// view covers exactly that object-shape read and nothing else.
function fleetMaxSizeOf(cfg: unknown): number {
  return (cfg as { fleet: { maxSize: number } }).fleet.maxSize;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Config schema extensions: orchestration, storage, sandbox, danger, and tools categories', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Default values
  // Note: global ~/.goodvibes/tui/settings.json may exist on dev machines and
  // can override some defaults. We verify structure and types, not exact values,
  // except for keys that project config explicitly controls (see 'get/set' tests).
  // -------------------------------------------------------------------------

  describe('defaults: orchestration category', () => {
    test('orchestration category fields have correct types when no project config exists', () => {
      const mgr = createConfigManager(tmpDir);
      expect(typeof mgr.get('orchestration.recursionEnabled')).toBe('boolean');
      expect(typeof mgr.get('orchestration.maxDepth')).toBe('number');
    });

    // orchestration.maxActiveAgents was renamed fleet.maxSize (the one agent
    // ceiling: native spawned agents, ACP-hosted rows, and elastic fixers all
    // count against it) — see the SDK's schema-domain-fleet.ts.
    test('fleet.maxSize has correct type when no project config exists', () => {
      const mgr = createConfigManager(tmpDir);
      expect(typeof getFleetMaxSize(mgr)).toBe('number');
    });

    test('danger category fields have correct types when no project config exists', () => {
      const mgr = createConfigManager(tmpDir);
      // `danger.daemon` (a deprecated alias for `daemon.enabled`) was removed from
      // the schema — see docs/decisions/2026-07-05-daemon-by-default.md
      // in the SDK. `daemon.enabled` carries the real default.
      expect(typeof mgr.get('danger.httpListener')).toBe('boolean');
      expect(typeof mgr.get('daemon.enabled')).toBe('boolean');
      expect(typeof mgr.get('daemon.embedInProcess')).toBe('boolean');
    });

    test('storage category fields have correct types when no project config exists', () => {
      const mgr = createConfigManager(tmpDir);
      expect(typeof mgr.get('storage.secretPolicy')).toBe('string');
      expect(typeof mgr.get('storage.artifacts.maxBytes')).toBe('number');
    });

    test('sandbox category fields have correct types when no project config exists', () => {
      const mgr = createConfigManager(tmpDir);
      expect(typeof mgr.get('sandbox.replIsolation')).toBe('string');
      expect(typeof mgr.get('sandbox.mcpIsolation')).toBe('string');
      expect(typeof mgr.get('sandbox.windowsMode')).toBe('string');
      expect(typeof mgr.get('sandbox.vmBackend')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuBinary')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuImagePath')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuExecWrapper')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuGuestHost')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuGuestPort')).toBe('number');
      expect(typeof mgr.get('sandbox.qemuGuestUser')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuWorkspacePath')).toBe('string');
      expect(typeof mgr.get('sandbox.qemuSessionMode')).toBe('string');
      expect(typeof mgr.get('sandbox.replJavaScriptCommand')).toBe('string');
      expect(typeof mgr.get('release.channel')).toBe('string');
    });

    test('DEFAULT_CONFIG.orchestration has correct default values', () => {
      expect(DEFAULT_CONFIG.orchestration.recursionEnabled).toBe(false);
      expect(DEFAULT_CONFIG.orchestration.maxDepth).toBe(0);
    });

    test('DEFAULT_CONFIG.fleet.maxSize has the correct default value', () => {
      expect(fleetMaxSizeOf(DEFAULT_CONFIG)).toBe(8);
    });

    test('DEFAULT_CONFIG.danger has correct default values', () => {
      // `danger.daemon` was removed from the schema; the real default
      // lives on `daemon.enabled`.
      expect(DEFAULT_CONFIG.danger.httpListener).toBe(false);
      expect(DEFAULT_CONFIG.daemon.enabled).toBe(true);
      expect(DEFAULT_CONFIG.daemon.embedInProcess).toBe(false);
    });

    test('DEFAULT_CONFIG.storage has correct default values', () => {
      expect(DEFAULT_CONFIG.storage.secretPolicy).toBe('preferred_secure');
      expect(DEFAULT_CONFIG.storage.artifacts.maxBytes).toBe(512 * 1024 * 1024);
    });

    test('DEFAULT_CONFIG.sandbox has correct default values', () => {
      expect(DEFAULT_CONFIG.sandbox.replIsolation).toBe('shared-vm');
      expect(DEFAULT_CONFIG.sandbox.mcpIsolation).toBe('disabled');
      expect(DEFAULT_CONFIG.sandbox.windowsMode).toBe('native-basic');
      expect(DEFAULT_CONFIG.sandbox.vmBackend).toBe('local');
      expect(DEFAULT_CONFIG.sandbox.qemuBinary).toBe('qemu-system-x86_64');
      expect(DEFAULT_CONFIG.sandbox.qemuImagePath).toBe('');
      expect(DEFAULT_CONFIG.sandbox.qemuExecWrapper).toBe('');
      expect(DEFAULT_CONFIG.sandbox.qemuGuestHost).toBe('');
      expect(DEFAULT_CONFIG.sandbox.qemuGuestPort).toBe(2222);
      expect(DEFAULT_CONFIG.sandbox.qemuGuestUser).toBe('goodvibes');
      expect(DEFAULT_CONFIG.sandbox.qemuWorkspacePath).toBe('/workspace');
      expect(DEFAULT_CONFIG.sandbox.qemuSessionMode).toBe('attach');
      expect(DEFAULT_CONFIG.sandbox.replJavaScriptCommand).toBe('bun');
      expect(DEFAULT_CONFIG.release.channel).toBe('stable');
    });

    test('project config overrides win for fleet.maxSize', () => {
      const projectSettingsDir = join(tmpDir, '.goodvibes', 'tui');
      mkdirSync(projectSettingsDir, { recursive: true });
      writeFileSync(
        join(projectSettingsDir, 'settings.json'),
        JSON.stringify({ fleet: { maxSize: 4 } }, null, 2),
        'utf-8'
      );
      const mgr = createConfigManager(tmpDir);
      expect(getFleetMaxSize(mgr)).toBe(4);
    });
  });

  describe('defaults: tools category', () => {
    test('tools category fields have correct types when no project config exists', () => {
      const mgr = createConfigManager(tmpDir);
      expect(typeof mgr.get('tools.llmProvider')).toBe('string');
      expect(typeof mgr.get('tools.llmModel')).toBe('string');
      expect(typeof mgr.get('tools.autoHeal')).toBe('boolean');
      expect(typeof mgr.get('tools.defaultTokenBudget')).toBe('number');
      expect(typeof mgr.get('tools.hooksFile')).toBe('string');
    });

    test('DEFAULT_CONFIG.tools has correct default values', () => {
      expect(DEFAULT_CONFIG.tools.llmProvider).toBe('');
      expect(DEFAULT_CONFIG.tools.llmModel).toBe('');
      expect(DEFAULT_CONFIG.tools.autoHeal).toBe(false);
      expect(DEFAULT_CONFIG.tools.defaultTokenBudget).toBe(5000);
      expect(DEFAULT_CONFIG.tools.hooksFile).toBe('hooks.json');
    });

    test('project config overrides win for tools fields', () => {
      const projectSettingsDir = join(tmpDir, '.goodvibes', 'tui');
      mkdirSync(projectSettingsDir, { recursive: true });
      writeFileSync(
        join(projectSettingsDir, 'settings.json'),
        JSON.stringify({ tools: { defaultTokenBudget: 3000 } }, null, 2),
        'utf-8'
      );
      const mgr = createConfigManager(tmpDir);
      expect(mgr.get('tools.defaultTokenBudget')).toBe(3000);
    });
  });

  // -------------------------------------------------------------------------
  // get / set round-trips
  // -------------------------------------------------------------------------

  describe('get/set: orchestration category', () => {
    test('set and get orchestration.recursionEnabled', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('orchestration.recursionEnabled', true);
      expect(mgr.get('orchestration.recursionEnabled')).toBe(true);
    });

    test('set and get fleet.maxSize with valid value', () => {
      const mgr = createConfigManager(tmpDir);
      setFleetMaxSize(mgr, 12);
      expect(getFleetMaxSize(mgr)).toBe(12);
    });

    test('set and get orchestration.maxDepth to 1', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('orchestration.maxDepth', 1);
      expect(mgr.get('orchestration.maxDepth')).toBe(1);
    });

    test('set and get orchestration.maxDepth to 3', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('orchestration.maxDepth', 3);
      expect(mgr.get('orchestration.maxDepth')).toBe(3);
    });

    test('set and get orchestration.maxDepth back to 0', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('orchestration.maxDepth', 1);
      mgr.set('orchestration.maxDepth', 0);
      expect(mgr.get('orchestration.maxDepth')).toBe(0);
    });

    test('set and get daemon.enabled', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('daemon.enabled', false);
      expect(mgr.get('daemon.enabled')).toBe(false);
    });

    test('set and get danger.httpListener', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('danger.httpListener', true);
      expect(mgr.get('danger.httpListener')).toBe(true);
    });

    test('set and get storage.secretPolicy', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('storage.secretPolicy', 'require_secure');
      expect(mgr.get('storage.secretPolicy')).toBe('require_secure');
    });

    test('set and get sandbox.replIsolation', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.replIsolation', 'shared-vm');
      expect(mgr.get('sandbox.replIsolation')).toBe('shared-vm');
    });

    test('set and get sandbox.mcpIsolation', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.mcpIsolation', 'per-server-vm');
      expect(mgr.get('sandbox.mcpIsolation')).toBe('per-server-vm');
    });

    test('set and get sandbox.windowsMode', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.windowsMode', 'native-basic');
      expect(mgr.get('sandbox.windowsMode')).toBe('native-basic');
    });

    test('set and get sandbox.vmBackend', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.vmBackend', 'qemu');
      expect(mgr.get('sandbox.vmBackend')).toBe('qemu');
    });

    test('set and get sandbox.qemuBinary', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuBinary', 'qemu-system-aarch64');
      expect(mgr.get('sandbox.qemuBinary')).toBe('qemu-system-aarch64');
    });

    test('set and get sandbox.qemuImagePath', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuImagePath', join(tmpDir, 'gv-sandbox.qcow2'));
      expect(mgr.get('sandbox.qemuImagePath')).toBe(join(tmpDir, 'gv-sandbox.qcow2'));
    });

    test('set and get sandbox.qemuExecWrapper', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuExecWrapper', join(tmpDir, 'gv-qemu-wrapper'));
      expect(mgr.get('sandbox.qemuExecWrapper')).toBe(join(tmpDir, 'gv-qemu-wrapper'));
    });

    test('set and get sandbox.qemuGuestHost', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuGuestHost', '127.0.0.1');
      expect(mgr.get('sandbox.qemuGuestHost')).toBe('127.0.0.1');
    });

    test('set and get sandbox.qemuGuestPort', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuGuestPort', 2222);
      expect(mgr.get('sandbox.qemuGuestPort')).toBe(2222);
    });

    test('set and get sandbox.qemuGuestUser', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuGuestUser', 'goodvibes');
      expect(mgr.get('sandbox.qemuGuestUser')).toBe('goodvibes');
    });

    test('set and get sandbox.qemuWorkspacePath', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuWorkspacePath', '/workspace');
      expect(mgr.get('sandbox.qemuWorkspacePath')).toBe('/workspace');
    });

    test('set and get sandbox.qemuSessionMode', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.qemuSessionMode', 'launch-per-command');
      expect(mgr.get('sandbox.qemuSessionMode')).toBe('launch-per-command');
    });

    test('set and get sandbox.replJavaScriptCommand', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('sandbox.replJavaScriptCommand', '/home/goodvibes/.bun/bin/bun');
      expect(mgr.get('sandbox.replJavaScriptCommand')).toBe('/home/goodvibes/.bun/bin/bun');
    });

    test('set and get release.channel', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('release.channel', 'preview');
      expect(mgr.get('release.channel')).toBe('preview');
    });
  });

  describe('get/set: tools category', () => {
    test('set and get tools.llmProvider', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.llmProvider', 'anthropic');
      expect(mgr.get('tools.llmProvider')).toBe('anthropic');
    });

    test('set and get tools.llmModel', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.llmModel', 'claude-sonnet-4-6');
      expect(mgr.get('tools.llmModel')).toBe('claude-sonnet-4-6');
    });

    test('set and get tools.autoHeal', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.autoHeal', true);
      expect(mgr.get('tools.autoHeal')).toBe(true);
    });

    test('set and get tools.defaultTokenBudget with valid value', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.defaultTokenBudget', 8000);
      expect(mgr.get('tools.defaultTokenBudget')).toBe(8000);
    });

    test('set and get tools.hooksFile', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.hooksFile', 'custom-hooks.json');
      expect(mgr.get('tools.hooksFile')).toBe('custom-hooks.json');
    });
  });

  // -------------------------------------------------------------------------
  // Validation: invalid values must throw
  // -------------------------------------------------------------------------

  describe('validation: orchestration category', () => {
    test('orchestration.maxDepth accepts value 2', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('orchestration.maxDepth', 2);
      expect(mgr.get('orchestration.maxDepth')).toBe(2);
    });

    test('orchestration.maxDepth rejects negative value', () => {
      const mgr = createConfigManager(tmpDir);
      expect(() => mgr.set('orchestration.maxDepth', -1 as never)).toThrow();
    });

    test('orchestration.maxDepth rejects value 6', () => {
      const mgr = createConfigManager(tmpDir);
      expect(() => mgr.set('orchestration.maxDepth', 6 as never)).toThrow();
    });

    test('fleet.maxSize rejects 0 (below minimum)', () => {
      const mgr = createConfigManager(tmpDir);
      expect(() => setFleetMaxSize(mgr, 0)).toThrow();
    });

    test('fleet.maxSize rejects 21 (above maximum)', () => {
      const mgr = createConfigManager(tmpDir);
      expect(() => setFleetMaxSize(mgr, 21)).toThrow();
    });

    test('fleet.maxSize accepts boundary value 1', () => {
      const mgr = createConfigManager(tmpDir);
      setFleetMaxSize(mgr, 1);
      expect(getFleetMaxSize(mgr)).toBe(1);
    });

    test('fleet.maxSize accepts boundary value 20', () => {
      const mgr = createConfigManager(tmpDir);
      setFleetMaxSize(mgr, 20);
      expect(getFleetMaxSize(mgr)).toBe(20);
    });
  });

  describe('validation: tools category', () => {
    test('tools.defaultTokenBudget rejects value below 100', () => {
      const mgr = createConfigManager(tmpDir);
      expect(() => mgr.set('tools.defaultTokenBudget', 99 as never)).toThrow();
    });

    test('tools.defaultTokenBudget rejects value above 100000', () => {
      const mgr = createConfigManager(tmpDir);
      expect(() => mgr.set('tools.defaultTokenBudget', 100001 as never)).toThrow();
    });

    test('tools.defaultTokenBudget accepts boundary value 100', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.defaultTokenBudget', 100);
      expect(mgr.get('tools.defaultTokenBudget')).toBe(100);
    });

    test('tools.defaultTokenBudget accepts boundary value 100000', () => {
      const mgr = createConfigManager(tmpDir);
      mgr.set('tools.defaultTokenBudget', 100000);
      expect(mgr.get('tools.defaultTokenBudget')).toBe(100000);
    });
  });

  // -------------------------------------------------------------------------
  // getAll() includes new categories
  // -------------------------------------------------------------------------

  describe('getAll includes new categories', () => {
    test('getAll returns orchestration and danger categories with correct field types', () => {
      const mgr = createConfigManager(tmpDir);
      const all = mgr.getAll();
      expect(typeof all.orchestration.recursionEnabled).toBe('boolean');
      expect(typeof fleetMaxSizeOf(all)).toBe('number');
      expect(typeof all.orchestration.maxDepth).toBe('number');
      expect(typeof all.danger.httpListener).toBe('boolean');
      expect(typeof all.daemon.enabled).toBe('boolean');
      expect(typeof all.daemon.embedInProcess).toBe('boolean');
    });

    test('getAll returns tools category with correct field types', () => {
      const mgr = createConfigManager(tmpDir);
      const all = mgr.getAll();
      expect(typeof all.tools.llmProvider).toBe('string');
      expect(typeof all.tools.llmModel).toBe('string');
      expect(typeof all.tools.autoHeal).toBe('boolean');
      expect(typeof all.tools.defaultTokenBudget).toBe('number');
      expect(typeof all.tools.hooksFile).toBe('string');
    });

    test('getAll snapshot does not reflect subsequent mutations (deep clone)', () => {
      const mgr = createConfigManager(tmpDir);
      const valueBefore = getFleetMaxSize(mgr);
      const snapshot = mgr.getAll();
      // Set to a value that differs from whatever was loaded (pick 1 if current is > 1, else pick 2)
      const newValue = valueBefore !== 1 ? 1 : 2;
      setFleetMaxSize(mgr, newValue);
      // Snapshot must not reflect the mutation
      expect(fleetMaxSizeOf(snapshot)).toBe(valueBefore);
      expect(getFleetMaxSize(mgr)).toBe(newValue);
    });
  });

  // -------------------------------------------------------------------------
  // DEFAULT_CONFIG shape
  // -------------------------------------------------------------------------

  describe('DEFAULT_CONFIG shape', () => {
    test('DEFAULT_CONFIG.orchestration and danger have all required keys', () => {
      expect(DEFAULT_CONFIG.orchestration).toEqual(expect.objectContaining({
        recursionEnabled: expect.any(Boolean),
        maxDepth: expect.any(Number),
      }));
      expect(typeof DEFAULT_CONFIG.orchestration.recursionEnabled).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.orchestration.maxDepth).toBe('number');
      expect(typeof fleetMaxSizeOf(DEFAULT_CONFIG)).toBe('number');
      // `danger.daemon` was removed from the schema (see tests above).
      expect(DEFAULT_CONFIG.danger).toEqual(expect.objectContaining({
        httpListener: expect.any(Boolean),
      }));
      expect(typeof DEFAULT_CONFIG.danger.httpListener).toBe('boolean');
      expect(DEFAULT_CONFIG.daemon).toEqual(expect.objectContaining({
        enabled: expect.any(Boolean),
        embedInProcess: expect.any(Boolean),
      }));
    });

    test('DEFAULT_CONFIG.tools has all required keys', () => {
      expect(DEFAULT_CONFIG.tools).toEqual(expect.objectContaining({
        llmProvider: expect.any(String),
        llmModel: expect.any(String),
        autoHeal: expect.any(Boolean),
      }));
      expect(typeof DEFAULT_CONFIG.tools.llmProvider).toBe('string');
      expect(typeof DEFAULT_CONFIG.tools.llmModel).toBe('string');
      expect(typeof DEFAULT_CONFIG.tools.autoHeal).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.tools.defaultTokenBudget).toBe('number');
      expect(typeof DEFAULT_CONFIG.tools.hooksFile).toBe('string');
    });

    test('DEFAULT_CONFIG is not mutated by ConfigManager instantiation', () => {
      const before = JSON.stringify(DEFAULT_CONFIG);
      createConfigManager(tmpDir);
      expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
    });
  });
});
