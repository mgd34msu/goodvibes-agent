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
import {
  CAPABILITY_REGISTRY,
  CAPABILITY_READINESS_LEVELS,
  capabilityReadinessUserLabel,
  getCapabilityByAdvertisedName,
  renderCapabilityReadinessLine,
} from '../../agent/capability-registry.ts';
import { LIVE_VERIFICATION_SCENARIO_IDS } from '../../verification/live-verifier.ts';
import { AGENT_WORKSPACE_ONBOARDING_DETAIL_CATEGORIES } from '../../input/agent-workspace-onboarding-categories.ts';

const SRC_ROOT = join(import.meta.dir, '..', '..');
const REPO_ROOT = join(SRC_ROOT, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), 'utf-8');
}

/**
 * Capability nouns as they appear in advertised onboarding copy, each mapped
 * to the registry id that must own it. Every noun is greped from the
 * onboarding surfaces below, so this list cannot silently go stale, and every
 * noun must resolve to a declared readiness level.
 */
const ADVERTISED_CAPABILITY_NOUNS: ReadonlyArray<readonly [noun: string, capabilityId: string]> = [
  ['voice', 'voice'],
  ['text-to-speech', 'text-to-speech'],
  ['TTS', 'text-to-speech'],
  ['image input', 'image-input'],
  ['media generation', 'media-generation'],
  ['telephony', 'telephony'],
  ['Messaging', 'messaging-channels'],
  ['Memory', 'local-context-memory'],
  ['Knowledge', 'agent-knowledge'],
  ['email', 'email'],
  ['calendar', 'calendar'],
  ['Research', 'deep-research'],
  ['Documents', 'documents'],
  ['Schedules', 'schedules-automation'],
  ['local model', 'local-model-cookbook'],
  ['model comparison', 'blind-model-comparison'],
];

const ADVERTISED_SURFACE_SOURCES = [
  'input/agent-workspace-categories.ts',
  'input/agent-workspace-onboarding-categories.ts',
];

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

describe('capability readiness registry', () => {
  test('every registry entry declares one of the four allowed levels and a unique id', () => {
    const ids = new Set<string>();
    for (const capability of CAPABILITY_REGISTRY) {
      expect(CAPABILITY_READINESS_LEVELS).toContain(capability.level);
      expect(capability.title.length).toBeGreaterThan(0);
      expect(capability.surfaces.length).toBeGreaterThan(0);
      expect(capability.advertisedNames.length).toBeGreaterThan(0);
      expect(capability.readinessNote.length).toBeGreaterThan(0);
      expect(ids.has(capability.id)).toBe(false);
      ids.add(capability.id);
    }
    // The level set is closed: nothing else, no "planning-only" level exists.
    expect([...CAPABILITY_READINESS_LEVELS].sort()).toEqual(
      ['certified', 'needs-setup', 'preview', 'working'],
    );
  });

  // (a) + (c): every capability an advertised surface names appears in the
  // registry with a declared level, and the noun is genuinely present in the
  // advertised copy (so the pin never passes vacuously).
  test('every advertised capability noun resolves to a registry entry', () => {
    const advertisedText = ADVERTISED_SURFACE_SOURCES.map(readSource).join('\n');
    const missingFromCopy: string[] = [];
    const missingFromRegistry: string[] = [];
    for (const [noun, capabilityId] of ADVERTISED_CAPABILITY_NOUNS) {
      if (!advertisedText.toLowerCase().includes(noun.toLowerCase())) {
        missingFromCopy.push(noun);
      }
      const capability = getCapabilityByAdvertisedName(noun);
      if (!capability || capability.id !== capabilityId) {
        missingFromRegistry.push(`${noun} -> ${capability?.id ?? 'none'} (expected ${capabilityId})`);
      }
    }
    expect(missingFromCopy).toEqual([]);
    expect(missingFromRegistry).toEqual([]);
  });

  // (b): every `certified` entry maps to a real live-verification scenario id
  // that passed in the current committed report; no other level carries a
  // scenario id.
  test('certified capabilities map to a live-verification scenario that passed', () => {
    const reportPath = join(REPO_ROOT, 'release', 'live-verification', 'live-verification.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
      checks: ReadonlyArray<{ id: string; status: string }>;
    };
    const passedScenarioIds = new Set(
      report.checks.filter((check) => check.status === 'pass').map((check) => check.id),
    );

    for (const capability of CAPABILITY_REGISTRY) {
      if (capability.level === 'certified') {
        expect(capability.scenarioId).toBeDefined();
        expect(LIVE_VERIFICATION_SCENARIO_IDS).toContain(capability.scenarioId!);
        expect(passedScenarioIds.has(capability.scenarioId!)).toBe(true);
      } else {
        // Only certified entries may claim a live scenario.
        expect(capability.scenarioId).toBeUndefined();
      }
    }
  });

  // The onboarding copy renders the level FROM the registry rather than
  // hand-writing a duplicate claim.
  test('onboarding copy renders each capability readiness level from the registry', () => {
    const voiceMedia = AGENT_WORKSPACE_ONBOARDING_DETAIL_CATEGORIES.find(
      (category) => category.id === 'onboarding-voice-media',
    );
    expect(voiceMedia).toBeDefined();

    const readinessLine = renderCapabilityReadinessLine('onboarding-voice-media');
    expect(readinessLine).toContain('Readiness:');
    // The rendered line, not a hand-written string, is what the surface shows.
    expect(voiceMedia!.detail).toContain(readinessLine);

    // Voice is needs-setup and must render with that plain label.
    expect(readinessLine).toContain(`Voice controls (${capabilityReadinessUserLabel('needs-setup')})`);

    // Certified Agent Knowledge renders its verified-live label on its surface.
    const contextLine = renderCapabilityReadinessLine('onboarding-context');
    expect(contextLine).toContain(`Agent Knowledge (${capabilityReadinessUserLabel('certified')})`);
  });
});
