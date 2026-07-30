/**
 * Behaviour verification for the `voice.wake.*` settings.
 *
 * The bar every test here has to clear: drive the setting to two clearly
 * different values, run the code that actually consumes it, and assert that the
 * OUTCOME differs. A test that would still pass if the consuming code ignored
 * the setting is not evidence of anything, so nothing below asserts a default,
 * a description, a schema row, or that a value survives a round trip through
 * ConfigManager.
 *
 * Values are read from the shipped CONFIG_SCHEMA rows rather than hardcoded, so
 * each test drives the setting a user actually gets, and the second value in
 * every pair is derived from it. The one bridge assertion — that the detector's and
 * supervisor's own defaults equal the shipped config defaults — is what makes
 * "drive the detector with the config default" mean the same thing as "drive
 * the shipped setting"; it sits beside real behaviour, never in place of it.
 *
 * Nothing here opens a microphone, spawns a real recorder, or reads a real clock.
 * Time is injected, audio is synthetic, the recorder subprocess is a fake under
 * test control, and the inference sessions are stubs that replay scripted scores.
 * The only filesystem writes are into a per-test temp root, for the one row whose
 * whole subject is a file being written (`voice.wake.retainAudio`).
 *
 * THE CAPTURE-SIDE ROWS ARE COVERED NOW, AND WHERE
 *
 * This file used to end by pinning `notOperable: no-runtime-wiring` and record
 * seventeen rows as honestly NOT COVERED, because nothing captured microphone
 * audio anywhere. That is no longer true: this surface has a capture host
 * (src/audio/capture.ts, src/audio/wake-runtime.ts, src/shell/voice-capture-shell.ts),
 * so `enabled`, `surfaces.agent`, `inputDevice`, `captureCommand`,
 * `noiseSuppression`, `vadThreshold`, `activationSound`, `activationSoundPath`,
 * `indicator`, `captureMaxSeconds`, `silenceStopMs`, `autoSubmit`, `retainAudio`
 * and `customModelDir` all reach real code here and are driven to two values
 * against it in "the capture host on this surface" below — through the REAL SDK
 * listener, the REAL capture opener and the REAL engine, over an injected recorder
 * subprocess and stub inference sessions.
 *
 * STILL NOT COVERED, DELIBERATELY:
 *
 *   - `surfaces.tui` and `surfaces.webui` — other surfaces' delivery rows. This
 *     repository resolves settings for `agent` and nothing here reads either one;
 *     a test would be asserting the terminal's behaviour from the Agent's suite.
 *   - `browserBackend` — chooses a WASM or WebGPU execution provider inside a
 *     browser tab. There is no tab here, and this surface's inference runtime pins
 *     `wasm` because it is a host process, so no value of the row changes anything
 *     this repo does.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  WAKE_CHUNK_SAMPLES,
  WAKE_CLASSIFIER_FRAMES,
  WAKE_DETECTOR_DEFAULTS,
  WAKE_EMBED_DIM,
  WAKE_SAMPLE_RATE,
  WAKE_SUPERVISOR_DEFAULTS,
  WakeDetector,
  WakeSupervisor,
  WakeWordEngine,
  type WakeDetection,
  type WakeDetectorTuning,
  type WakeFrameOutcome,
  type WakeInferenceSession,
  type WakeRestartDecision,
  type WakeTensor,
} from '@pellux/goodvibes-sdk/platform/voice';
import {
  resolveManagedWakePaths,
  retainedClipFileName,
  type CaptureChildProcess,
  type UtteranceAudioArtifact,
} from '@pellux/goodvibes-sdk/platform/voice';
import { createAgentCaptureOpener } from '../../audio/capture.ts';
import { startWakeRuntime, wireWakeRuntime, type WakeRuntime, type WakeRuntimeDeps } from '../../audio/wake-runtime.ts';
import { voiceCaptureRowVisible } from '../../core/voice-capture-status.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';
import { CONFIG_SCHEMA, type ConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import {
  FEATURE_SETTINGS_BINDINGS,
  deriveFeatureState,
  featureInoperability,
  isFeatureGateEnabled,
} from '@pellux/goodvibes-sdk/platform/runtime/feature-flags';

/**
 * The numeric default a user gets for `key`, read from the shipped schema.
 *
 * Read rather than hardcoded so every "at the default" case below drives the
 * value actually in the product. (DEFAULT_CONFIG would be the more direct
 * route, but the SDK's `voice` config augmentation is declared in a domain
 * module that its published typings never pull in, so `DEFAULT_CONFIG.voice`
 * does not typecheck for a consumer — worth fixing in the SDK, not worth
 * casting around here.)
 */
function shippedNumber(key: ConfigKey): number {
  const row = CONFIG_SCHEMA.find((entry) => entry.key === key);
  if (typeof row?.default !== 'number') {
    throw new Error(`${key} has no shipped numeric default to drive`);
  }
  return row.default;
}

/** The settings as a user gets them. */
const WAKE = {
  threshold: shippedNumber('voice.wake.threshold'),
  patienceFrames: shippedNumber('voice.wake.patienceFrames'),
  cooldownMs: shippedNumber('voice.wake.cooldownMs'),
  preRollMs: shippedNumber('voice.wake.preRollMs'),
  maxRestarts: shippedNumber('voice.wake.maxRestarts'),
  restartBackoffMs: shippedNumber('voice.wake.restartBackoffMs'),
  crashWindowSeconds: shippedNumber('voice.wake.crashWindowSeconds'),
} as const;

// ---------------------------------------------------------------------------
// Stubs and helpers
// ---------------------------------------------------------------------------

/**
 * Stand-in for the speech-embedding backbone. Shape-correct and content-free:
 * every test below decides what the CLASSIFIER emits, so the embedding only has
 * to keep the pipeline moving.
 */
function stubEmbedding(): WakeInferenceSession {
  return {
    inputNames: ['input_1'],
    outputNames: ['embedding'],
    run: async () => ({
      embedding: { data: new Float32Array(WAKE_EMBED_DIM).fill(0.5), dims: [1, 1, 1, WAKE_EMBED_DIM] },
    }),
  };
}

interface ScriptedClassifier extends WakeInferenceSession {
  /** How many times the engine actually scored this model. */
  calls: number;
}

/** A classifier stand-in that emits a scripted score per call, and counts calls. */
function scriptedClassifier(scores: readonly number[]): ScriptedClassifier {
  const session: ScriptedClassifier = {
    calls: 0,
    inputNames: ['input'],
    outputNames: ['score'],
    run: async (feeds: Readonly<Record<string, WakeTensor>>) => {
      // The window shape the real classifier is trained against; a pipeline that
      // stopped producing it would make every score below meaningless.
      expect(feeds['input']?.dims).toEqual([1, WAKE_CLASSIFIER_FRAMES, WAKE_EMBED_DIM]);
      const value = scores[session.calls] ?? 0;
      session.calls += 1;
      return { score: { data: Float32Array.from([value]), dims: [1, 1] } };
    },
  };
  return session;
}

/** A frame of silence. */
function silentFrame(): Float32Array {
  return new Float32Array(WAKE_CHUNK_SAMPLES);
}

