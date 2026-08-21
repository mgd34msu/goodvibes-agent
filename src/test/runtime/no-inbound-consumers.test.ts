/**
 * Regression guard for this process's adopt-only contract: goodvibes-agent
 * composes NO inbound channel consumer of its own.
 *
 * This process never runs a daemon of its own. `src/runtime/bootstrap-external-services.ts`
 * only ever ADOPTS a connected host through the SDK's adopt-or-spawn policy
 * with `adoptOnly: true`, it never constructs, embeds, or restarts a
 * DaemonServer, and there is no getUpdates/ntfy/inbox poll loop anywhere
 * under src/ outside tests.
 *
 * That property is true today by construction, but nothing enforced it.
 * Constructing a daemon or starting an inbound consumer (a Telegram
 * getUpdates poll, an ntfy subscription, an inbox poller) here would be an
 * architectural change to how this process relates to the daemon it
 * connects to, and must be raised and agreed on deliberately, never made
 * silently as a side effect of an unrelated change. These tests fail
 * loudly, with an explanation, the moment that stops being true.
 */
import { describe, expect, mock, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { wireAgentExternalServices } from '../../runtime/bootstrap-external-services.ts';
import { AgentDaemonReceiptFeed } from '../../runtime/daemon-receipts.ts';
import { createDeferredStartupCoordinator, startExternalServices, type ExternalServicesHandle } from '@/runtime/index.ts';

const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');

describe('external-services bootstrap stays adopt-only (no daemon construction)', () => {
  test('wireAgentExternalServices calls the SDK adopt-or-spawn policy with adoptOnly: true, never with a construction/embed factory', async () => {
    // Drive the real seam with injected fakes instead of grepping text: this
    // proves the *behavior*, not just the source shape, so a future refactor
    // that keeps the words "adoptOnly: true" somewhere but stops passing them
    // to the SDK policy call still fails this test.
    const daemonReceiptFeed = new AgentDaemonReceiptFeed();
    const memoryConsolidationReceiptFeed = new AgentDaemonReceiptFeed();

    const fakeHandle: ExternalServicesHandle = {
      daemonServer: null,
      httpListener: null,
      daemonStatus: { mode: 'external', host: '127.0.0.1', port: 3421, baseUrl: 'http://127.0.0.1:3421' },
      httpListenerStatus: { mode: 'disabled', host: '127.0.0.1', port: 3422, baseUrl: 'http://127.0.0.1:3422' },
      listRecentControlPlaneEvents: () => [],
      stop: async () => {},
    };

    // Spy standing in for `startExternalServices` (== the SDK's
    // `bootstrap.startHostServices`, the ONLY seam that can construct or
    // embed a DaemonServer). We never let it run for real; we only assert
    // how the Agent calls it.
    const startServicesSpy = mock(async (..._args: unknown[]) => fakeHandle) as unknown as typeof startExternalServices;

    const configManager = {
      get: (key: 'daemon.enabled' | 'danger.httpListener' | 'controlPlane.host' | 'controlPlane.port' | 'httpListener.host' | 'httpListener.port') => {
        switch (key) {
          case 'controlPlane.host': return '127.0.0.1';
          case 'controlPlane.port': return 3421;
          case 'httpListener.host': return '127.0.0.1';
          case 'httpListener.port': return 3422;
          default: return undefined;
        }
      },
    };

    const deferredStartup = createDeferredStartupCoordinator();

    const controller = wireAgentExternalServices({
      configManager,
      runtimeBus: {} as never,
      hookDispatcher: {} as never,
      // `asDaemonGradeView` is what the wiring hands the adopt-or-spawn policy:
      // the graph with its two client narrowings substituted back. Under
      // adoptOnly the policy reads only localUserAuthManager and configManager
      // off it and never constructs a DaemonServer, which is this test's point.
      services: { daemonReceiptFeed, memoryConsolidationReceiptFeed, asDaemonGradeView: () => ({}) } as never,
      uiServices: { platform: {} } as never,
      deferredStartup,
      systemMessageRouter: { high: () => {}, low: () => {} } as never,
      requestRender: () => {},
      startServices: startServicesSpy,
      // Explicit seam so the boot-time "installed but stopped" autostart check
      // (a separate, already-adopted-daemon short-circuit) never needs to
      // touch a real platform service manager in this test.
      connectedHostAutostart: {
        control: { snapshot: () => [] } as never,
        probeReachability: async () => 'online' as never,
      },
    });

    await controller.whenDiscovered();

    const calls = (startServicesSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.length,
      'wireAgentExternalServices must call the SDK adopt-or-spawn policy exactly once during boot discovery. ' +
      'This process is adopt-only: it connects to an existing daemon rather than running one. If this count ' +
      'changed, check what boot-time path now bypasses the shared policy call.',
    ).toBe(1);

    const [, , , , factories] = calls[0] as [unknown, unknown, unknown, unknown, Record<string, unknown> | undefined];
    expect(
      factories,
      'The Agent must pass { adoptOnly: true } (and no daemon-construction factory) to the SDK\'s startHostServices ' +
      'policy. adoptOnly is what stops this process from ever spawning or embedding its own DaemonServer, per the ' +
      'contract in src/runtime/bootstrap-external-services.ts. Losing this flag would let the Agent construct a ' +
      'daemon of its own; that is an architectural change to how this process relates to the daemon it connects ' +
      'to, and it must be raised and agreed on deliberately, not land as a side effect of this call site changing.',
    ).toEqual({ adoptOnly: true });
    expect(
      factories && 'createDaemonServer' in factories,
      'No daemon-construction factory may be passed at this call site. The SDK deleted the createDaemonServer ' +
      'slot when in-process daemon composition was removed; this runtime check stays as insurance against the ' +
      'slot being reintroduced or smuggled through as an untyped extra. This process adopts connected hosts; ' +
      'it does not build them.',
    ).toBe(false);
  });
});

describe('no inbound channel consumer exists anywhere under src/ (excluding tests)', () => {
  // Patterns that would indicate this process has started consuming inbound
  // channel messages on its own: Telegram long-polling, ntfy's streamed
  // subscription read, a generic named "start an ingress loop", the shared
  // multi-provider channel runtime manager, or constructing a daemon server
  // directly (the thing that would actually own such a consumer).
  const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly needle: string; readonly why: string }> = [
    {
      needle: 'subscribeJsonStream',
      why: 'this is the ntfy streamed-subscription read; this process must never subscribe to a channel feed itself',
    },
    {
      needle: 'getUpdates',
      why: 'this is Telegram\'s long-poll inbound method; this process must never poll a bot\'s updates itself',
    },
    {
      needle: 'startIngress',
      why: 'this is the generic "begin consuming inbound channel messages" entry point; this process adopts a connected host instead of starting its own ingress',
    },
    {
      needle: 'ChannelProviderRuntimeManager',
      why: 'this is the shared multi-provider channel runtime that actually drives inbound consumption; constructing it here would make this process an inbound consumer of its own, which is outside its adopt-only contract',
    },
    {
      needle: 'new DaemonServer',
      why: 'constructing a DaemonServer is exactly what src/runtime/bootstrap-external-services.ts deliberately never does (it only adopts, via adoptOnly: true)',
    },
  ];

  // A real filesystem scan (not a fixed file list) so this stays true as the
  // repo changes: any new file that introduces one of these patterns fails
  // this test immediately, regardless of where it lives under src/.
  function collectSourceFiles(dir: string, acc: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        // src/test/ is explicitly excluded from this guard: test helpers and
        // fixtures are allowed to reference these names (e.g. to assert their
        // absence, as this very file does).
        if (relative(SRC_ROOT, fullPath) === 'test') continue;
        collectSourceFiles(fullPath, acc);
        continue;
      }
      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        acc.push(fullPath);
      }
    }
  }

  test('no file under src/ (excluding src/test/) starts an inbound channel consumer or constructs a daemon server', () => {
    const files: string[] = [];
    collectSourceFiles(SRC_ROOT, files);
    expect(files.length, 'the source scan found no files at all; something is wrong with the scan itself, not the repo').toBeGreaterThan(0);

    const violations: string[] = [];
    for (const filePath of files) {
      // This file's own source text legitimately contains these words (in
      // the FORBIDDEN_PATTERNS table and these comments) as part of stating
      // the guard, so it is excluded from the scan of itself.
      if (filePath === import.meta.path) continue;
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(PROJECT_ROOT, filePath);
      for (const { needle, why } of FORBIDDEN_PATTERNS) {
        if (content.includes(needle)) {
          violations.push(`${relPath}: contains "${needle}": ${why}`);
        }
      }
    }

    expect(
      violations,
      'This process (goodvibes-agent) is adopt-only: it connects to an existing daemon rather than running one, ' +
      'per the contract in src/runtime/bootstrap-external-services.ts (startExternalServices called with ' +
      '{ adoptOnly: true }). It never constructs or embeds a daemon and never starts an inbound channel consumer ' +
      'of its own (no Telegram getUpdates poll, no ntfy subscribe, no inbox poll loop). Adding an inbound consumer ' +
      'here is an architectural change and must be raised and agreed on deliberately, not made silently; if one ' +
      'of the violations below is intentional, stop and raise it before landing it.',
    ).toEqual([]);
  });
});
