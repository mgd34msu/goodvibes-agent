# Providers and Routing

GoodVibes Agent uses the provider/model configuration exposed by the external GoodVibes runtime. The Agent TUI should make the active route easy to see and easy to change, but it should not duplicate provider hosting logic.

## Agent Expectations

Provider and model state should be visible in:

- the shell footer/status rows;
- `/status`;
- `/model` and `/provider`;
- the Agent operator workspace setup checklist;
- the TTS configuration workspace when spoken turns are used.

When a selected model is provider-qualified, Agent keeps the runtime provider row and raw model id separate. For example, `openai-subscriber` plus `openai:gpt-5.5` should route as provider `openai-subscriber` and model `gpt-5.5` where the public route expects provider/model fields.

## Local Provider Definitions

Agent-owned provider definitions live under the Agent profile root when supported by the copied GoodVibes provider registry:

```text
~/.goodvibes/agent/providers/*.json
```

These files are local configuration. They are not Agent Knowledge records and should not be copied into wiki/search state.

## Discovery And Health

Provider discovery and health are runtime-owned. Agent can display discovered provider status, model context information, and route failures. It should not hide provider failures behind fallback wording that makes a failed chat or knowledge request look successful.

## Search, Voice, And Media Providers

Search, voice, media, and multimodal providers are valid Agent capabilities when they are presented as assistant features:

- research and source lookup;
- live spoken turns;
- image/document analysis;
- artifact creation and review.

Outputs that should become durable knowledge must go through Agent Knowledge routes. No provider output should be inserted into default Knowledge/Wiki or another product segment by Agent.

## Related Docs

- [Getting started](getting-started.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Voice and live TTS](voice-and-live-tts.md)
