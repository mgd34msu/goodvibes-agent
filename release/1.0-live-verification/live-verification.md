# GoodVibes Agent Live Verification

Generated: 2026-06-03T14:11:27.495Z
Home: `[goodvibes-home]`
Binary: `[agent-binary]`
Connected host: `http://127.0.0.1:3421`

| Status | Count |
|---|---:|
| pass | 14 |
| warn | 0 |
| fail | 0 |
| skip | 0 |

| Check | Status | Summary |
|---|---|---|
| Verification inventory ledger | pass | 100% local verification signal across 410 inventory items. |
| Compiled GoodVibes Agent CLI binary | pass | Found [agent-binary]. |
| Agent CLI version command | pass | Agent CLI version returned successfully. |
| Agent CLI status JSON command | pass | Agent CLI status returned parseable JSON. |
| Agent CLI compatibility JSON command | pass | Agent CLI compatibility returned parseable JSON. |
| Agent Knowledge CLI status command | pass | Agent Knowledge status returned parseable JSON. |
| Agent CLI providers command | pass | Provider inventory rendered successfully. |
| CLI doctor command | pass | Doctor completed without findings. |
| Authenticated connected-host /status | pass | /status returned 200, version 0.33.35. |
| Authenticated connected-host /api/health | pass | Health overall=healthy. |
| OpenAI-compatible /v1/models route | pass | /v1/models returned 130 model(s). |
| Agent Knowledge isolated /status | pass | Agent Knowledge status route returned parseable JSON. |
| Agent Knowledge isolated ask | pass | Agent Knowledge ask stayed on the isolated Agent route. |
| Agent Knowledge isolated search | pass | Agent Knowledge search stayed on the isolated Agent route. |

## Details

### Verification inventory ledger

```text
79.5% local behavior verified; 84 item(s) require external outcomes.
```

### Agent CLI version command

```text
goodvibes-agent 0.1.117
```

### Agent CLI status JSON command

```text
Status JSON command completed; provider/model identifiers omitted from release artifact.
```

### Agent CLI compatibility JSON command

```text
{
  "ok": true,
  "packageVersion": "0.1.117",
  "sdkPin": "0.33.35",
  "connectedHost": {
    "baseUrl": "http://127.0.0.1:3421",
    "status": 200,
    "version": "0.33.35",
    "reachable": true,
    "compatible": true
  },
  "auth": {
    "tokenPresent": true,
    "tokenPath": "[goodvibes-home]/daemon/operator-tokens.json"
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
    "jobRunCount": 14,
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
{"status":"running","version":"0.33.35"}
```

### Authenticated connected-host /api/health

```text
{"overall":"healthy","degradedDomains":[],"providerProblems":[],"mcpProblems":{"degraded":[],"quarantined":[]},"integrationProblems":[],"network":{"controlPlane":{"surface":"controlPlane","host":"0.0.0.0","port":3421,"mode":"off","scheme":"http","trustProxy":false,"usingDefaultPaths":false,"ready":true,"errors":[]},"httpListener":{"surface":"httpListener","host":"0.0.0.0","port":3422,"mode":"off","scheme":"http","trustProxy":false,"usingDefaultPaths":false,"ready":true,"errors":[]},"outbound":{"mode":"bundled","allowInsecureLocalhost":false,"customCaEntryCount":0,"effectiveCaStrategy":"bun-default","errors":[]}}}
```

### OpenAI-compatible /v1/models route

```text
/v1/models returned 130 model(s); model identifiers omitted from release artifact.
```

### Agent Knowledge isolated /status

```text
{"ready":true,"storagePath":"[goodvibes-home]/tui/knowledge-agent.sqlite","sourceCount":0,"nodeCount":12,"edgeCount":0,"issueCount":0,"extractionCount":0,"jobRunCount":14,"refinementTaskCount":0,"usageCount":0,"candidateCount":0,"reportCount":2,"scheduleCount":3,"note":"Structured knowledge uses SQL-backed sources, nodes, edges, issues, extractions, and job runs. Markdown is an optional projection, not the source of truth."}
```

### Agent Knowledge isolated ask

```text
{"ok":true,"spaceId":"default","query":"What is GoodVibes Agent?","answer":{"text":"No knowledge matched \"What is GoodVibes Agent?\".","mode":"concise","confidence":0,"sources":[],"linkedObjects":[],"facts":[],"gaps":[],"synthesized":false},"results":[]}
```

### Agent Knowledge isolated search

```text
{"results":[]}
```

Result: PASS