/** A frame of audible tone, so pre-roll content can be told apart from zeros. */
function toneFrame(): Float32Array {
  return Float32Array.from({ length: WAKE_CHUNK_SAMPLES }, (_, i) => Math.sin(i / 8) * 4000);
}

interface ScriptedModel {
  readonly id: string;
  readonly scores: readonly number[];
  /** Per-model threshold override, when the test is exercising one. */
  readonly threshold?: number;
}

interface EngineRun {
  readonly detections: readonly WakeDetection[];
  /** Model id to the number of times its classifier was actually run. */
  readonly calls: ReadonlyMap<string, number>;
}

/**
 * Run the real engine over scripted per-model score traces with an injected
 * clock, and report what came out.
 *
 * The front end needs 16 frames before it can score at all, so the loop runs
 * `trace + 15` frames to replay a trace of length `trace` exactly.
 */
async function driveEngine(
  models: readonly ScriptedModel[],
  options: {
    readonly tuning?: Partial<WakeDetectorTuning>;
    readonly preRollMs?: number;
    readonly audio?: Float32Array;
  } = {},
): Promise<EngineRun> {
  const sessions = new Map<string, ScriptedClassifier>();
  for (const model of models) sessions.set(model.id, scriptedClassifier(model.scores));
  let clock = 0;
  const engine = new WakeWordEngine({
    embedding: stubEmbedding(),
    models: models.map((model) => {
      const session = sessions.get(model.id);
      if (session === undefined) throw new Error(`no session built for ${model.id}`);
      return model.threshold === undefined
        ? { id: model.id, session }
        : { id: model.id, session, threshold: model.threshold };
    }),
    tuning: options.tuning,
    preRollMs: options.preRollMs,
    now: () => clock,
  });
  const longest = models.reduce((max, model) => Math.max(max, model.scores.length), 0);
  const detections: WakeDetection[] = [];
  for (let i = 0; i < longest + WAKE_CLASSIFIER_FRAMES - 1; i += 1) {
    clock += 80;
    const result = await engine.pushFrame(options.audio ?? silentFrame());
    detections.push(...result.detections);
  }
  const calls = new Map<string, number>();
  for (const [id, session] of sessions) calls.set(id, session.calls);
  return { detections, calls };
}

/* Narrowing helpers — TypeScript strict, no casts, no `any`. */

function asFired(outcome: WakeFrameOutcome): Extract<WakeFrameOutcome, { kind: 'fired' }> {
  if (outcome.kind !== 'fired') throw new Error(`expected a fired frame, got "${outcome.kind}"`);
  return outcome;
}

function asBuilding(outcome: WakeFrameOutcome): Extract<WakeFrameOutcome, { kind: 'building' }> {
  if (outcome.kind !== 'building') throw new Error(`expected a building frame, got "${outcome.kind}"`);
  return outcome;
}

function asCooldown(outcome: WakeFrameOutcome): Extract<WakeFrameOutcome, { kind: 'cooldown' }> {
  if (outcome.kind !== 'cooldown') throw new Error(`expected a suppressed frame, got "${outcome.kind}"`);
  return outcome;
}

function asRestart(decision: WakeRestartDecision): Extract<WakeRestartDecision, { kind: 'restart' }> {
  if (decision.kind !== 'restart') throw new Error(`expected a restart, got "${decision.kind}"`);
  return decision;
}

function asLatched(decision: WakeRestartDecision): Extract<WakeRestartDecision, { kind: 'latched' }> {
  if (decision.kind !== 'latched') throw new Error(`expected a latch, got "${decision.kind}"`);
  return decision;
}

