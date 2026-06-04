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

The model can inspect the same settings through `agent_harness mode:"settings"` or `mode:"get_setting"`, open the visible TTS provider or voice picker through `mode:"open_ui_surface"`, and change Agent-owned TTS settings with explicit confirmation. `mode:"media_posture"` is compact by default; use `includeParameters:true` or `mode:"media_provider"` for full provider readiness, generation route hints, picker routes, and media policy detail. Workspace action discovery includes compact `modelRoute` hints for TTS prompts, image input, and confirmed media generation; generated image/video requests use `agent_media_generate` when the user asks for that effect. Connected-host listener or lifecycle settings remain outside Agent ownership.

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
