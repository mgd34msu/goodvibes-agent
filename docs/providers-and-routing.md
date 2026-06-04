# Providers and Routing

GoodVibes Agent uses the provider/model configuration exposed by the connected GoodVibes host. The Agent TUI should make the active route easy to see and easy to change, but it should not duplicate provider hosting logic.

## Agent Expectations

Provider and model state should be visible in:

- the shell footer/status rows;
- `/health` in the TUI and `goodvibes-agent status` in the CLI;
- `/model` and `/provider`;
- the Agent operator workspace setup checklist;
- the TTS configuration workspace when spoken turns are used.
- `agent_harness` modes `model_routing` and `model_route` when the model needs read-only provider/model route posture, selectable model metadata, pinned model status, reasoning support, context-window posture, and safe setting keys.
- `agent_harness` modes `provider_accounts` and `provider_account` when the model needs read-only provider auth route posture, subscription freshness, usage windows, route issues, and repair guidance without tokens or authorization codes.

When a selected model is provider-qualified, Agent keeps the runtime provider row and raw model id separate. For example, `openai-subscriber` plus `openai:gpt-5.5` should route as provider `openai-subscriber` and model `gpt-5.5` where the public route expects provider/model fields.

## Local Provider Definitions

Agent-owned provider definitions live under the Agent profile root when supported by the shared GoodVibes provider registry:

```text
~/.goodvibes/agent/providers/*.json
```

These files are local configuration. They are not Agent Knowledge records and should not be copied into knowledge search state.

## Discovery And Health

Provider discovery and health are owned by the connected GoodVibes host. Agent can display discovered provider status, model context information, and route failures. It should not hide provider failures behind fallback wording that makes a failed chat or knowledge request look successful.

## Search, Voice, And Media Providers

Search, voice, media, and multimodal providers are valid Agent features when they are presented as assistant workflows:

- research and source lookup;
- live spoken turns;
- image/document analysis;
- artifact creation and review.

Outputs that should become durable knowledge must go through Agent Knowledge routes. No provider output should be inserted into default knowledge or another product segment by Agent.

Setting changes are available to the model through `agent_harness` only when the user explicitly asks. `model_routing` is read-only; model/provider selection, catalog refresh, pin/unpin, custom provider edits, and route setting changes stay visible picker, settings, workspace, or slash-command flows. Secret-backed provider or channel values are stored through the secret manager and displayed as redacted references.

## Related Docs

- [Getting started](getting-started.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Voice and live TTS](voice-and-live-tts.md)
