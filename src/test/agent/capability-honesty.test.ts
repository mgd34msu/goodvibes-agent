/**
 * Capability-honesty pins for email and telephony.
 *
 * Guards the rule that no email/telephony capability is advertised while inert:
 *   - Email `/email` subcommands: the advertised list (argsHint) must equal the
 *     set of subcommands the handler actually branches on.
 *   - Email writing-style-matched draft reply: must NOT be wired into the
 *     advertised Personal Ops inbox lane (no sent-corpus reader exists; the
 *     inventory records it "not yet shipped"). Re-advertising it fails here.
 *   - Telephony SMS/voice/bridge: the advertised delivery channel must be
 *     backed by a real SDK delivery strategy, so it is not an inert descriptor.
 *
 * These are drift guards: if a future change re-advertises an inert capability
 * or drops the telephony strategy, the pin fails.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDefaultChannelDeliveryStrategies } from '@pellux/goodvibes-sdk/platform/channels';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerEmailRuntimeCommands } from '../../input/commands/email-runtime.ts';

const SRC_ROOT = join(import.meta.dir, '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), 'utf-8');
}

describe('email capability honesty', () => {
  test('the /email command advertises exactly the subcommands it handles', () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const email = registry.get('email');
    expect(email).toBeDefined();

    const advertised = new Set((email!.argsHint ?? '').split('|').map((token) => token.trim()).filter(Boolean));

    const source = readSource('input/commands/email-runtime.ts');
    const handled = new Set(
      [...source.matchAll(/sub === '([a-z]+)'/g)].map((match) => match[1]!),
    );

    // Every advertised subcommand is handled, and every handled subcommand is advertised.
    expect([...advertised].sort()).toEqual([...handled].sort());
    // The known working set, pinned so silent additions/removals are visible.
    expect([...handled].sort()).toEqual(['check', 'config', 'send', 'set', 'status']);
  });

  test('the unshipped writing-style draft composer is not advertised in the Personal Ops inbox lane', () => {
    const lanes = readSource('tools/agent-harness-personal-ops-lanes.ts');
    // The lane builder must not wire the style-reply descriptors into advertised output.
    expect(lanes).not.toMatch(/styleReplyAdditions/);
    expect(lanes).not.toMatch(/buildStyleReplyLaneAdditions\(/);

    // And the product inventory must keep recording it as not yet shipped, so the
    // advertised-capability position stays consistent with the wired reality.
    const inventory = readSource('agent/competitive-feature-inventory.ts');
    expect(inventory).toContain('Writing-style-matched draft replies');
    expect(inventory.toLowerCase()).toContain('not yet shipped');
  });
});

describe('telephony capability honesty', () => {
  test('advertised telephony delivery is backed by a real SDK delivery strategy', () => {
    // The factory builds strategy descriptors (id + matches + deliver closures);
    // enumerating ids does not require live config/service/artifact wiring.
    const strategies = createDefaultChannelDeliveryStrategies(
      {} as never,
      {} as never,
      {} as never,
      () => null as never,
      {} as never,
    );
    const ids = strategies.map((strategy) => strategy.id);
    expect(ids).toContain('channel-delivery:telephony');
  });

  test('telephony is listed as an advertised delivery channel with concrete config keys', () => {
    const channels = readSource('input/agent-workspace-channels.ts');
    // Advertised in the channel catalog...
    expect(channels).toContain("id: 'telephony'");
    // ...with the config keys the SDK telephony strategy actually reads (Twilio-direct
    // or bridge), so setup can make it genuinely ready.
    expect(channels).toContain('surfaces.telephony.enabled');
    expect(channels).toContain('surfaces.telephony.bridgeUrl');
    expect(channels).toContain('surfaces.telephony.accountSid');
  });
});
