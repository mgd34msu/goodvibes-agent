/**
 * The proactive check-in loop, wired live in src/runtime/services.ts: the
 * SDK's registerGatewayVerbGroups only registers checkin.* handlers when
 * channelDeliveryRouter, providerRegistry, automationManager, and
 * sessionLister are ALL present (see register-gateway-verb-groups.js) — this
 * repo threads all four through, so the checkin.* verbs answer for real
 * instead of 501 "Gateway method is not invokable". These tests exercise the
 * loop end-to-end through the gateway method catalog exactly as the operator
 * HTTP surface would invoke it: briefing -> judgment -> conditional delivery
 * -> receipt, every run leaving a visible, accountable record.
 *
 * ── Whose composition this drives, as of the client split ────────────────
 *
 * `buildDaemonGatewayCatalog(services)` builds the catalog THE DAEMON composes
 * over this graph — the agent's own `services.gatewayMethods` carries no handler
 * for any of these any more, and that absence is itself pinned in
 * daemon/gateway-ws-only-invokable.test.ts.
 *
 * The behaviour below did not move or change; its OWNER did. These verbs are
 * served to every surface by one process now, and this suite is where the
 * contract that surface depends on stays honest. Driving it through the
 * daemon's composition is the difference between verifying a contract and
 * asserting that a client answers its own question.
 */
import { describe, expect, test } from 'bun:test';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';
import { buildDaemonGatewayCatalog } from '../helpers/daemon-gateway.ts';

interface CheckinReceipt {
  readonly id: string;
  readonly ranAt: number;
  readonly trigger: 'scheduled' | 'manual';
  readonly outcome: 'delivered' | 'quiet' | 'skipped-disabled' | 'skipped-quiet-hours' | 'error';
  readonly briefingSummary: string;
  readonly deliveredMessage?: string;
  readonly deliveryId?: string;
}

async function invoke<T>(methodId: string, body: Record<string, unknown> = {}): Promise<T> {
  const services = getTestRuntimeServices();
  // Pin the current chat route to the instant mock model the test helper
  // seeds. The check-in judge makes one provider.chat call against the
  // registry's CURRENT model; left at the default route it can stall toward
  // the judge's own 20s timeout (no credentials, real provider) and blow
  // bun's 5s per-test budget under full-suite load. setCurrentModel, not a
  // config write: the registry reads its configured model key once at
  // construction, so config writes after construction do not retarget it.
  services.providerRegistry.setCurrentModel('mock:mock-model');
  return buildDaemonGatewayCatalog(services).invoke(methodId, { methodId, body } as never) as Promise<T>;
}

/** A 5-minute window centered on the current instant, in local 'HH:MM-HH:MM' — always covers "now" regardless of when the suite runs, including across midnight. */
function quietHoursCoveringNow(): string {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const fmt = (minutes: number): string => {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  return `${fmt(nowMinutes - 2)}-${fmt(nowMinutes + 2)}`;
}

describe('checkin gateway verb group (live, not a 501 facade)', () => {
  test('descriptors are registered on the catalog', () => {
    const services = getTestRuntimeServices();
    for (const methodId of ['checkin.config.get', 'checkin.config.set', 'checkin.run', 'checkin.receipts.list']) {
      expect(buildDaemonGatewayCatalog(services).get(methodId), `${methodId} descriptor missing from the catalog`).toBeTruthy();
    }
  });

  test('checkin.enabled defaults to false', async () => {
    const { config } = await invoke<{ config: { enabled: boolean } }>('checkin.config.get');
    expect(config.enabled).toBe(false);
  });

  test('an enabled check-in run produces a receipt', async () => {
    await invoke('checkin.config.set', { enabled: true, quietHours: '' });

    const runResult = await invoke<{ outcome: string; summary: string }>('checkin.run');
    expect(['delivered', 'quiet', 'error']).toContain(runResult.outcome);
    expect(typeof runResult.summary).toBe('string');

    const { receipts } = await invoke<{ receipts: CheckinReceipt[] }>('checkin.receipts.list');
    expect(receipts.length).toBeGreaterThan(0);
    const latest = receipts[0]!;
    expect(latest.trigger).toBe('manual');
    expect(typeof latest.briefingSummary).toBe('string');
  });

  test('quiet hours suppress delivery but still record a receipt (ran-quiet)', async () => {
    await invoke('checkin.config.set', { enabled: true, quietHours: quietHoursCoveringNow() });

    const runResult = await invoke<{ outcome: string }>('checkin.run');
    // checkin.run collapses the receipt's granular outcome to 'skipped' on the wire.
    expect(runResult.outcome).toBe('skipped');

    const { receipts } = await invoke<{ receipts: CheckinReceipt[] }>('checkin.receipts.list');
    const latest = receipts[0]!;
    expect(latest.outcome).toBe('skipped-quiet-hours');
    expect(latest.deliveredMessage).toBeUndefined();
    expect(latest.deliveryId).toBeUndefined();
  });

  test('a disabled check-in run is recorded but never delivers', async () => {
    await invoke('checkin.config.set', { enabled: false, quietHours: '' });

    const runResult = await invoke<{ outcome: string }>('checkin.run');
    expect(runResult.outcome).toBe('skipped');

    const { receipts } = await invoke<{ receipts: CheckinReceipt[] }>('checkin.receipts.list');
    const latest = receipts[0]!;
    expect(latest.outcome).toBe('skipped-disabled');
    expect(latest.deliveryId).toBeUndefined();
  });
});
