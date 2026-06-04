# GoodVibes Agent Live Verification

Generated: 2026-06-04T11:02:12.690Z
Home: `[goodvibes-home]`
Binary: `[agent-binary]`
Connected host: `http://127.0.0.1:3421`

| Status | Count |
|---|---:|
| pass | 19 |
| warn | 0 |
| fail | 0 |
| skip | 0 |

| Check | Status | Summary |
|---|---|---|
| Verification inventory ledger | pass | 100% local verification signal across 761 inventory items. |
| Compiled GoodVibes Agent CLI binary | pass | Found [agent-binary]. |
| Agent CLI version command | pass | Agent CLI version returned successfully. |
| Agent CLI status JSON command | pass | Agent CLI status returned parseable JSON. |
| Agent CLI compatibility JSON command | pass | Agent CLI compatibility returned parseable JSON. |
| Agent Knowledge CLI status command | pass | Agent Knowledge status returned parseable JSON. |
| Agent CLI providers command | pass | Provider inventory rendered successfully. |
| CLI doctor command | pass | Doctor completed without findings. |
| Authenticated connected-host /status | pass | /status returned 200 with parseable JSON. |
| Authenticated connected-host /api/health | pass | Health overall=healthy. |
| OpenAI-compatible /v1/models route | pass | /v1/models returned 11 model(s). |
| Agent Knowledge isolated /status | pass | Agent Knowledge status route returned parseable isolated JSON. |
| Agent Knowledge isolated ask | pass | Agent Knowledge ask stayed on the isolated Agent route. |
| Agent Knowledge isolated search | pass | Agent Knowledge search stayed on the isolated Agent route. |
| Agent Knowledge isolated sources list | pass | Agent Knowledge isolated sources list stayed on the isolated Agent route. |
| Agent Knowledge isolated nodes list | pass | Agent Knowledge isolated nodes list stayed on the isolated Agent route. |
| Agent Knowledge isolated issues list | pass | Agent Knowledge isolated issues list stayed on the isolated Agent route. |
| Agent Knowledge isolated map | pass | Agent Knowledge isolated map stayed on the isolated Agent route. |
| Agent Knowledge isolated connectors list | pass | Agent Knowledge isolated connectors list stayed on the isolated Agent route. |

## Details

### Verification inventory ledger

```text
87.4% local behavior verified; 96 item(s) require external outcomes.
```

### Agent CLI version command

```text
goodvibes-agent 1.0.35
```

### Agent CLI status JSON command

```text
Status JSON command completed; provider/model identifiers omitted from release artifact.
```

### Agent CLI compatibility JSON command

```text
{
  "ok": true,
  "packageVersion": "1.0.35",
  "connectedHost": {
    "baseUrl": "http://127.0.0.1:3421",
    "status": 200,
    "reachable": true,
    "compatible": true
  },
  "auth": {
    "tokenPresent": true,
    "tokenPath": "env:GOODVIBES_CONNECTED_HOST_TOKEN"
  },
  "agentKnowledge": {
    "route": "/api/goodvibes-agent/knowledge/status",
    "ready": true,
    "kind": "ok"
  }
}
```

### Agent Knowledge CLI status command

```text
{
  "ok": true,
  "kind": "agentKnowledge.status",
  "route": "/api/goodvibes-agent/knowledge/status",
  "data": {
    "ready": true,
    "storagePath": "[goodvibes-home]/tui/knowledge-agent.sqlite",
    "sourceCount": 0,
    "nodeCount": 12,
    "edgeCount": 0,
    "issueCount": 0,
    "extractionCount": 0,
    "jobRunCount": 35,
    "refinementTaskCount": 0,
    "usageCount": 0,
    "candidateCount": 0,
    "reportCount": 2,
    "scheduleCount": 3,
    "note": "Structured knowledge uses SQL-backed sources, nodes, edges, issues, extractions, and job runs. Markdown is an optional projection, not the source of truth."
  }
}
```

### Agent CLI providers command

```text
Provider inventory command completed; provider names and credential posture omitted from release artifact.
```

### CLI doctor command

```text
Doctor command completed without findings; provider/model identifiers and credential posture omitted from release artifact.
```

### Authenticated connected-host /status

```text
{"status":"running"}
```

### Authenticated connected-host /api/health

```text
{"overall":"healthy","degradedDomains":[],"providerProblems":[],"mcpProblems":{"degraded":[],"quarantined":[]},"integrationProblems":[],"network":{"controlPlane":{"surface":"controlPlane","host":"0.0.0.0","port":3421,"mode":"off","scheme":"http","trustProxy":false,"usingDefaultPaths":false,"ready":true,"errors":[]},"httpListener":{"surface":"httpListener","host":"0.0.0.0","port":3422,"mode":"off","scheme":"http","trustProxy":false,"usingDefaultPaths":false,"ready":true,"errors":[]},"outbound":{"mode":"bundled","allowInsecureLocalhost":false,"customCaEntryCount":0,"effectiveCaStrategy":"bun-default","errors":[]}}}
```

