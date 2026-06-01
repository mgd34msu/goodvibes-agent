# Knowledge, Artifacts, and Multimodal

GoodVibes Agent has its own Knowledge/Wiki segment. It must not query or ingest through default Knowledge/Wiki or other product-specific knowledge spaces.

## Context Layers

GoodVibes Agent uses these context layers:

- current conversation context for the active turn;
- local Agent memory records for durable but private assistant facts and preferences;
- local Agent routines, skills, and personas for reusable behavior profiles;
- isolated Agent Knowledge/Wiki for source-backed documents, search, and semantic answers;
- artifacts for uploaded/generated files that can be referenced by chat, delegation, or future Agent Knowledge ingestion.

These layers are intentionally separate. Local memory/routines/skills/personas are not automatically promoted into Agent Knowledge. Agent Knowledge records are not copied into default Knowledge/Wiki. Secrets are rejected or represented only by explicit secret references.

## Agent Knowledge Boundary

Agent Knowledge uses only the Agent route family:

```text
GET  /api/goodvibes-agent/knowledge/status
POST /api/goodvibes-agent/knowledge/ask
POST /api/goodvibes-agent/knowledge/search
GET  /api/goodvibes-agent/knowledge/sources
GET  /api/goodvibes-agent/knowledge/nodes
GET  /api/goodvibes-agent/knowledge/issues
GET  /api/goodvibes-agent/knowledge/items/{id}
GET  /api/goodvibes-agent/knowledge/connectors
POST /api/goodvibes-agent/knowledge/ingest/url
POST /api/goodvibes-agent/knowledge/ingest/urls
POST /api/goodvibes-agent/knowledge/ingest/bookmarks
POST /api/goodvibes-agent/knowledge/reindex
```

If those routes are unavailable, Agent commands fail closed with a structured error. They do not retry against `/api/knowledge/*` or arbitrary knowledge-space selectors.

The CLI and slash-command layers reject route-selection flags such as `--space`, `--knowledge-space`, `--knowledge-space-id`, and `--include-all-spaces` because those would violate the Agent product boundary.

Agent Knowledge writes are explicit-user-action paths. Slash commands that ingest, import, review issues, reindex, or run consolidation require `--yes`; ask/search/status/list paths remain read-only.

## Ask And Search

`/knowledge ask <query>` and `goodvibes-agent ask <query>` render the Agent Knowledge answer. Default output is concise:

- answer text or a clear no-match state;
- confidence when present;
- sources, titles, and URLs when returned;
- facts, gaps, and refinement task ids only when the Agent Knowledge route returns them.

`--json` preserves the raw structured Agent route response for tooling.

The command layer does not turn search results into an answer locally and does not apply client-side filters to hide contamination. Isolation must come from the Agent Knowledge route itself.

`/knowledge search <query>` and `goodvibes-agent search <query>` query the isolated Agent Knowledge search route and render bounded results with title, id, type, score, source, URL, and snippets when available. Empty Agent stores return an explicit empty state.

Read-only inspection is available from both TUI slash commands and CLI commands:

- `goodvibes-agent knowledge list --kind sources|nodes|issues`
- `goodvibes-agent knowledge get <id>`
- `goodvibes-agent knowledge connectors`
- `goodvibes-agent knowledge map`

## Ingest

`/knowledge ingest-url <url> --yes` and `goodvibes-agent knowledge ingest-url <url> --yes` ingest URL sources into Agent Knowledge only.

The CLI also exposes the Agent-specific batch routes:

- `goodvibes-agent knowledge import-urls <path> --yes`
- `goodvibes-agent knowledge import-bookmarks <path> --yes`
- `goodvibes-agent knowledge reindex --yes`

All of these commands target `/api/goodvibes-agent/knowledge/*`; none of them call default Knowledge/Wiki.

Do not map local memory, routines, skills, personas, or default wiki documents into Agent Knowledge automatically. Durable source-backed facts can be ingested deliberately through Agent routes when the user or an explicit Agent workflow asks for it.

## Artifacts And Multimodal

Artifacts are first-class runtime objects for files, images, audio, video, generated outputs, and delegation results. Agent Knowledge use of artifacts must still go through Agent-specific ingest routes when those are available.

Until dedicated Agent artifact-ingest route coverage exists, multimodal outputs should stay in the conversation, artifacts, local memory, or explicit delegation results rather than being inserted into default Knowledge/Wiki.

## Related Docs

- [Tools and commands](tools-and-commands.md)
- [Getting started](getting-started.md)
- [Release and publishing](release-and-publishing.md)
