# Voice and Live TTS

GoodVibes Agent supports spoken turns as an Agent TUI feature. Text output remains primary; voice is an additional local playback path for a normal assistant turn.

## Commands

```text
/tts <prompt>
/tts stop
/config tts
/config tts.provider
/config tts.voice
/config tts.llmProvider
/config tts.llmModel
```

`/tts <prompt>` submits the prompt through the normal Agent conversation path. It uses the active chat provider/model unless a separate spoken-turn model override is configured.

`/tts stop` cancels queued spoken output and active playback without cancelling the text transcript.

`/config tts` opens the fullscreen configuration workspace for streaming provider, voice, and spoken-turn model routing.

The model can inspect the same settings through `settings action:"list|get"`, use `device action:"voice|provider"` for voice/media posture and provider inspection, open the visible TTS provider or voice picker through `device action:"open_tts_provider|open_tts_voice"` with confirmation, and change Agent-owned TTS settings with `settings action:"set"` plus explicit confirmation. Lower-level `mode:"media_posture"` is compact by default; use `includeParameters:true` or `mode:"media_provider"` for full provider readiness, generation route hints, picker routes, and media policy detail. It also returns a voice workflow map for push-to-talk input, voice memo transcription, spoken responses, and wake-word capture, with ready/attention/setup-needed/not-published states, exact setup routes, and certified SDK/daemon permission-scoped live records when published. Workspace action discovery includes compact `modelRoute` hints for TTS prompts, image input, and confirmed media generation; generated image/video requests use `agent_media_generate` when the user asks for that effect. Connected-host listener or lifecycle settings remain outside Agent ownership.

Wake-word and always-listening capture are reported as `not-published` until the runtime exposes a certified permission-scoped contract. When the SDK/daemon publishes certified wake-word records, Agent shows the permission scope, receipt evidence, and exact inspect/control routes; otherwise Agent guides users to explicit voice input and `/tts` rather than implying background microphone capture exists.

## Playback Requirements

Live playback streams audio to a local player. Install one of:

- `mpv`;
- `ffplay`.

If neither player is on `PATH`, the Agent still submits and renders the normal text response. Audio is skipped with a concise status message.

## Provider Routing

Voice uses providers that advertise streaming TTS capability through the runtime. Agent does not hardcode provider behavior.

Useful setup path:

```text
/config tts.provider
/config tts.voice
/config tts.llmProvider
/config tts.llmModel
```

Leaving `tts.voice` empty lets the provider choose its default voice.

## Knowledge Boundary

Spoken responses are conversation output. They are not automatically written to Agent Knowledge, local memory, default knowledge, or any other product segment.

If a spoken result should become durable, store it through an explicit Agent memory command or an Agent Knowledge ingestion path.

## Platform Voice-Config Cohesion

The `tts.*` config keys (`tts.provider`, `tts.voice`, `tts.speed`, `tts.llmProvider`,
`tts.llmModel`) are defined once, in the shared GoodVibes SDK config schema, and read
identically by every surface — Agent, TUI, and the daemon. Agent does not define its
own voice-config schema and does not read tts.* through any path other than the
standard `ConfigManager.get`/`set` API that every other Agent setting uses. Changing
`tts.provider` through `/config tts.provider` or `settings action:"set"` changes the
exact same key a TUI user would change through its own `/config` surface — the
key name, type, and default are one contract, not two independently-maintained ones.
`src/test/audio/voice-config-cohesion.test.ts` is the regression guard: it fails if
the Agent ever reads a tts.* key that isn't in the shared schema, or if a tts.*
reader stops importing `ConfigManager` from the shared SDK package.

What "shared" does **not** mean here: each surface still persists its *values* to its
own settings file (Agent's under its own surface root, TUI's under its own) — that is
the existing, general-purpose per-surface config storage model, not something voice-
specific, and changing it is out of scope for this ruling. "Shared" means the
schema/contract (the key names, types, and defaults) is one definition used by every
surface, so the same key always means the same thing and takes the same kind of
value everywhere — a user (or an operator script) setting `tts.voice` on one surface
is setting the same conceptual value the other surfaces would read under that name,
even though each surface keeps its own copy of the setting today.

Two related rulings, made for this parity pass:

- **Local synthesis stays local.** Agent synthesizes speech directly against the
  configured provider (through the shared `VoiceService`/`VoiceProviderRegistry`) via
  a local `mpv`/`ffplay` subprocess, rather than routing playback through the daemon's
  `voice.tts`/`voice.tts.stream` HTTP routes. This is deliberate, not an oversight:
  Agent is a terminal tool that must keep working when there is no daemon running
  (offline use), so voice output cannot depend on a daemon round-trip. The daemon's
  voice routes exist for network consumers (the web UI); Agent's local-first design
  is the reason it doesn't use them, and the config it reads to pick a provider is
  still the one shared contract described above.
- **Mic/STT input is an honest no-op in Agent, not a gap.** Agent has no
  `getUserMedia`-equivalent microphone capture and does not call `voice.stt` or
  `voice.realtime.session`. This is by design: Agent is a terminal application with
  keyboard/text as its primary input surface, and the web UI is the platform's
  intended owner of mic-based voice input (browser `getUserMedia`/`MediaRecorder`).
  Agent already reports this honestly rather than implying a capability that doesn't
  exist — see the wake-word/always-listening `not-published` posture described above,
  which applies to mic input broadly, not only wake-word. If a future certified,
  permission-scoped mic contract is published for terminal surfaces, this ruling is
  the one to revisit; until then, building a partial mic flow in Agent would be
  worse than not building one.
