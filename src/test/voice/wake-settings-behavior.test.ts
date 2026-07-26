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
 * Nothing here opens a microphone, spawns a recorder, reads a real clock, or
 * touches the filesystem. Time is injected, audio is synthetic, and the
 * inference sessions are stubs that replay scripted scores.
 *
 * ROWS WITH NO CONSUMING CODE IN THIS BUILD — DELIBERATELY NOT TESTED HERE
 *
 * The wake capability ships with `notOperable: no-runtime-wiring`: the detector,
 * front end, supervisor, provisioning and recovery are complete, but no surface
 * captures microphone audio, plays the confirmation sound, draws the listening
 * indicator, chooses a browser execution backend, or hands a transcript
 * anywhere. These rows therefore have no code that reads them, in this repo or
 * in the SDK, and no test can make them fail:
 *
 *   enabled, vadThreshold, noiseSuppression, inputDevice, captureCommand,
 *   surfaces.tui, surfaces.agent, surfaces.webui, activationSound,
 *   activationSoundPath, indicator, captureMaxSeconds, silenceStopMs,
 *   autoSubmit, retainAudio, customModelDir, browserBackend
 *
 * They are recorded as NOT COVERED rather than given tests that cannot fail.
 * The last two tests in this file pin the declaration those rows depend on, so
 * the day capture is wired up and the declaration is removed, this file fails
 * and points at the list above.
 */
import { describe, expect, test } from 'bun:test';
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

describe('the rows with no consuming code in this build', () => {
  test('voice.wake.enabled: NOT behaviour-covered — the capability is declared not-operable, so true and false both derive to disabled', () => {
    // This is recorded as an honest NON-coverage, not as coverage. The row has
    // no consumer that can tell the two values apart in this build: nothing
    // captures audio, so deriveFeatureState hard-returns 'disabled' whatever
    // the user set, and the gate refuses the capability even with a permissive
    // flag manager. The user's value is remembered and takes effect in the
    // release that wires capture up, and this test fails the moment the
    // not-operable declaration is removed — which is exactly when a real
    // two-value behaviour test for this row becomes possible and required.
    const binding = FEATURE_SETTINGS_BINDINGS.find((entry) => entry.key === 'voice.wake.enabled');
    if (binding === undefined) throw new Error('voice.wake.enabled has no feature-settings binding');
    expect(binding.featureId).toBe('wake-word-detection');

    expect(deriveFeatureState(binding, true)).toBe('disabled');
    expect(deriveFeatureState(binding, false)).toBe('disabled');
    expect(isFeatureGateEnabled({ isEnabled: (): boolean => true }, 'wake-word-detection')).toBe(false);
    expect(featureInoperability('wake-word-detection')).not.toBeNull();
  });

  test('the wake capability is still declared not-operable, which is why the capture-side rows have nothing to verify', () => {
    // The single record behind every NOT COVERED row in this file's header.
    // When capture, the confirmation sound, the listening indicator, the
    // per-surface delivery and the browser backend are wired up, this
    // declaration is removed in the same change — and this test failing is the
    // prompt to write the behaviour tests those rows will finally have.
    const inoperable = featureInoperability('wake-word-detection');
    expect(inoperable?.reason).toBe('no-runtime-wiring');
    expect(inoperable?.detail).toContain('no surface captures microphone audio');
  });
});
