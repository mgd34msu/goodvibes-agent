/**
 * voice-capture-wiring.ts — composes this surface's microphone path.
 *
 * One capture opener (capture.ts), one transcription route (the in-process voice
 * service, through core/voice-stt-gateway.ts), one set of `voice.wake.*` rows.
 * Written as a composition root rather than inlined into the wake runtime because
 * the capture opener is shared by construction: a wake does not end a capture
 * session, it starts one, and anything else that ever wants a microphone here has
 * to come through the same opener rather than racing the OS for a held device.
 *
 * It owns nothing the shell does not hand it: the composer write, the turn
 * submission, the message router and the render request all arrive as callbacks,
 * which is what keeps this file out of the shell-UI layers.
 */

import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import type { ConfigKey, ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { VoiceProviderRegistry, VoiceService } from '@pellux/goodvibes-sdk/platform/voice';
import type { VoiceCaptureIndicatorState } from '../core/voice-capture-status.ts';
import { createAgentCaptureOpener, SURFACE_APPLIES_SPEEX_SUPPRESSION } from './capture.ts';
import { playActivationSound } from './activation-sound.ts';
import { LocalStreamingAudioPlayer } from './player.ts';
import type { StreamingAudioPlayer } from './player.ts';
import { createVoiceSttGateway } from '../core/voice-stt-gateway.ts';
import { startWakeRuntime, wireWakeRuntime } from './wake-runtime.ts';

export interface VoiceCaptureWiringDeps {
  readonly configManager: ConfigManager;
  /** This process's own voice service — the one the `voice.*` verbs are served from. */
  readonly voiceService: VoiceService;
  /** Read only to answer "is an STT provider registered" before audio is captured. */
  readonly voiceProviders: Pick<VoiceProviderRegistry, 'findProvider'>;
  /** `<root>/voice` — the managed root the wake tree hangs off (the same root /voice setup uses). */
  readonly managedVoiceRoot: string;
  /** A directory this surface owns for the extracted onnxruntime assets. */
  readonly assetDirectory: string;
  /** Names retained clips so the SDK's sweeper can reap them when the session ends. */
  readonly sessionId: string;
  /** Writes recognised text into the composer. */
  readonly writeDraft: (text: string) => void;
  /** Submits recognised text as a turn (`voice.wake.autoSubmit` on). */
  readonly submitTurn: (text: string) => void;
  readonly notify: (message: string) => void;
  readonly render: () => void;
  /** Injected in tests; defaults to a real streaming player for the activation sound. */
  readonly player?: StreamingAudioPlayer;
}

export interface VoiceCaptureWiring {
  /** The live footer row, or null when no microphone is open. */
  readonly status: () => VoiceCaptureIndicatorState | null;
  /** Teardown, for the shell's `unsubs` registry — releases any open device. */
  readonly unsubs: readonly (() => void)[];
}

/** Compose wake detection over this surface's capture path. Opens no device by itself. */
export function wireVoiceCapture(deps: VoiceCaptureWiringDeps): VoiceCaptureWiring {
  const readConfig = (key: string): unknown => deps.configManager.get(key as ConfigKey);
  const warn = (message: string, meta?: Readonly<Record<string, unknown>>): void => {
    logger.debug(`voice capture: ${message}`, meta ?? {});
  };
  // Not a probe: this surface does not apply speex suppression, so `speex` is
  // refused with its reason rather than being silently skipped (see capture.ts).
  const speexAvailable = SURFACE_APPLIES_SPEEX_SUPPRESSION;
  const openCapture = createAgentCaptureOpener({ speexAvailable, warn });
  const resolveTranscriber = () => {
    const resolution = createVoiceSttGateway({ voiceService: deps.voiceService, voiceProviders: deps.voiceProviders });
    return resolution.available
      ? { available: true as const, gateway: resolution.gateway }
      : { available: false as const, reason: resolution.reason };
  };
  const subscribeConfig = (key: string, listener: () => void): (() => void) => deps.configManager.subscribe(key as ConfigKey, listener);
  const player = deps.player ?? new LocalStreamingAudioPlayer();

  const wake = wireWakeRuntime({
    readConfig,
    subscribeConfig,
    openCapture,
    managedRoot: deps.managedVoiceRoot,
    assetDirectory: deps.assetDirectory,
    speexAvailable,
    resolveTranscriber,
    playActivationSound: (sound) => playActivationSound(sound, { player, notify: deps.notify }),
    submitTurn: deps.submitTurn,
    writeDraft: deps.writeDraft,
    notify: deps.notify,
    render: deps.render,
    sessionId: deps.sessionId,
    warn,
  });

  return {
    status: () => wake.status(),
    unsubs: startWakeRuntime(wake, { subscribeConfig }),
  };
}
