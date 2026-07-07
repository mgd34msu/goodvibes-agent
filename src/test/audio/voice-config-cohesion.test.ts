/**
 * Regression guard: platform voice-config cohesion (VOICE-AGENT-PARITY).
 *
 * Mike's ruling #6 ("tts works well in all areas" + "one shared voice
 * config") requires that the Agent's spoken-output pipeline read the SAME
 * tts.* config contract every other surface (TUI, daemon, and — once built —
 * the web UI) reads, rather than a private Agent-only voice-config schema
 * that could silently drift out of shape.
 *
 * This suite locks that in three ways:
 *  1. The tts.* keys the Agent's audio pipeline actually reads (tts.provider,
 *     tts.voice, and tts.speed inside the SDK-owned SpokenTurnController that
 *     spoken-turn-wiring.ts constructs, plus tts.llmProvider/tts.llmModel in
 *     spoken-turn-model-routing.ts and tts.provider/tts.voice in
 *     tts-settings-actions.ts) exist in the SDK's shared CONFIG_SCHEMA with
 *     the shared defaults — not a schema the Agent invented for itself.
 *  2. A real ConfigManager, constructed the exact way the Agent's entrypoint
 *     constructs it (surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT, a fresh temp
 *     home directory, no local overrides on disk), resolves tts.* to those
 *     same shared defaults out of the box.
 *  3. The source files that read/write tts.* import ConfigManager's type
 *     from the shared SDK package, not a local reimplementation — so a
 *     future change can't quietly introduce an Agent-local voice-config
 *     silo without this test's import-scan catching it.
 *
 * See docs/voice-and-live-tts.md ("Platform Voice-Config Cohesion") for the
 * accompanying rulings: local (non-daemon) synthesis stays local so the
 * Agent keeps working offline, and mic/STT input is an honest no-op (the
 * web UI owns mic input per the VOICE-WEBUI brief).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigManager, CONFIG_SCHEMA, DEFAULT_CONFIG, isValidConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';

/** The exact tts.* keys the Agent's spoken-output pipeline reads today. */
const AGENT_VOICE_CONFIG_KEYS = [
  'tts.provider',
  'tts.voice',
  'tts.speed',
  'tts.llmProvider',
  'tts.llmModel',
] as const;

/**
 * Source files in the Agent that read or write tts.* config, or that carry a
 * ConfigManager down into the SDK-owned SpokenTurnController (which reads
 * tts.provider/tts.voice/tts.speed itself — see @pellux/goodvibes-sdk's own
 * voice-config coverage for that half of the contract).
 */
const AGENT_VOICE_CONFIG_READERS = [
  'src/audio/spoken-turn-wiring.ts',
  'src/audio/spoken-turn-model-routing.ts',
  'src/input/tts-settings-actions.ts',
] as const;

describe('Voice config cohesion — Agent reads the shared tts.* contract, not a private silo', () => {
  test('every tts.* key the Agent reads is a valid key in the shared SDK config schema', () => {
    for (const key of AGENT_VOICE_CONFIG_KEYS) {
      expect(isValidConfigKey(key)).toBe(true);
    }
  });

  test('the shared schema defines exactly the tts.* keys the Agent depends on (no fewer)', () => {
    const schemaTtsKeys = CONFIG_SCHEMA.map((setting) => setting.key).filter((key) => key.startsWith('tts.'));
    for (const key of AGENT_VOICE_CONFIG_KEYS) {
      expect(schemaTtsKeys).toContain(key);
    }
  });

  test('the shared schema default values match the platform default voice posture', () => {
    // These are the SDK's schema-domain-core.ts defaults — asserted here so
    // an unnoticed change to the shared defaults is caught from the Agent
    // side too, not only from the SDK's own suite.
    expect(DEFAULT_CONFIG.tts.provider).toBe('elevenlabs');
    expect(DEFAULT_CONFIG.tts.voice).toBe('');
    expect(DEFAULT_CONFIG.tts.llmProvider).toBe('');
    expect(DEFAULT_CONFIG.tts.llmModel).toBe('');
    expect(DEFAULT_CONFIG.tts.speed).toBe(1.0);
  });

  test('a fresh ConfigManager built the way the Agent entrypoint builds it resolves tts.* to the shared defaults', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-voice-cohesion-'));
    try {
      // Same constructor shape as src/cli/entrypoint.ts: surfaceRoot is the
      // Agent's own ('agent'), homeDir is fresh with nothing pre-configured.
      const configManager = new ConfigManager({
        homeDir,
        surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
      });

      // No Agent-only override baked into construction: the values that
      // come back are the platform's shared defaults, identical to what a
      // fresh TUI or daemon ConfigManager would report for the same keys.
      expect(configManager.get('tts.provider')).toBe(DEFAULT_CONFIG.tts.provider);
      expect(configManager.get('tts.voice')).toBe(DEFAULT_CONFIG.tts.voice);
      expect(configManager.get('tts.speed')).toBe(DEFAULT_CONFIG.tts.speed);
      expect(configManager.get('tts.llmProvider')).toBe(DEFAULT_CONFIG.tts.llmProvider);
      expect(configManager.get('tts.llmModel')).toBe(DEFAULT_CONFIG.tts.llmModel);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test('tts.* keys round-trip through the standard ConfigManager set/get API — no special-cased voice-config path', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-voice-cohesion-'));
    try {
      const configManager = new ConfigManager({
        homeDir,
        surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
      });

      configManager.set('tts.provider', 'openai');
      configManager.set('tts.voice', 'alloy');
      configManager.set('tts.speed', 1.25);
      configManager.set('tts.llmProvider', 'anthropic');
      configManager.set('tts.llmModel', 'claude-haiku-4-5');

      expect(configManager.get('tts.provider')).toBe('openai');
      expect(configManager.get('tts.voice')).toBe('alloy');
      expect(configManager.get('tts.speed')).toBe(1.25);
      expect(configManager.get('tts.llmProvider')).toBe('anthropic');
      expect(configManager.get('tts.llmModel')).toBe('claude-haiku-4-5');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test('the Agent files that read/write tts.* import ConfigManager from the shared SDK package, not a local reimplementation', () => {
    for (const relativePath of AGENT_VOICE_CONFIG_READERS) {
      const source = readFileSync(join(import.meta.dir, '../../..', relativePath), 'utf-8');
      const importsSharedConfigManagerType = /from ['"]@pellux\/goodvibes-sdk\/platform\/config['"]/.test(source);
      expect(importsSharedConfigManagerType).toBe(true);

      // Guard against a future local shadow schema: a file that reads tts.*
      // must never also declare its own `{ key: 'tts....', ..., default: ... }`
      // schema-setting object — that would be exactly the private-silo
      // regression this suite exists to catch. (A plain type annotation like
      // `key: 'tts.llmProvider' | 'tts.llmModel'` on a function parameter is
      // fine and does not trip this — it has no nearby `default:`.)
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        if (!/key:\s*['"]tts\./.test(line)) return;
        const window = lines.slice(index, index + 6).join('\n');
        expect(window.includes('default:')).toBe(false);
      });
    }
  });
});
