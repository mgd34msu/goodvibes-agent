import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..');

interface PackageJson {
  readonly dependencies?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
) as PackageJson;

async function expectImportable(specifier: string): Promise<void> {
  expect(await import(specifier)).toEqual(expect.any(Object));
}

describe('dependency surface', () => {
  /**
   * The packaged Agent bundles its libraries into dist/package/main.js, so it
   * declares no runtime LIBRARY dependencies at all.
   *
   * The browser driver used to be the one exception: playwright-core cannot be
   * bundled, because it loads browsers.json and its own driver files by path
   * relative to its package directory, so an inlined copy would look for files
   * that are not there. It is still installed and still shipped beside the
   * binary, but the browser engine is
   * `@pellux/goodvibes-sdk/platform/browser` now, and the SDK carries the
   * driver in ITS optionalDependencies. Declaring it here as well would pin the
   * same package in two places, which is exactly how the version the agent
   * stages and the version the engine expects drift apart.
   *
   * `@pellux/goodvibes-daemon` is the one declared dependency, and it is not a library
   * this bundle could ever inline: it is a second PROGRAM. The Agent needs a
   * daemon to talk to, docs/getting-started.md lists one as a prerequisite,
   * and since the daemon left the TUI's repository it has its own package whose
   * own postinstall places its own binary. Declaring it here is what keeps
   * `bun add -g @pellux/goodvibes-agent` a single act that leaves both commands
   * on PATH, exactly as `@pellux/goodvibes-tui` declares it for the same
   * reason. It is deliberately NOT bundled and NOT copied: two packages each
   * placing a copy of the daemon package is how a machine ends up with two of
   * them on different version lines.
   */
  test('declares one runtime dependency — the daemon program; every library is bundled or comes with the SDK', () => {
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(['@pellux/goodvibes-daemon']);
  });

  /**
   * Exact, not a range: the daemon and the Agent are separate products on
   * separate version lines, and a range would let `bun add -g` pick up a daemon
   * this Agent has never been run against.
   */
  test('the daemon dependency is pinned exactly', () => {
    expect(packageJson.dependencies?.['@pellux/goodvibes-daemon']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('the browser driver is still resolvable, supplied by the SDK', async () => {
    // Not a declared dependency of this package, but it must be installed:
    // `bun run build` stages node_modules/playwright-core beside the binary.
    await expectImportable('playwright-core');
  });

  test('runtime import entrypoints used by the product resolve from installed dependencies', async () => {
    for (const specifier of [
      '@pellux/goodvibes-sdk/platform/config',
      '@pellux/goodvibes-sdk/platform/daemon',
      '@pellux/goodvibes-sdk/platform/security',
      'sql.js',
      'sqlite-vec',
      'typescript',
      'zustand/vanilla',
    ]) {
      await expectImportable(specifier);
    }
  });
});

describe('sql.js', () => {
  test('initializes an in-memory database and runs a basic query', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.run('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
      db.run('INSERT INTO test VALUES (1, ?)', ['hello']);
      const result = db.exec('SELECT val FROM test WHERE id = 1');
      expect(result).toHaveLength(1);
      expect(result[0]?.values[0]?.[0]).toBe('hello');
    } finally {
      db.close();
    }
  });
});

describe('sqlite-vec', () => {
  test('exposes the load helpers used by vector-backed knowledge setup', async () => {
    const sqliteVec = await import('sqlite-vec');
    expect(typeof sqliteVec.getLoadablePath).toBe('function');
    expect(typeof sqliteVec.load).toBe('function');
  });
});

describe('zustand runtime store dependency', () => {
  test('creates a vanilla store without pulling the React entrypoint', async () => {
    const { createStore } = await import('zustand/vanilla');
    const store = createStore<{ count: number }>(() => ({ count: 1 }));
    expect(store.getState().count).toBe(1);
  });
});

describe('typescript', () => {
  test('transpiles a small TypeScript snippet', async () => {
    const ts = await import('typescript');
    const output = ts.transpileModule('const answer: number = 42;', {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    });
    expect(output.outputText).toContain('const answer = 42');
  });
});
