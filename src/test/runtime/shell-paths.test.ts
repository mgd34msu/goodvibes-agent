import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellPathService } from '@/runtime/index.ts';

// Not migrated to makeProjectTempDir: none of the paths below are ever
// materialized on disk. createShellPathService is pure path derivation (no
// filesystem I/O at all — confirmed by reading its implementation), and
// every assertion in this file only checks the derived string values.
describe('createShellPathService', () => {
  test('derives project and user roots from explicit absolute ownership', () => {
    const workingDirectory = join(tmpdir(), 'gv-shell-paths-workspace');
    const homeDirectory = join(tmpdir(), 'gv-shell-paths-home');
    const paths = createShellPathService({ workingDirectory, homeDirectory });

    expect(paths.workingDirectory).toBe(workingDirectory);
    expect(paths.homeDirectory).toBe(homeDirectory);
    expect(paths.projectGoodVibesRoot).toBe(join(workingDirectory, '.goodvibes'));
    expect(paths.resolveUserPath('tui')).toBe(join(homeDirectory, '.goodvibes', 'tui'));
  });

  test('rejects relative or empty owned roots', () => {
    expect(() => createShellPathService({
      workingDirectory: 'relative-workspace',
      homeDirectory: join(tmpdir(), 'gv-shell-paths-home'),
    })).toThrow('ShellPathService workingDirectory must be an absolute path.');

    expect(() => createShellPathService({
      workingDirectory: join(tmpdir(), 'gv-shell-paths-workspace'),
      homeDirectory: '',
    })).toThrow('ShellPathService homeDirectory must be a non-empty absolute path.');
  });
});