/** A detector wired from the shipped settings, with named overrides. */
function detectorFromSettings(overrides: Partial<WakeDetectorTuning> = {}): WakeDetector {
  return new WakeDetector({
    threshold: WAKE.threshold,
    patienceFrames: WAKE.patienceFrames,
    cooldownMs: WAKE.cooldownMs,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------

describe('the voice.wake tuning rows drive the detector', () => {
  test('the detector and supervisor defaults ARE the shipped voice.wake defaults (bridge for the behaviour tests below)', () => {
    // Wiring, not behaviour — stated as such. Its only job is to make the
    // behaviour tests below, which drive DEFAULT_CONFIG values, equivalent to
    // driving the code's own defaults. If these ever diverge, a user changing
    // nothing gets different behaviour from a user who explicitly typed the
    // documented default, and every "at the default" assertion here would be
    // testing a value nobody runs.
    expect(WAKE_DETECTOR_DEFAULTS.threshold).toBe(WAKE.threshold);
    expect(WAKE_DETECTOR_DEFAULTS.patienceFrames).toBe(WAKE.patienceFrames);
    expect(WAKE_DETECTOR_DEFAULTS.cooldownMs).toBe(WAKE.cooldownMs);
    expect(WAKE_SUPERVISOR_DEFAULTS.maxRestarts).toBe(WAKE.maxRestarts);
    expect(WAKE_SUPERVISOR_DEFAULTS.restartBackoffMs).toBe(WAKE.restartBackoffMs);
    expect(WAKE_SUPERVISOR_DEFAULTS.crashWindowSeconds).toBe(WAKE.crashWindowSeconds);
  });

  test('voice.wake.threshold: a score below the configured threshold does not fire, and the same score fires once the threshold is lowered', () => {
    const score = WAKE.threshold - 0.05;
    const lowered = WAKE.threshold - 0.4;
    // The whole point of the pair: one score, two settings, opposite outcomes.
    expect(score).toBeLessThan(WAKE.threshold);
    expect(score).toBeGreaterThan(lowered);

    const strict = detectorFromSettings({ patienceFrames: 1, cooldownMs: 0 });
    for (let frame = 0; frame < 5; frame += 1) {
      expect(strict.push(score, frame * 80).kind).toBe('idle');
    }

    const lenient = detectorFromSettings({ threshold: lowered, patienceFrames: 1, cooldownMs: 0 });
    expect(asFired(lenient.push(score, 0)).score).toBe(score);
  });

  test('voice.wake.threshold: the engine honours the configured threshold end to end, over the same scored audio', async () => {
    // A trace that clears 0.7 but never 0.9: it is the setting alone that
    // decides whether this audio is a wake.
    const trace = [0.2, 0.75, 0.78, 0.76, 0.2] as const;

    const atDefault = await driveEngine([{ id: 'hey_goodvibes', scores: trace }], {
      tuning: { threshold: WAKE.threshold, patienceFrames: 2, cooldownMs: 0 },
    });
    expect(atDefault.calls.get('hey_goodvibes')).toBe(trace.length);
    expect(atDefault.detections).toEqual([]);

    const lowered = await driveEngine([{ id: 'hey_goodvibes', scores: trace }], {
      tuning: { threshold: 0.7, patienceFrames: 2, cooldownMs: 0 },
    });
    expect(lowered.calls.get('hey_goodvibes')).toBe(trace.length);
    expect(lowered.detections.length).toBeGreaterThan(0);
    expect(lowered.detections[0]?.modelId).toBe('hey_goodvibes');
    expect(lowered.detections[0]?.peakScore).toBeGreaterThanOrEqual(0.7);
    expect(lowered.detections[0]?.peakScore).toBeLessThan(WAKE.threshold);
  });

  test('voice.wake.patienceFrames: the wake fires on exactly the configured number of consecutive above-threshold frames, no sooner', () => {
    const above = 0.99;
    for (const patienceFrames of [1, WAKE.patienceFrames, WAKE.patienceFrames + 3]) {
      const detector = detectorFromSettings({ patienceFrames, cooldownMs: 0 });
      for (let frame = 1; frame < patienceFrames; frame += 1) {
        const building = asBuilding(detector.push(above, frame * 80));
        expect(building.frames).toBe(frame);
        expect(building.needed).toBe(patienceFrames);
      }
      // The frame that completes the configured run, and not one before it.
      expect(asFired(detector.push(above, patienceFrames * 80)).frames).toBe(patienceFrames);
    }
  });

  test('voice.wake.patienceFrames: one below-threshold frame restarts the run, so a longer patience needs a longer clean run', () => {
    const patienceFrames = WAKE.patienceFrames + 1;
    const detector = detectorFromSettings({ patienceFrames, cooldownMs: 0 });
    for (let frame = 1; frame < patienceFrames; frame += 1) {
      expect(detector.push(0.99, frame * 80).kind).toBe('building');
    }
    // One bad frame immediately before the run would have completed.
    expect(detector.push(0.1, patienceFrames * 80).kind).toBe('idle');
    // The count restarted from zero, so the very next good frame cannot fire
    // unless patience is 1 — and at this setting it is not.
    for (let frame = 1; frame < patienceFrames; frame += 1) {
      expect(detector.push(0.99, (patienceFrames + frame) * 80).kind).toBe('building');
    }
    expect(asFired(detector.push(0.99, (patienceFrames * 2) * 80)).frames).toBe(patienceFrames);
  });

  test('voice.wake.cooldownMs: a second wake inside the configured cooldown is suppressed and fires again the moment it lapses', () => {
    const detector = detectorFromSettings({ patienceFrames: 1 });
    expect(detector.push(0.99, 0).kind).toBe('fired');

    // One millisecond short of the configured window: suppressed, and the
    // remaining time is the configured window minus the elapsed time.
    const suppressed = asCooldown(detector.push(0.99, WAKE.cooldownMs - 1));
    expect(suppressed.remainingMs).toBe(1);
    expect(detector.cooldownRemaining(WAKE.cooldownMs - 1)).toBe(1);

    // Exactly at the window: allowed again.
    expect(detector.push(0.99, WAKE.cooldownMs).kind).toBe('fired');
  });

  test('voice.wake.cooldownMs: 0 lets consecutive confirmed frames fire, while a longer window suppresses for exactly that long', () => {
    const noCooldown = detectorFromSettings({ patienceFrames: 1, cooldownMs: 0 });
    expect(noCooldown.push(0.99, 0).kind).toBe('fired');
    expect(noCooldown.push(0.99, 80).kind).toBe('fired');
    expect(noCooldown.push(0.99, 160).kind).toBe('fired');

    const longCooldown = detectorFromSettings({ patienceFrames: 1, cooldownMs: 10_000 });
    expect(longCooldown.push(0.99, 0).kind).toBe('fired');
    // Same timestamps as above, opposite outcome, and the remaining time tracks
    // the configured value rather than any built-in one.
    expect(asCooldown(longCooldown.push(0.99, 80)).remainingMs).toBe(10_000 - 80);
    expect(asCooldown(longCooldown.push(0.99, 160)).remainingMs).toBe(10_000 - 160);
    expect(longCooldown.cooldownRemaining(10_000)).toBe(0);
  });

  test('voice.wake.preRollMs: a detection carries the configured milliseconds of audio from before it fired', async () => {
    for (const preRollMs of [WAKE.preRollMs, 100]) {
      const run = await driveEngine([{ id: 'hey_goodvibes', scores: [0.99, 0.99] }], {
        tuning: { threshold: WAKE.threshold, patienceFrames: 2, cooldownMs: 0 },
        preRollMs,
        audio: toneFrame(),
      });
      const detection = run.detections[0];
      expect(detection).toBeDefined();
      // 16 kHz mono: the sample count is the configured milliseconds of audio.
      expect(detection?.preRoll.length).toBe(Math.floor((preRollMs / 1000) * WAKE_SAMPLE_RATE));
      // Real captured audio, not a zero-filled buffer of the right size.
      expect(detection?.preRoll.some((sample) => sample !== 0)).toBe(true);
    }
  });

  test('voice.wake.preRollMs: 0 hands back no pre-roll audio at all', async () => {
    const run = await driveEngine([{ id: 'hey_goodvibes', scores: [0.99, 0.99] }], {
      tuning: { threshold: WAKE.threshold, patienceFrames: 2, cooldownMs: 0 },
      preRollMs: 0,
      audio: toneFrame(),
    });
    const detection = run.detections[0];
    expect(detection).toBeDefined();
    expect(detection?.preRoll.length).toBe(0);
  });
});

describe('the voice.wake.models list decides what is scored', () => {
  /*
   * The comma-separated string is split by parseWakeModelList, which the SDK
   * does not expose through any package subpath, so it cannot be called from
   * this repo. What IS reachable and what actually changes behaviour is the
   * resulting list: these tests drive the engine with the list an empty
   * setting produces, the list the default single-id setting produces, and the
   * list a two-id setting produces, and assert the engine's output differs.
   */

  test('voice.wake.models: every id in the configured list is scored on every frame, each with its own detector', async () => {
    const run = await driveEngine(
      [
        { id: 'hey_goodvibes', scores: [0.99, 0.99, 0.99, 0.99] },
        { id: 'custom_phrase', scores: [0.1, 0.1, 0.1, 0.1] },
      ],
      { tuning: { threshold: WAKE.threshold, patienceFrames: WAKE.patienceFrames, cooldownMs: 0 } },
    );
    // Listing a second model costs a second classifier run per frame — that is
    // the observable difference between a one-id and a two-id setting.
    expect(run.calls.get('hey_goodvibes')).toBe(4);
    expect(run.calls.get('custom_phrase')).toBe(4);
    // And the runs are independent: the quiet model never fires.
    expect(new Set(run.detections.map((detection) => detection.modelId))).toEqual(new Set(['hey_goodvibes']));
    expect(run.detections.length).toBeGreaterThan(0);
  });

  test('voice.wake.models: a wake on one configured model does not mask a wake on another', async () => {
    const run = await driveEngine(
      [
        { id: 'hey_goodvibes', scores: [0.99, 0.99] },
        { id: 'hey_operator', scores: [0.99, 0.99] },
      ],
      { tuning: { threshold: WAKE.threshold, patienceFrames: 2, cooldownMs: WAKE.cooldownMs } },
    );
    // Both fire on the same frame; a single shared cooldown would drop one.
    expect(run.detections.map((detection) => detection.modelId)).toEqual(['hey_goodvibes', 'hey_operator']);
  });

  test('voice.wake.models: an empty configured list scores nothing, so no classifier runs and nothing can fire', async () => {
    const wouldHaveFired = scriptedClassifier([0.99, 0.99, 0.99, 0.99]);
    let clock = 0;
    const engine = new WakeWordEngine({ embedding: stubEmbedding(), models: [], now: () => clock });
    expect(engine.modelIds).toEqual([]);
    for (let frame = 0; frame < WAKE_CLASSIFIER_FRAMES + 4; frame += 1) {
      clock += 80;
      const result = await engine.pushFrame(silentFrame());
      expect(result.detections).toEqual([]);
      expect(result.scores.size).toBe(0);
    }
    expect(wouldHaveFired.calls).toBe(0);

    // The same audio and the same scores, with the model listed, does fire —
    // so the empty result above is the setting, not the harness.
    const listed = await driveEngine([{ id: 'hey_goodvibes', scores: [0.99, 0.99, 0.99, 0.99] }], {
      tuning: { threshold: WAKE.threshold, patienceFrames: WAKE.patienceFrames, cooldownMs: 0 },
    });
    expect(listed.detections.length).toBeGreaterThan(0);
  });

  test('voice.wake.models: a per-model threshold overrides voice.wake.threshold for that model alone', async () => {
    const scores = [0.75, 0.78, 0.76] as const;
    const run = await driveEngine(
      [
        { id: 'pinned', scores },
        { id: 'custom_at_own_operating_point', scores, threshold: 0.7 },
      ],
      { tuning: { threshold: WAKE.threshold, patienceFrames: 2, cooldownMs: 0 } },
    );
    // Identical scores, identical shared threshold, different outcomes: only
    // the model carrying its own operating point fires.
    expect(new Set(run.detections.map((detection) => detection.modelId)))
      .toEqual(new Set(['custom_at_own_operating_point']));
  });
});

describe('the voice.wake supervisor rows bound a crashing detector', () => {
  test('voice.wake.maxRestarts: the supervisor allows exactly the configured number of restarts and then latches off', () => {
    for (const maxRestarts of [0, 1, WAKE.maxRestarts]) {
      const supervisor = new WakeSupervisor({
        maxRestarts,
        restartBackoffMs: WAKE.restartBackoffMs,
        crashWindowSeconds: WAKE.crashWindowSeconds,
      });
      for (let attempt = 1; attempt <= maxRestarts; attempt += 1) {
        const decision = asRestart(supervisor.noteCrashed(attempt * 1000));
        expect(decision.attempt).toBe(attempt);
        expect(supervisor.latched).toBe(false);
      }
      // One crash past the configured budget is terminal, and says so in words
      // a user reads rather than only a log line.
      const latched = asLatched(supervisor.noteCrashed((maxRestarts + 1) * 1000));
      expect(latched.crashes).toBe(maxRestarts + 1);
      expect(latched.reason).toContain(`limit ${maxRestarts}`);
      expect(supervisor.latched).toBe(true);
      expect(supervisor.state((maxRestarts + 2) * 1000).totalRestarts).toBe(maxRestarts);
    }
  });

  test('voice.wake.maxRestarts: clearing the latch restores the configured budget', () => {
    const supervisor = new WakeSupervisor({ maxRestarts: 1, restartBackoffMs: 0, crashWindowSeconds: 60 });
    expect(supervisor.noteCrashed(0).kind).toBe('restart');
    expect(supervisor.noteCrashed(1000).kind).toBe('latched');
    supervisor.clearLatch();
    expect(supervisor.latched).toBe(false);
    // One restart again, then latched again — the budget is the setting's, not
    // a one-off allowance.
    expect(asRestart(supervisor.noteCrashed(2000)).attempt).toBe(1);
    expect(supervisor.noteCrashed(3000).kind).toBe('latched');
  });

  test('voice.wake.restartBackoffMs: the restart delay is the configured base multiplied by the attempt number', () => {
    for (const restartBackoffMs of [WAKE.restartBackoffMs, 250, 0]) {
      const supervisor = new WakeSupervisor({ maxRestarts: 3, restartBackoffMs, crashWindowSeconds: 60 });
      const delays = [1, 2, 3].map((attempt) => asRestart(supervisor.noteCrashed(attempt * 100)).delayMs);
      expect(delays).toEqual([restartBackoffMs, restartBackoffMs * 2, restartBackoffMs * 3]);
    }
  });

  test('voice.wake.crashWindowSeconds: crashes older than the configured window stop counting toward the restart budget', () => {
    const gapMs = 11_000;

    // A short window forgets the first crash, so the second one is attempt 1
    // again and the detector is restarted.
    const shortWindow = new WakeSupervisor({ maxRestarts: 1, restartBackoffMs: 0, crashWindowSeconds: 10 });
    expect(asRestart(shortWindow.noteCrashed(0)).attempt).toBe(1);
    expect(asRestart(shortWindow.noteCrashed(gapMs)).attempt).toBe(1);
    expect(shortWindow.latched).toBe(false);
    expect(shortWindow.state(gapMs).recentCrashes).toBe(1);
    expect(shortWindow.state(gapMs).totalCrashes).toBe(2);

    // Identical crash timestamps, longer window: both crashes still count, the
    // budget is spent, and the supervisor latches off.
    const longWindow = new WakeSupervisor({
      maxRestarts: 1,
      restartBackoffMs: 0,
      crashWindowSeconds: WAKE.crashWindowSeconds,
    });
    expect(asRestart(longWindow.noteCrashed(0)).attempt).toBe(1);
    expect(asLatched(longWindow.noteCrashed(gapMs)).crashes).toBe(2);
    expect(longWindow.latched).toBe(true);
    expect(longWindow.state(gapMs).recentCrashes).toBe(2);
  });

  test('voice.wake.crashWindowSeconds: the reported crash count ages out on the configured window, not a fixed one', () => {
    const shortWindow = new WakeSupervisor({ maxRestarts: 5, restartBackoffMs: 0, crashWindowSeconds: 10 });
    shortWindow.noteCrashed(0);
    shortWindow.noteCrashed(1000);
    expect(shortWindow.state(1000).recentCrashes).toBe(2);
    // Past the configured window, the status surface reports a clean detector.
    expect(shortWindow.state(20_000).recentCrashes).toBe(0);

    const longWindow = new WakeSupervisor({ maxRestarts: 5, restartBackoffMs: 0, crashWindowSeconds: 600 });
    longWindow.noteCrashed(0);
    longWindow.noteCrashed(1000);
    // Same timestamps, same query time, different answer.
    expect(longWindow.state(20_000).recentCrashes).toBe(2);
  });
});

describe('the wake capability is operable on this surface', () => {
  test('voice.wake.enabled derives the capability state from the row, with no blanket not-operable declaration in the way', () => {
    // The inverse of the assertion this test used to make. While nothing captured
    // audio, `deriveFeatureState` hard-returned 'disabled' for both values and the
    // gate refused the capability outright. Capture exists here now, so the row
    // decides the state — and `featureInoperability` must be null, because a
    // blanket "not available in this build" declaration re-added over a working
    // capture host would be a lie shown at every settings surface.
    const binding = FEATURE_SETTINGS_BINDINGS.find((entry) => entry.key === 'voice.wake.enabled');
    if (binding === undefined) throw new Error('voice.wake.enabled has no feature-settings binding');
    expect(binding.featureId).toBe('wake-word-detection');

    expect(deriveFeatureState(binding, true)).toBe('enabled');
    expect(deriveFeatureState(binding, false)).toBe('disabled');
    expect(isFeatureGateEnabled({ isEnabled: (): boolean => true }, 'wake-word-detection')).toBe(true);
    expect(featureInoperability('wake-word-detection')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The capture host on this surface.
//
// Everything below drives a `voice.wake.*` row to two values through the REAL
// pieces — the SDK listener and engine, the SDK capture opener, this surface's
// wake runtime — with only two things faked: the recorder subprocess and the
// inference sessions. No microphone is opened, no recorder is spawned, no model
// file is read, no clock is real.
//
// The rule these are built around: a row that the consuming code stopped reading
// must break a test here. Where a row's outcome is only observable as "a device
// was or was not opened", the assertion is on the spawn log, which is the closest
// thing to the microphone itself that a test can hold.
// ---------------------------------------------------------------------------

type DataListener = (chunk: Uint8Array) => void;
type CloseListener = (code: number | null, signal: string | null) => void;

/**
 * A recorder subprocess under test control. Mirrors what the SDK's capture opener
 * actually consumes: stdout data, stderr data, 'error', 'close', kill.
 */
class FakeRecorder implements CaptureChildProcess {
  readonly killSignals: string[] = [];
  private readonly dataListeners: DataListener[] = [];
  private readonly stderrListeners: DataListener[] = [];
  private readonly errorListeners: Array<(error: Error) => void> = [];
  private readonly closeListeners: CloseListener[] = [];
  private closed = false;

  readonly stdout = { on: (_event: 'data', listener: DataListener): unknown => { this.dataListeners.push(listener); return this; } };
  readonly stderr = { on: (_event: 'data', listener: DataListener): unknown => { this.stderrListeners.push(listener); return this; } };

  on(event: 'error' | 'close', listener: (...args: never[]) => void): unknown {
    if (event === 'error') this.errorListeners.push(listener as unknown as (error: Error) => void);
    else this.closeListeners.push(listener as unknown as CloseListener);
    return this;
  }

  kill(signal?: string): unknown {
    this.killSignals.push(signal ?? 'SIGTERM');
    // A real recorder exits on SIGTERM; emitting on a microtask (not synchronously)
    // matches that ordering and lets the SDK's bounded stop() settle immediately
    // instead of waiting out its escalation timer.
    void Promise.resolve().then(() => this.emitClose(0));
    return true;
  }

  /** Test control: the recorder wrote raw PCM to stdout. */
  emitBytes(bytes: Uint8Array): void {
    for (const listener of [...this.dataListeners]) listener(bytes);
  }

  /** Test control: the recorder wrote a diagnostic to stderr. */
  emitStderr(text: string): void {
    const bytes = new TextEncoder().encode(text);
    for (const listener of [...this.stderrListeners]) listener(bytes);
  }

  /** Test control: the recorder exited. */
  emitClose(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of [...this.closeListeners]) listener(code, null);
  }
}

/** A spawn factory that records every call and hands back fakes. */
function recordingSpawn(): {
  readonly spawn: (command: string, args: readonly string[]) => CaptureChildProcess;
  readonly calls: Array<{ command: string; args: readonly string[] }>;
  readonly processes: FakeRecorder[];
} {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const processes: FakeRecorder[] = [];
  return {
    calls,
    processes,
    spawn: (command, args) => {
      calls.push({ command, args });
      const proc = new FakeRecorder();
      processes.push(proc);
      return proc;
    },
  };
}

/** Encode int16 magnitudes as the little-endian PCM a recorder writes. */
function pcmBytes(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

/** A run of loud audio — well above the SDK's silence floor. */
function loudSamples(count: number, seed = 1): number[] {
  return Array.from({ length: count }, (_unused, index) => (index % 2 === 0 ? 9000 + seed : -9000 - seed));
}

/** A run of silence. */
function silentSamples(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}

/** Let the listener's promise chain (framing -> inference -> handlers) settle. */
async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A classifier stand-in that scores from a script and HOLDS the last value once
 * the script runs out, so a test says exactly when a wake confirms and then stops
 * having to think about frame counts.
 */
function holdingClassifier(scores: readonly number[]): WakeInferenceSession {
  let index = 0;
  return {
    inputNames: ['onnx::Flatten_0'],
    outputNames: ['output'],
    run: async (): Promise<Readonly<Record<string, WakeTensor>>> => {
      const score = scores[Math.min(index, scores.length - 1)] ?? 0;
      index += 1;
      return { output: { data: Float32Array.from([score]), dims: [1, 1] } };
    },
  };
}

/** A config source backed by a plain map, with the subscription the runtime uses. */
function configSource(overrides: Readonly<Record<string, unknown>>): {
  readonly read: (key: string) => unknown;
  readonly subscribe: (key: string, listener: () => void) => () => void;
  readonly set: (key: string, value: unknown) => void;
} {
  const values = new Map<string, unknown>(Object.entries(overrides));
  const listeners = new Map<string, Array<() => void>>();
  return {
    read: (key) => values.get(key),
    subscribe: (key, listener) => {
      const list = listeners.get(key) ?? [];
      list.push(listener);
      listeners.set(key, list);
      return () => { listeners.set(key, (listeners.get(key) ?? []).filter((entry) => entry !== listener)); };
    },
    set: (key, value) => {
      values.set(key, value);
      for (const listener of [...(listeners.get(key) ?? [])]) listener();
    },
  };
}

/** The rows a listening detector needs, so each test overrides only its own. */
const LISTENING_CONFIG: Readonly<Record<string, unknown>> = {
  'voice.wake.enabled': true,
  'voice.wake.surfaces.agent': true,
  'voice.wake.models': 'hey_goodvibes',
  'voice.wake.threshold': 0.9,
  'voice.wake.patienceFrames': 2,
  'voice.wake.cooldownMs': 2000,
  'voice.wake.silenceStopMs': 400,
  'voice.wake.captureMaxSeconds': 4,
  'voice.wake.preRollMs': 200,
  'voice.wake.autoSubmit': false,
  'voice.wake.activationSound': 'chime',
  'voice.wake.indicator': 'statusline',
  'voice.wake.maxRestarts': 1,
  'voice.wake.restartBackoffMs': 100,
  'voice.wake.crashWindowSeconds': 60,
};

interface CaptureHarness {
  readonly runtime: WakeRuntime;
  readonly spawns: ReturnType<typeof recordingSpawn>;
  readonly config: ReturnType<typeof configSource>;
  readonly notices: string[];
  readonly drafts: string[];
  readonly submitted: string[];
  readonly sounds: readonly { kind: string; path: string }[];
  readonly transcribed: UtteranceAudioArtifact[];
  readonly timers: Array<{ handler: () => void; ms: number }>;
  readonly loadedModelPaths: string[];
  now: number;
}

interface CaptureHarnessOptions {
  readonly config?: Readonly<Record<string, unknown>>;
  readonly scores?: readonly number[];
  readonly transcript?: string;
  /** Rejects transcription with this message instead of resolving. */
  readonly transcribeError?: string;
  /** Reports the models as absent, the way a fresh host does. */
  readonly notProvisioned?: boolean;
  /** No transcription available at all — the honest refusal path. */
  readonly noTranscriber?: string;
  /** Which recorders the PATH scan should claim are installed. */
  readonly installed?: readonly string[];
  readonly managedRoot?: string;
}

function makeCaptureHarness(options: CaptureHarnessOptions = {}): CaptureHarness {
  const spawns = recordingSpawn();
  const config = configSource({ ...LISTENING_CONFIG, ...options.config });
  const notices: string[] = [];
  const drafts: string[] = [];
  const submitted: string[] = [];
  const sounds: { kind: string; path: string }[] = [];
  const transcribed: UtteranceAudioArtifact[] = [];
  const timers: Array<{ handler: () => void; ms: number }> = [];
  const loadedModelPaths: string[] = [];
  const classifier = holdingClassifier(options.scores ?? [0]);
  const embedding = stubEmbedding();
  const harness: Partial<CaptureHarness> & { now: number } = { now: 1_000_000 };

  const deps: WakeRuntimeDeps = {
    readConfig: config.read,
    subscribeConfig: config.subscribe,
    // The REAL capture opener over an injected spawn: the probe order, the argv
    // and the exit handling under test are the shipped ones.
    openCapture: createAgentCaptureOpener({
      spawn: spawns.spawn,
      isInstalled: (command) => options.installed === undefined || options.installed.includes(command),
      platform: 'linux',
      speexAvailable: false,
    }),
    managedRoot: options.managedRoot ?? '/nonexistent-managed-root',
    assetDirectory: '/nonexistent-asset-dir',
    speexAvailable: false,
    resolveTranscriber: () => (options.noTranscriber !== undefined
      ? { available: false as const, reason: options.noTranscriber }
      : {
        available: true as const,
        gateway: {
          transcribe: async (audio: UtteranceAudioArtifact) => {
            transcribed.push(audio);
            if (options.transcribeError !== undefined) throw new Error(options.transcribeError);
            return options.transcript ?? 'open the deploy log';
          },
        },
      }),
    playActivationSound: (sound) => { sounds.push({ kind: sound.kind, path: sound.path }); },
    submitTurn: (text) => { submitted.push(text); },
    writeDraft: (text) => { drafts.push(text); },
    notify: (message) => { notices.push(message); },
    render: () => { /* no renderer under test */ },
    sessionId: 'session-under-test',
    warn: () => { /* warnings are not the subject here */ },
    loadSession: async (modelPath: string) => {
      loadedModelPaths.push(modelPath);
      return modelPath.includes('speech-embedding') ? embedding : classifier;
    },
    provisionStatus: () => (options.notProvisioned === true
      ? { ready: false, reason: 'not-provisioned' }
      : { ready: true, reason: null }),
    now: () => harness.now,
    setTimeout: (handler, ms) => { timers.push({ handler, ms }); return timers.length; },
    clearTimeout: () => { /* fired manually */ },
  };

  return Object.assign(harness, {
    runtime: wireWakeRuntime(deps),
    spawns,
    config,
    notices,
    drafts,
    submitted,
    sounds,
    transcribed,
    timers,
    loadedModelPaths,
  }) as CaptureHarness;
}

/**
 * Feed enough frames to fill the SDK front end's window, so the frames after this
 * are the ones that actually get scored.
 */
async function primeFrontEnd(recorder: FakeRecorder): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    recorder.emitBytes(pcmBytes(loudSamples(WAKE_CHUNK_SAMPLES, i)));
    await flush(2);
  }
}

/** Start a listening harness and hand back its (single) recorder. */
async function startListening(harness: CaptureHarness): Promise<FakeRecorder> {
  await harness.runtime.refresh();
  const recorder = harness.spawns.processes[0];
  if (recorder === undefined) throw new Error(`no recorder was spawned; notices: ${harness.notices.join(' | ')}`);
  return recorder;
}

describe('voice.wake.enabled and voice.wake.surfaces.agent are a DOUBLE gate on the microphone', () => {
  test('voice.wake.enabled: false opens no device and spawns no process at all; true spawns a recorder', async () => {
    const off = makeCaptureHarness({ config: { 'voice.wake.enabled': false } });
    await off.runtime.refresh();
    expect(off.spawns.calls).toEqual([]);
    expect(off.runtime.status()).toBeNull();

    const on = makeCaptureHarness({ config: { 'voice.wake.enabled': true } });
    await on.runtime.refresh();
    expect(on.spawns.calls.length).toBe(1);
    expect(on.runtime.status()?.kind).toBe('wake-listening');
  });

  test('voice.wake.surfaces.agent: false opens no device even with the feature enabled; true opens one', async () => {
    const off = makeCaptureHarness({ config: { 'voice.wake.enabled': true, 'voice.wake.surfaces.agent': false } });
    await off.runtime.refresh();
    expect(off.spawns.calls).toEqual([]);
    expect(off.runtime.status()).toBeNull();
    // Not a silent no-op either way: the resolved settings say which row is off.
    expect(off.runtime.settings().enabled).toBe(true);
    expect(off.runtime.settings().surfaceEnabled).toBe(false);
    expect(off.runtime.settings().active).toBe(false);

    const on = makeCaptureHarness({ config: { 'voice.wake.enabled': true, 'voice.wake.surfaces.agent': true } });
    await on.runtime.refresh();
    expect(on.spawns.calls.length).toBe(1);
    expect(on.runtime.settings().active).toBe(true);
  });

  test('the rows are read LIVE through the shipped subscription: flipping either one takes or releases the device', async () => {
    const harness = makeCaptureHarness({ config: { 'voice.wake.enabled': false } });
    // startWakeRuntime is exactly what main.ts installs, including WHICH rows it
    // subscribes to — a subscription pointed at another surface's row would leave
    // this test flipping a setting that changes nothing.
    const unsubs = startWakeRuntime(harness.runtime, { subscribeConfig: harness.config.subscribe });
    await flush();
    expect(harness.spawns.calls).toEqual([]);

    harness.config.set('voice.wake.enabled', true);
    await flush();
    expect(harness.spawns.calls.length).toBe(1);

    harness.config.set('voice.wake.surfaces.agent', false);
    await flush();
    expect(harness.spawns.processes[0]?.killSignals).toContain('SIGTERM');
    expect(harness.runtime.status()).toBeNull();

    harness.config.set('voice.wake.surfaces.agent', true);
    await flush();
    expect(harness.spawns.calls.length).toBe(2);

    harness.config.set('voice.wake.enabled', false);
    await flush();
    expect(harness.runtime.status()).toBeNull();
    // Still two: turning it off must not open a third device on the way down.
    expect(harness.spawns.calls.length).toBe(2);

    for (const unsub of unsubs) unsub();
    await harness.runtime.stop();
  });

  test('an enabled detector whose models are not provisioned says so and still opens nothing', async () => {
    const harness = makeCaptureHarness({ notProvisioned: true });
    await harness.runtime.refresh();
    expect(harness.spawns.calls).toEqual([]);
    expect(harness.notices.join('\n')).toContain('not provisioned');
    expect(harness.notices.join('\n')).toContain('/voice wake setup');
  });
});

describe('a confirmed wake lands in this surface\'s conversation input', () => {
  test('voice.wake.autoSubmit off: the transcript goes to the composer and no turn is submitted', async () => {
    const harness = makeCaptureHarness({ scores: [0.99], transcript: 'summarise my inbox' });
    const recorder = await startListening(harness);
    await primeFrontEnd(recorder);

    expect(harness.sounds).toEqual([{ kind: 'chime', path: '' }]);
    expect(harness.runtime.status()?.kind).toBe('wake-capturing');

    // Silence ends the utterance the SDK recorder is holding.
    for (let i = 0; i < 12; i += 1) {
      recorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();

    expect(harness.transcribed.length).toBe(1);
    expect(harness.transcribed[0]?.format).toBe('wav');
    expect(harness.drafts).toEqual(['summarise my inbox']);
    expect(harness.submitted).toEqual([]);
    expect(harness.notices.join('\n')).toContain('voice.wake.autoSubmit is off');
  });

  test('voice.wake.autoSubmit on: the same utterance is submitted as a turn and nothing is drafted', async () => {
    const harness = makeCaptureHarness({
      config: { 'voice.wake.autoSubmit': true },
      scores: [0.99],
      transcript: 'summarise my inbox',
    });
    const recorder = await startListening(harness);
    await primeFrontEnd(recorder);
    for (let i = 0; i < 12; i += 1) {
      recorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();

    expect(harness.submitted).toEqual(['summarise my inbox']);
    expect(harness.drafts).toEqual([]);
  });

  test('voice.wake.activationSound: the configured kind is the one handed to the player at the moment of the wake', async () => {
    // The row's audible outcome — "none" produces no playback, "chime" produces a
    // WAV — is asserted against the real player path in
    // src/test/audio/player-playback.test.ts. What this asserts is the other half:
    // the row reaches the wake handler at all, and differs between two values.
    const silent = makeCaptureHarness({ config: { 'voice.wake.activationSound': 'none' }, scores: [0.99] });
    await primeFrontEnd(await startListening(silent));
    expect(silent.sounds.map((sound) => sound.kind)).toEqual(['none']);

    const chimed = makeCaptureHarness({ scores: [0.99] });
    await primeFrontEnd(await startListening(chimed));
    expect(chimed.sounds.map((sound) => sound.kind)).toEqual(['chime']);
  });

  test('voice.wake.activationSoundPath: the configured path is what reaches the player when the sound is "custom"', async () => {
    const harness = makeCaptureHarness({
      config: { 'voice.wake.activationSound': 'custom', 'voice.wake.activationSoundPath': '/tmp/ping.wav' },
      scores: [0.99],
    });
    await primeFrontEnd(await startListening(harness));
    expect(harness.sounds).toEqual([{ kind: 'custom', path: '/tmp/ping.wav' }]);

    const other = makeCaptureHarness({
      config: { 'voice.wake.activationSound': 'custom', 'voice.wake.activationSoundPath': '/tmp/other.wav' },
      scores: [0.99],
    });
    await primeFrontEnd(await startListening(other));
    expect(other.sounds).toEqual([{ kind: 'custom', path: '/tmp/other.wav' }]);
  });

  test('a transcription that fails is reported to the user, not swallowed, and nothing lands in the composer', async () => {
    const harness = makeCaptureHarness({ scores: [0.99], transcribeError: 'whisper exited 1' });
    const recorder = await startListening(harness);
    await primeFrontEnd(recorder);
    for (let i = 0; i < 12; i += 1) {
      recorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();
    expect(harness.drafts).toEqual([]);
    expect(harness.notices.join('\n')).toContain('whisper exited 1');
  });

  test('no speech-to-text provider at all: the capture still happens and the reason is shown verbatim', async () => {
    const harness = makeCaptureHarness({ scores: [0.99], noTranscriber: 'no speech-to-text provider is registered' });
    const recorder = await startListening(harness);
    await primeFrontEnd(recorder);
    for (let i = 0; i < 12; i += 1) {
      recorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();
    expect(harness.transcribed).toEqual([]);
    expect(harness.notices.join('\n')).toContain('no speech-to-text provider is registered');
  });
});

describe('the capture rows choose the device, the recorder, and what is refused', () => {
  test('voice.wake.inputDevice: the configured device is what the recorder is actually told to open', async () => {
    const named = makeCaptureHarness({ config: { 'voice.wake.inputDevice': 'alsa_input.usb-Blue_Microphones' } });
    await startListening(named);
    expect(named.spawns.calls[0]?.args.join(' ')).toContain('alsa_input.usb-Blue_Microphones');

    const other = makeCaptureHarness({ config: { 'voice.wake.inputDevice': 'alsa_input.pci-0000_00_1f.3' } });
    await startListening(other);
    expect(other.spawns.calls[0]?.args.join(' ')).toContain('alsa_input.pci-0000_00_1f.3');
    expect(other.spawns.calls[0]?.args.join(' ')).not.toContain('Blue_Microphones');
  });

  test('voice.wake.captureCommand: the named recorder is the one spawned, and a different name spawns a different one', async () => {
    const parecord = makeCaptureHarness({ config: { 'voice.wake.captureCommand': 'parecord' } });
    await startListening(parecord);
    expect(parecord.spawns.calls[0]?.command).toBe('parecord');

    const arecord = makeCaptureHarness({ config: { 'voice.wake.captureCommand': 'arecord' } });
    await startListening(arecord);
    expect(arecord.spawns.calls[0]?.command).toBe('arecord');
  });

  test('voice.wake.captureCommand: a named recorder that is not installed is REPORTED, not quietly replaced by one that is', async () => {
    const harness = makeCaptureHarness({
      config: { 'voice.wake.captureCommand': 'sox' },
      installed: ['parecord', 'arecord'],
    });
    await harness.runtime.refresh();
    expect(harness.spawns.calls).toEqual([]);
    expect(harness.notices.join('\n')).toContain('sox');
  });

  test('voice.wake.noiseSuppression: "speex" refuses to start with the row named; "none" runs', async () => {
    const speex = makeCaptureHarness({ config: { 'voice.wake.noiseSuppression': 'speex' } });
    await speex.runtime.refresh();
    expect(speex.spawns.calls).toEqual([]);
    const blocker = speex.runtime.settings().blockers.find((entry) => entry.key === 'voice.wake.noiseSuppression');
    expect(blocker).toBeDefined();
    // The SDK owns this wording, so it is IDENTICAL on every surface — the reason
    // the row is refused is the platform's missing stage, not this surface's.
    expect(blocker?.detail).toContain('no surface applies speex suppression yet');
    expect(blocker?.detail).toContain('libspeexdsp');
    expect(speex.notices.join('\n')).toContain('voice.wake.noiseSuppression');

    const none = makeCaptureHarness({ config: { 'voice.wake.noiseSuppression': 'none' } });
    await none.runtime.refresh();
    expect(none.spawns.calls.length).toBe(1);
    expect(none.runtime.settings().blockers).toEqual([]);
  });

  test('voice.wake.vadThreshold: any value above 0 refuses to start with the missing VAD model named; 0 runs', async () => {
    const screened = makeCaptureHarness({ config: { 'voice.wake.vadThreshold': 0.5 } });
    await screened.runtime.refresh();
    expect(screened.spawns.calls).toEqual([]);
    const blocker = screened.runtime.settings().blockers.find((entry) => entry.key === 'voice.wake.vadThreshold');
    expect(blocker?.detail).toContain('no voice-activity-detection model is available');
    expect(blocker?.detail).toContain('0.5');

    const off = makeCaptureHarness({ config: { 'voice.wake.vadThreshold': 0 } });
    await off.runtime.refresh();
    expect(off.spawns.calls.length).toBe(1);
  });

  test('voice.wake.indicator: the row travels to the footer state, and "off" is what suppresses the row', async () => {
    const statusline = makeCaptureHarness({ config: { 'voice.wake.indicator': 'statusline' } });
    await startListening(statusline);
    expect(statusline.runtime.status()?.indicator).toBe('statusline');
    expect(voiceCaptureRowVisible(statusline.runtime.status())).toBe(true);

    const banner = makeCaptureHarness({ config: { 'voice.wake.indicator': 'banner' } });
    await startListening(banner);
    expect(banner.runtime.status()?.indicator).toBe('banner');

    const hidden = makeCaptureHarness({ config: { 'voice.wake.indicator': 'off' } });
    await startListening(hidden);
    // Still listening — the device is open, the ROW is what is hidden.
    expect(hidden.spawns.calls.length).toBe(1);
    expect(hidden.runtime.status()?.kind).toBe('wake-listening');
    expect(voiceCaptureRowVisible(hidden.runtime.status())).toBe(false);
  });
});

describe('the post-wake capture rows bound what is recorded', () => {
  test('voice.wake.captureMaxSeconds: a short ceiling ends the utterance while a long one is still recording', async () => {
    // One second at 16 kHz is 12.5 frames of 1280 samples; 20 loud frames after the
    // wake is well past a 1-second ceiling and well inside a 4-second one.
    const short = makeCaptureHarness({ config: { 'voice.wake.captureMaxSeconds': 1, 'voice.wake.silenceStopMs': 9000 }, scores: [0.99] });
    const shortRecorder = await startListening(short);
    await primeFrontEnd(shortRecorder);
    for (let i = 0; i < 20; i += 1) {
      shortRecorder.emitBytes(pcmBytes(loudSamples(WAKE_CHUNK_SAMPLES, 40 + i)));
      await flush(2);
    }
    await flush();
    expect(short.transcribed.length).toBe(1);

    const long = makeCaptureHarness({ config: { 'voice.wake.captureMaxSeconds': 60, 'voice.wake.silenceStopMs': 9000 }, scores: [0.99] });
    const longRecorder = await startListening(long);
    await primeFrontEnd(longRecorder);
    for (let i = 0; i < 20; i += 1) {
      longRecorder.emitBytes(pcmBytes(loudSamples(WAKE_CHUNK_SAMPLES, 40 + i)));
      await flush(2);
    }
    await flush();
    expect(long.transcribed).toEqual([]);
    expect(long.runtime.status()?.kind).toBe('wake-capturing');
  });

  test('voice.wake.silenceStopMs: the same run of silence ends capture under a short window and not under a long one', async () => {
    const quick = makeCaptureHarness({ config: { 'voice.wake.silenceStopMs': 200 }, scores: [0.99] });
    const quickRecorder = await startListening(quick);
    await primeFrontEnd(quickRecorder);
    for (let i = 0; i < 6; i += 1) {
      quickRecorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();
    expect(quick.transcribed.length).toBe(1);

    const patient = makeCaptureHarness({ config: { 'voice.wake.silenceStopMs': 5000 }, scores: [0.99] });
    const patientRecorder = await startListening(patient);
    await primeFrontEnd(patientRecorder);
    for (let i = 0; i < 6; i += 1) {
      patientRecorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();
    expect(patient.transcribed).toEqual([]);
  });

  test('voice.wake.retainAudio: "session-temp" writes the clip where the SDK sweeper can find its owner; "none" writes nothing', async () => {
    const retainedRoot = makeProjectTempDir('wake-retain');
    const retaining = makeCaptureHarness({
      config: { 'voice.wake.retainAudio': 'session-temp' },
      scores: [0.99],
      managedRoot: retainedRoot,
    });
    const recorder = await startListening(retaining);
    await primeFrontEnd(recorder);
    for (let i = 0; i < 12; i += 1) {
      recorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();
    const retainedDir = resolveManagedWakePaths(retainedRoot).retainedDir;
    const written = readdirSync(retainedDir);
    expect(written.length).toBe(1);
    // The SDK owns the name, and the sweeper parses the owning session out of it.
    expect(written[0]).toBe(retainedClipFileName('session-under-test', retaining.now));
    expect(statSync(join(retainedDir, written[0] ?? '')).size).toBeGreaterThan(0);

    const plainRoot = makeProjectTempDir('wake-no-retain');
    const notRetaining = makeCaptureHarness({
      config: { 'voice.wake.retainAudio': 'none' },
      scores: [0.99],
      managedRoot: plainRoot,
    });
    const plainRecorder = await startListening(notRetaining);
    await primeFrontEnd(plainRecorder);
    for (let i = 0; i < 12; i += 1) {
      plainRecorder.emitBytes(pcmBytes(silentSamples(WAKE_CHUNK_SAMPLES)));
      await flush(2);
    }
    await flush();
    expect(existsSync(resolveManagedWakePaths(plainRoot).retainedDir)).toBe(false);
  });

  test('voice.wake.customModelDir: a non-pinned model id is loaded from the configured directory, and reported as unverified', async () => {
    const custom = makeCaptureHarness({
      config: { 'voice.wake.models': 'hey_operator', 'voice.wake.customModelDir': '/opt/my-wake-models' },
    });
    await startListening(custom);
    expect(custom.loadedModelPaths.some((path) => path.startsWith('/opt/my-wake-models/'))).toBe(true);
    expect(custom.notices.join('\n')).toContain('not checksum-pinned');

    const elsewhere = makeCaptureHarness({
      config: { 'voice.wake.models': 'hey_operator', 'voice.wake.customModelDir': '/srv/wake' },
    });
    await startListening(elsewhere);
    expect(elsewhere.loadedModelPaths.some((path) => path.startsWith('/srv/wake/'))).toBe(true);
    expect(elsewhere.loadedModelPaths.some((path) => path.startsWith('/opt/my-wake-models/'))).toBe(false);
  });
});

describe('a recorder that keeps dying is restarted, then latched, with the reason shown', () => {
  test('voice.wake.maxRestarts + restartBackoffMs bound the retries on a real capture stream', async () => {
    const harness = makeCaptureHarness({ config: { 'voice.wake.maxRestarts': 1, 'voice.wake.restartBackoffMs': 250 } });
    const first = await startListening(harness);

    first.emitStderr('device or resource busy');
    first.emitClose(1);
    await flush();
    expect(harness.runtime.status()?.kind).toBe('wake-restarting');
    expect(harness.timers.at(-1)?.ms).toBe(250);
    expect(harness.notices.join('\n')).toContain('restarting the wake-word detector');

    harness.timers.at(-1)?.handler();
    await flush();
    const second = harness.spawns.processes[1];
    if (second === undefined) throw new Error('the restart did not spawn a second recorder');

    second.emitClose(1);
    await flush();
    expect(harness.runtime.status()?.kind).toBe('wake-latched');
    expect(harness.runtime.status()?.detail ?? '').not.toBe('');
    expect(harness.notices.join('\n')).toContain('stays off until voice.wake.enabled is turned off and on again');
  });
});
