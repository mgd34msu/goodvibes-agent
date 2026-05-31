# Knowledge, Artifacts, and Multimodal

GoodVibes Agent has its own Knowledge/Wiki segment. It must not query or ingest through the default Knowledge/Wiki, HomeGraph, Home Assistant, or copied TUI knowledge spaces.

## Context Layers

GoodVibes Agent uses these context layers:

- current conversation context for the active turn;
- local Agent memory records for durable but private assistant facts and preferences;
- local Agent skills and personas for reusable behavior profiles;
- isolated Agent Knowledge/Wiki for source-backed documents, search, and semantic answers;
- artifacts for uploaded/generated files that can be referenced by chat, delegation, or future Agent Knowledge ingestion.

These layers are intentionally separate. Local memory/skills/personas are not automatically promoted into Agent Knowledge. Agent Knowledge records are not copied into the default wiki. Secrets are rejected or represented only by explicit secret references.

## Agent Knowledge Boundary

Agent Knowledge uses only the Agent route family:

```text
GET  /api/goodvibes-agent/knowledge/status
POST /api/goodvibes-agent/knowledge/ask
POST /api/goodvibes-agent/knowledge/search
POST /api/goodvibes-agent/knowledge/ingest/url
```

If those routes are unavailable, Agent commands fail closed with a structured error. They do not retry against `/api/knowledge/*`, HomeGraph, Home Assistant, or arbitrary knowledge-space selectors.

The CLI and slash-command layers reject route-selection flags such as `--space`, `--knowledge-space`, `--knowledgeSpaceId`, `--includeAllSpaces`, and HomeGraph/Home Assistant selectors because those would violate the Agent product boundary.

## Semantic Ask

`/knowledge ask <query>` and `goodvibes-agent ask <query>` render the daemon's Agent Knowledge answer. The default human output is concise:

- answer text or a clear no-match state;
- confidence when present;
- sources, titles, and URLs when returned;
- facts, gaps, and refinement task ids only when the Agent Knowledge route returns them.

`--json` preserves the raw structured Agent route response for tooling.

The command layer does not turn search results into an answer locally and does not apply client-side filters to hide contamination. Isolation must come from the Agent Knowledge route itself.

## Search

`/knowledge search <query>` and `goodvibes-agent search <query>` query the isolated Agent Knowledge search route and render bounded results with title, id, type, score, source, URL, and snippets when available. Empty Agent stores return an explicit empty state.

## Ingest

`/knowledge ingest-url <url>` and `goodvibes-agent knowledge ingest-url <url>` ingest URL sources into Agent Knowledge only. Additional ingest shapes should be added only when the SDK exposes Agent-specific routes for them.

Do not map local memory, skills, personas, or default wiki documents into Agent Knowledge automatically. Durable source-backed facts can be ingested deliberately through Agent routes when the user or an explicit Agent workflow asks for it.

## Artifacts

Artifacts are first-class runtime objects for files, images, audio, video, generated outputs, and delegation results. Artifact storage is shared daemon infrastructure, but Agent Knowledge use of artifacts must still go through Agent-specific ingest routes when those are available.

Large uploads should use daemon upload bodies rather than JSON inline data:

- `POST /api/artifacts` with multipart form field `file`;
- `POST /api/artifacts` with raw binary bodies plus filename metadata;
- Agent-specific artifact ingest routes once the SDK exposes them.

Keep JSON inline payloads for small control data only.

## Multimodal

The copied GoodVibes runtime contains multimodal primitives for images, audio, video, documents, packet building, and provider routing. In Agent, multimodal analysis should be wired as an operator-assistant capability and should write into Agent Knowledge only through Agent-specific routes.

Until that route coverage exists, multimodal outputs should stay in the conversation, artifacts, local memory, or explicit delegation results rather than being inserted into default Knowledge/Wiki.

## Refinement

Default knowledge refinement route families are not an Agent Knowledge contract. Do not call them from Agent as a substitute for Agent Knowledge repair.

When the SDK exposes Agent-specific refinement routes, they should preserve the same boundary as ask/search/ingest: no default wiki fallback, no HomeGraph fallback, and no client-side contamination filters.

## Related Docs

- [Tools and commands](tools-and-commands.md)
- [Getting started](getting-started.md)
- [Release and publishing](release-and-publishing.md)
