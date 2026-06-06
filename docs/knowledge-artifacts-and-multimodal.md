# Knowledge, Artifacts, and Multimodal

GoodVibes Agent has its own Knowledge segment. It must not query or ingest through default knowledge or other product-specific knowledge spaces.

## Context Layers

GoodVibes Agent uses these context layers:

- current conversation context for the active turn;
- Agent-local memory records for durable but private assistant facts and preferences;
- Agent-local routines, skills, and personas for reusable behavior profiles;
- isolated Agent Knowledge for source-backed documents, search, and semantic answers;
- artifacts for uploaded/generated files that can be referenced by chat, delegation, or explicit Agent Knowledge ingestion.

These layers are intentionally separate. Local memory/routines/skills/personas are not automatically promoted into Agent Knowledge. Agent Knowledge records are not copied into default knowledge. Secrets are rejected or represented only by explicit secret references.

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
GET  /api/goodvibes-agent/knowledge/map
GET  /api/goodvibes-agent/knowledge/connectors
GET  /api/goodvibes-agent/knowledge/connectors/{id}
GET  /api/goodvibes-agent/knowledge/connectors/{id}/doctor
POST /api/goodvibes-agent/knowledge/ingest/url
POST /api/goodvibes-agent/knowledge/ingest/urls
POST /api/goodvibes-agent/knowledge/ingest/artifact
POST /api/goodvibes-agent/knowledge/ingest/bookmarks
POST /api/goodvibes-agent/knowledge/ingest/browser-history
POST /api/goodvibes-agent/knowledge/ingest/connector
POST /api/goodvibes-agent/knowledge/reindex
```

If those routes are unavailable, Agent commands fail closed with a structured error. They do not retry against the default knowledge routes or arbitrary knowledge-space selectors.

The CLI and slash-command layers reject route-selection flags such as `--space`, `--knowledge-space`, `--knowledge-space-id`, and `--include-all-spaces` because those would violate the Agent product boundary.

Successful route responses are validated before rendering. Parseable public Agent-route scope aliases are normalized. If a connected host response carries known non-Agent payload markers or unparseable default-scope text, Agent returns a `scope_contamination` error instead of treating that payload as isolated Agent Knowledge.

Agent Knowledge writes are explicit-user-action paths. Slash commands that ingest, import, review issues, reindex, or run consolidation require `--yes`; ask/search/status/list/get/map/connector paths remain read-only.

## Ask And Search

Use Agent Workspace -> Knowledge -> Ask Agent Knowledge for source-backed Agent Knowledge answers. `/knowledge ask <query>` and `goodvibes-agent ask <query>` are scriptable equivalents over the same route. Default output is concise:

- answer text or a clear no-match state;
- confidence when present;
- sources, titles, and URLs when returned;
- facts, gaps, and refinement task ids only when the Agent Knowledge route returns them.

`--json` preserves the raw structured Agent route response for tooling after the scope-contamination guard accepts the payload.

The command layer does not turn search results into an answer locally and does not apply client-side filters to hide contamination. It rejects contaminated payloads; the connected host must still return Agent-owned data for the route to succeed.

Use Agent Workspace -> Knowledge -> Search Agent Knowledge for interactive search. `/knowledge search <query>` and `goodvibes-agent search <query>` query the isolated Agent Knowledge search route and render bounded results with title, id, type, score, source, URL, and snippets when available. Empty Agent stores return an explicit empty state.

Read-only inspection is available from the TUI Knowledge workspace first, with CLI equivalents for scripts:

- Source library and review queue in Agent Workspace -> Knowledge.
- `/knowledge list --kind sources|nodes|issues`
- `/knowledge get <id>`
- `/knowledge connectors`
- `/knowledge connector <connector-id>`
- `/knowledge connector-doctor <connector-id>`
- `/knowledge map`
- `/knowledge packet <task...> [--scope <path> ...]`
- `/knowledge explain <task...> [--scope <path> ...]`

The main assistant conversation can use the read-only `agent_knowledge` tool for the same isolated status, ask, search, source/node/issue list, item lookup, map, connector list, connector detail, and connector doctor workflows.

## Ingest

Use Agent Workspace -> Knowledge for URL, URL-list, file, bookmark, browser-history, connector ingest, issue review, consolidation, and reindex forms. The main assistant conversation can also call the confirmed `agent_knowledge_ingest` tool for URL, file, URL-list, bookmark, browser-history, and connector source families. `/knowledge ingest-url <url> --yes` and `goodvibes-agent knowledge ingest-url <url> --yes` ingest URL sources into Agent Knowledge only.

The TUI workspace exposes the common confirmed ingest, issue-review, consolidation, and reindex flows. The CLI also exposes Agent-specific batch routes for scripts:

- `goodvibes-agent knowledge import-urls <path> --yes`
- `goodvibes-agent knowledge import-bookmarks <path> --yes`
- `goodvibes-agent knowledge import-browser-history --yes`
- `/knowledge review-issue <issueId> <accept|reject|resolve|reopen|edit|forget> --yes`
- `/knowledge consolidate [light|deep] --yes`
- `goodvibes-agent knowledge reindex --yes`

Connected-host ingest and read CLI routes target `/api/goodvibes-agent/knowledge/*`. Workspace and slash-command issue review, packet/explain, consolidation, and reindex flows stay inside the isolated Agent Knowledge service. None of them call default knowledge.

Do not map local memory, notes, routines, skills, personas, or default knowledge documents into Agent Knowledge automatically. Durable source-backed facts can be ingested deliberately through Agent routes when the user or an explicit Agent workflow asks for it.

## Artifacts And Multimodal

Artifacts are first-class runtime objects for files, images, audio, video, generated outputs, and delegation results. Agent Knowledge use of artifacts must still go through Agent-specific ingest routes when those are available.

The saved artifact browser is available from Agent Workspace -> Artifacts -> Browse artifacts and through `agent_artifacts`. It lists recent uploads, exports, generated media, source artifacts, session artifacts, and comparison artifacts with filters for query, kind, MIME type, purpose, and source. `agent_artifacts mode:"show"` inspects one artifact by id with redacted metadata and a bounded preview for text-like content only; binary bytes and inline base64 stay out of the transcript.

Agent Workspace -> Voice & Media -> Generate media creates image/video artifacts through configured media providers after typed confirmation. The main conversation can perform the same confirmed action with the `agent_media_generate` tool when the user explicitly asks for generated media. Generated media output is summarized as artifact ids, MIME types, filenames, and source URLs when present; inline base64 is not printed into the transcript.

The model can use first-class tools for the common Knowledge, artifact, media, and comparison workflows: `agent_knowledge`, `agent_knowledge_ingest`, `agent_artifacts`, `agent_media_generate`, and `agent_model_compare`. Blind model comparison saves a local JSON artifact with the full prompt, blinded outputs, and reveal map while keeping model identities hidden in the transcript until reveal; saved artifacts can be reopened as blind review boards from Documents & Compare, converted into confirmed judgment artifacts, summarized as saved preference analytics, exported as local markdown reports, and applied to the main model route only through a separate confirmed winner-update action. `agent_harness` adds workspace-action lookup/execution, compact `modelRoute` hints in `workspace_actions`, `document_ops`/`document_ops_lane` readiness, `media_posture`/`media_provider` readiness, `sessions`/`session` bookmark and artifact posture, and confirmed slash-command mirrors when a visible workspace route maps to a concrete command.

Multimodal outputs should stay in the conversation, artifacts, local notes or memory, or explicit delegation results unless the user explicitly ingests a reviewed source through an Agent Knowledge route. They must not be inserted into default knowledge.

## Related Docs

- [Tools and commands](tools-and-commands.md)
- [Getting started](getting-started.md)
- [Release and publishing](release-and-publishing.md)
