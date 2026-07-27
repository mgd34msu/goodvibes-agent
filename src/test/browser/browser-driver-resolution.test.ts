import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import {
  DRIVER_VERSION,
  driverSearchDirectories,
  managedDriverRoot,
} from '../../browser/browser-provision-io.ts';
import { browserHostScriptPath } from '../../browser/browser-host-client.ts';
import { browserProfileRoot, browserScreenshotRoot } from '../../browser/browser-sessions.ts';

const repoRoot = join(import.meta.dir, '..', '..', '..');

describe('driver resolution for a compiled binary', () => {
  /**
   * A compiled binary has no node_modules and no package.json, so it cannot
   * look up which driver it needs. The version is a constant in the source, and
   * this keeps it honest against the dependency the repo actually installs.
   */
  test('the pinned driver version matches the declared dependency', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.['playwright-core']).toBe(DRIVER_VERSION);
  });

  test('the search looks beside the executable before anywhere else', () => {
    const directories = driverSearchDirectories('/home/someone');
    const executableDirectory = dirname(process.execPath);
    expect(directories[0]).toBe(join(executableDirectory, 'playwright-core'));
    expect(directories).toContain(join(executableDirectory, 'vendor', 'playwright-core'));
  });

  test('the search includes the agent-owned driver directory', () => {
    const directories = driverSearchDirectories('/home/someone');
    expect(directories).toContain(join(managedDriverRoot('/home/someone'), 'node_modules', 'playwright-core'));
  });

  test('an explicit override is searched first', () => {
    const previous = process.env.GOODVIBES_PLAYWRIGHT_CORE;
    process.env.GOODVIBES_PLAYWRIGHT_CORE = '/opt/driver';
    try {
      expect(driverSearchDirectories('/home/someone')[0]).toBe('/opt/driver');
    } finally {
      if (previous === undefined) delete process.env.GOODVIBES_PLAYWRIGHT_CORE;
      else process.env.GOODVIBES_PLAYWRIGHT_CORE = previous;
    }
  });

  test('the managed driver directory sits under the agent storage root', () => {
    expect(managedDriverRoot('/home/someone')).toBe('/home/someone/.goodvibes/agent/browser/driver');
  });
});

describe('agent-owned browser storage', () => {
  test('profiles and screenshots live under the surface-scoped storage root', () => {
    expect(browserProfileRoot('/home/someone')).toBe('/home/someone/.goodvibes/agent/browser/profiles');
    expect(browserScreenshotRoot('/home/someone')).toBe('/home/someone/.goodvibes/agent/browser/screenshots');
  });

  test('neither writes into the user\'s project directory', () => {
    for (const path of [browserProfileRoot('/home/someone'), browserScreenshotRoot('/home/someone')]) {
      expect(path.startsWith('/home/someone/.goodvibes/')).toBe(true);
    }
  });
});

describe('the node-hosted browser host', () => {
  test('its script ships with the source and is found on disk', () => {
    const path = browserHostScriptPath();
    expect(path.endsWith('browser-host.mjs')).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('connectOverCDP');
  });

  test('the host never closes a browser it attached to', () => {
    const source = readFileSync(browserHostScriptPath(), 'utf8');
    // The release handler drops the connection; nothing calls browser.close().
    expect(source).toContain('state.browser = null');
    expect(source).not.toContain('browser.close()');
  });
});