### OpenAI-compatible /v1/models route

```text
/v1/models returned 11 model(s); model identifiers omitted from release artifact.
```

### Agent Knowledge isolated /status

```text
{"ready":true,"storagePath":"[goodvibes-home]/tui/knowledge-agent.sqlite","sourceCount":0,"nodeCount":12,"edgeCount":0,"issueCount":0,"extractionCount":0,"jobRunCount":35,"refinementTaskCount":0,"usageCount":0,"candidateCount":0,"reportCount":2,"scheduleCount":3,"note":"Structured knowledge uses SQL-backed sources, nodes, edges, issues, extractions, and job runs. Markdown is an optional projection, not the source of truth."}
```

### Agent Knowledge isolated ask

```text
{"ok":true,"spaceId":"goodvibes-agent:default","query":"What is GoodVibes Agent?","answer":{"text":"No knowledge matched \"What is GoodVibes Agent?\".","mode":"concise","confidence":0,"sources":[],"linkedObjects":[],"facts":[],"gaps":[],"synthesized":false},"results":[]}
```

### Agent Knowledge isolated search

```text
{"results":[]}
```

### Agent Knowledge isolated sources list

```text
{"sources":[]}
```

### Agent Knowledge isolated nodes list

```text
{"nodes":[{"id":"node-38d4924f","kind":"topic","slug":"linked-to-26-graph-relation-s","title":"linked to 26 graph relation(s)","summary":"Topic tag linked to 26 graph relation(s).","aliases":["linked to 26 graph relation(s)"],"status":"active","confidence":70,"metadata":{"tag":"linked to 26 graph relation(s)","knowledgeSpaceId":"goodvibes-agent:default","namespace":"goodvibes-agent:default"},"createdAt":1780489632675,"updatedAt":1780489632928},{"id":"node-4014fce2","kind":"topic","slug":"observed-via-2-usage-pattern-s","title":"observed via 2 usage pattern(s)","summary":"Topic tag observed via 2 usage pattern(s).","aliases":["observed via 2 usage pattern(s)"],"status":"active","confidence":70,"metadata":{"tag":"observed via 2 usage pattern(s)","knowledgeSpaceId":"goodvibes-agent:default","namespace":"goodvibes-agent:default"},"createdAt":1780489632666,"updatedAt":17804896... [truncated]
```

### Agent Knowledge isolated issues list

```text
{"issues":[]}
```

### Agent Knowledge isolated map

```text
{"ok":true,"title":"Knowledge Map","generatedAt":1780570932688,"width":1280,"height":920,"nodeCount":12,"edgeCount":0,"totalNodeCount":12,"totalEdgeCount":0,"facets":{"recordKinds":[{"value":"node","count":12}],"nodeKinds":[{"value":"topic","count":12}],"sourceTypes":[],"sourceStatuses":[],"nodeStatuses":[{"value":"active","count":12}],"issueCodes":[],"issueStatuses":[],"issueSeverities":[],"edgeRelations":[],"tags":[]},"nodes":[{"id":"node-d2a534ae","recordKind":"node","kind":"topic","title":"linked to 19 graph relation(s)","summary":"Topic tag linked to 19 graph relation(s).","x":720,"y":277,"radius":23,"metadata":{"tag":"linked to 19 graph relation(s)","knowledgeSpaceId":"goodvibes-agent:default","namespace":"goodvibes-agent:default"}},{"id":"node-0cc2f686","recordKind":"node","kind":"topic","title":"linked to 20 graph relation(s)","summary":"Topic tag linked to 20 gra... [truncated]
```

### Agent Knowledge isolated connectors list

```text
{"connectors":[{"id":"bookmark","displayName":"Bookmarks Import","version":"1","description":"Parse bookmark exports or bookmark-like JSON into bookmark seeds.","sourceType":"bookmark","capabilities":["bookmark-export","netscape-html","bookmark-json"],"inputSchema":{"type":"string","description":"Bookmark export content such as Netscape bookmark HTML or bookmark-like JSON."},"examples":["<!DOCTYPE NETSCAPE-Bookmark-file-1>..."],"metadata":{"accepts":["inline-content","file-content"],"preferredContentType":"text/html","transportHints":["content","path"]},"setup":{"version":"1","summary":"Imports bookmark export files or bookmark-like JSON payloads.","steps":["Export bookmarks from a browser as Netscape-style HTML or supply bookmark-like JSON.","Send the content directly or provide a file path to the ingest endpoint."],"fields":[{"key":"content","label":"Bookmark Content","... [truncated]
```

Result: PASS
