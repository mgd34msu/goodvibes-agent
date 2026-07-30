/**
 * voice-stt-gateway.ts — speech-to-text for captured audio.
 *
 * A confirmed wake hands over the utterance that followed it, and this is where
 * that audio becomes words.
 *
 * WHY THIS CALLS THE VOICE SERVICE DIRECTLY AND NOT A DAEMON OVER HTTP
 *
 * `voice.stt` (POST /api/voice/stt) is implemented as exactly one line:
 * `voiceService.transcribe(providerId, { audio, ... })` against whichever voice
 * provider is registered, including the managed local whisper that `/voice setup`
 * provisions. This process OWNS that VoiceService instance — it is the same object
 * the `voice.*` gateway verbs are served from here — so calling it directly is the
 * same code path the verb runs, without a loopback request to ask itself a
 * question it already holds the answer to. (The terminal has no in-process voice
 * service and therefore goes over the verb; that difference is in where the
 * service lives, not in what runs.)
 *
 * The provider is left unspecified so the registry picks the configured one,
 * matching the verb's behaviour when a caller sends no `providerId`.
 */

import { GoodVibesSdkError } from '@pellux/goodvibes-sdk';
import type { UtteranceAudioArtifact, VoiceProviderRegistry, VoiceService } from '@pellux/goodvibes-sdk/platform/voice';

/** The narrow verb surface a capture consumer needs. */
export interface VoiceSttGateway {
  /** Transcribe one captured utterance; resolves to the recognised text. */
  transcribe(audio: UtteranceAudioArtifact): Promise<string>;
}

/**
 * Why transcription is unavailable, surfaced so a capture path prints a real
 * reason instead of inventing one.
 */
export type VoiceSttGatewayResolution =
  | { readonly available: true; readonly gateway: VoiceSttGateway }
  | { readonly available: false; readonly reason: string };

export interface VoiceSttGatewayDeps {
  readonly voiceService: VoiceService;
  /**
   * The registry behind that service, read only to answer "is there an STT
   * provider at all" BEFORE audio is captured. Checked up front because the
   * alternative is recording a sentence and then discovering there was nothing to
   * transcribe it with.
   */
  readonly voiceProviders: Pick<VoiceProviderRegistry, 'findProvider'>;
}

/** Build the live speech-to-text gateway, or say why there is none. */
export function createVoiceSttGateway(deps: VoiceSttGatewayDeps): VoiceSttGatewayResolution {
  const provider = deps.voiceProviders.findProvider('stt');
  if (provider === null || provider.transcribe === undefined) {
    return {
      available: false,
      reason: 'no speech-to-text provider is registered — run /voice setup to provision the managed local runtime, or configure a voice provider.',
    };
  }
  return {
    available: true,
    gateway: {
      transcribe: async (audio) => {
        // `metadata` is required on the service's artifact and absent from the
        // capture layer's, which is deliberate: the SDK's artifact carries only
        // what the encoder knows. Empty is what the verb sends for a caller that
        // supplied none.
        const result = await deps.voiceService.transcribe(undefined, { audio: { ...audio, metadata: {} } });
        return result.text;
      },
    },
  };
}

/**
 * Render a transcription failure honestly. A provider that is registered but not
 * configured (no key, no binary) is a different thing the user can act on than a
 * request that reached a provider and failed.
 */
export function describeTranscriptionFailure(error: unknown): string {
  if (error instanceof GoodVibesSdkError && error.code === 'PROVIDER_NOT_CONFIGURED') {
    return `${error.message} — run /voice setup to provision the managed local runtime, or configure a voice provider.`;
  }
  return error instanceof Error ? error.message : String(error);
}
