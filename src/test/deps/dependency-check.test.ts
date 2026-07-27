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
   * declares no runtime dependencies at all.
   *
   * The browser driver used to be the one exception: playwright-core cannot be
   * bundled, because it loads browsers.json and its own driver files by path
   * relative to its package directory, so an inlined copy would look for files
   * that are not there. It is still installed and still shipped beside the
   * binary — but the browser engine is
   * `@pellux/goodvibes-sdk/platform/browser` now, and the SDK carries the
   * driver in ITS optionalDependencies. Declaring it here as well would pin the
   * same package in two places, which is exactly how the version the agent
   * stages and the version the engine expects drift apart.
   */
  test('declares no runtime dependencies: everything is bundled or comes with the SDK', () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
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
