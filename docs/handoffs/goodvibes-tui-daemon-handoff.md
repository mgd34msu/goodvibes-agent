# GoodVibes TUI Daemon — Handoff Document

**Project**: goodvibes-tui (daemon host)
**Date**: 2026-06-20
**Status**: Agent-side seams are complete and frozen. Daemon-side contracts are unshipped.
**Audience**: goodvibes-tui daemon implementors

---

## Overview

The `goodvibes-agent` codebase has completed all agent-side implementation for five capability
surfaces. Each surface contains a clearly-marked seam — a typed sentinel value, a
`daemonMethodNeeded` constant, or a `daemonSyncState: 'local_only'` flag — that acts as a
compile-time contract gap. This document specifies exactly what the goodvibes-tui daemon must
implement to light each seam up, including operator method IDs, input/output shapes,
confirmation-boundary semantics, and certified receipt artifacts the agent needs.

---

## Already Published vs. To-Publish Table

| Operator Method / Route | Status | Agent Consumer |
|---|---|---|
| `remote.snapshot` / `GET /api/remote` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:82` |
| `remote.peers.list` / `GET /api/remote/peers` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:98` |
| `remote.work.list` / `GET /api/remote/work` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:114` |
| `remote.pair.requests.list` / `GET /api/remote/pair/requests` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:129` |
| `remote.pair.requests.approve` / `POST /api/remote/pair/requests/{id}/approve` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:147` |
| `remote.pair.requests.reject` / `POST /api/remote/pair/requests/{id}/reject` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:163` |
| `remote.peers.invoke` / `POST /api/remote/peers/{peerId}/invoke` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:188` |
| `remote.work.cancel` / `POST /api/remote/work/{id}/cancel` | **PUBLISHED** | `src/tools/agent-harness-remote.ts:208` |
| IMAP/SMTP direct client | **SHIPPED (agent-side)** | `src/agent/email/email-service.ts` |
| `.ics` calendar generation | **SHIPPED (agent-side)** | `src/agent/email/` |
| `channels.inbox.list` | **NOT PUBLISHED** | `src/agent/unified-inbox.ts:116` |
| `channels.routing.list` | **NOT PUBLISHED** | `src/agent/channel-profile-routing.ts:62-67` |
| `channels.routing.assign` | **NOT PUBLISHED** | `src/agent/channel-profile-routing.ts:67` |
| `channels.routing.delete` | **NOT PUBLISHED** | `src/agent/channel-profile-routing.ts` |
| `channels.drafts.list` | **NOT PUBLISHED** | `src/agent/channel-draft.ts:22` |
| `channels.drafts.get` | **NOT PUBLISHED** | `src/agent/channel-draft.ts:22` |
| `channels.drafts.save` | **NOT PUBLISHED** | `src/agent/channel-draft.ts:22` |
| `channels.drafts.delete` | **NOT PUBLISHED** | `src/agent/channel-draft.ts:22` |
| `email.inbox.list` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `email.inbox.read` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `email.draft.create` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `email.send` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `calendar.events.list` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `calendar.events.get` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `calendar.events.create` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `calendar.ics.import` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| `calendar.ics.export` | **NOT PUBLISHED** | `src/agent/email/style-reply-lane.ts` |
| Email auto-tag / spam-triage (`inbox.triage.*`) | **NOT PUBLISHED** (daemon-internal pipeline; not a published operator method) | `src/agent/email/style-reply-lane.ts` |
| Docker backend (`backendKind: "docker"`) | **NOT PUBLISHED** — daemon-internal peer registration; no new agent-facing method | `src/tools/agent-harness-remote.ts:188` |
| SSH backend (`backendKind: "ssh"`) | **NOT PUBLISHED** — daemon-internal peer registration; no new agent-facing method | `src/tools/agent-harness-remote.ts:188` |
| Cloud terminal backend (`backendKind: "cloud-terminal"`) | **NOT PUBLISHED** — daemon-internal peer registration; no new agent-facing method | `src/tools/agent-harness-remote.ts:188` |

---

## Responsibility 1 — Inbound Provider Polling and `channels.inbox.list`

### What the Daemon Must Do

Poll configured provider inboxes (Slack DMs, Discord DMs, email threads, webhook inbound
queues, Telegram DMs, Matrix rooms, etc.) on a configurable cadence and aggregate them into
a unified inbound feed. The agent has no persistent connection to any of these providers; the
daemon owns all provider credentials, polling loops, deduplication, and rate-limit compliance.

The agent-side seam is at:

```
src/agent/unified-inbox.ts:115-117   InboundChannelFeedState discriminated union
src/agent/unified-inbox.ts:133-141   inboundChannelFeed field on UnifiedInbox
src/agent/unified-inbox.ts:337-341   Hard-coded { available: false, reason: 'contract_not_published',
                                       daemonMethodNeeded: 'channels.inbox.list' }
```

The comment block at `src/agent/unified-inbox.ts:11-16` is the authoritative integration note:

> "When the daemon publishes a `channels.inbox.*` operator method or a matching REST endpoint,
> add an adapter here by implementing `InboundChannelFeedAdapter` and registering it in
> `aggregateUnifiedInbox`."

### Operator Methods to Publish

**`channels.inbox.list`**

```
Input:
  {
    providers?: string[];      // e.g. ["slack", "discord", "email"] — omit for all
    limit?: number;            // max items per provider, default 50
    since?: number;            // Unix ms timestamp; return items newer than this
  }

Output:
  {
    items: InboundChannelItem[];
    nextSince: number;         // use as `since` on next call for incremental polling
    providers: {
      id: string;              // e.g. "slack"
      state: "ready" | "unavailable" | "empty";
      itemCount: number;
      error?: string;          // present only when state === "unavailable"
    }[];
  }

InboundChannelItem:
  {
    id: string;                // stable item id (provider-scoped dedup key)
    provider: string;          // "slack" | "discord" | "email" | "telegram" | ...
    kind: "dm" | "thread" | "mention" | "reaction";
    fromDigest: string;        // SHA-256 first-8 of sender external id — NEVER raw id
    subjectPreview: string;    // <= 200 chars, safe for display
    bodyPreview: string;       // <= 500 chars, plain text, stripped of PII per policy
    routeId?: string;          // if known, the daemon route binding id
    receivedAt: number;        // Unix ms
    unread: boolean;
  }
```

**Confirmation / Effect Semantics**: Read-only. No provider write. No confirmation required.
The agent calls this as a polling read; side effects are strictly forbidden.

**Certified Receipt Artifacts**: The agent needs `items[].id` to be stable across polls
(idempotent deduplication key) and `nextSince` to advance the window without gaps. The
`providers[].state` field must be `"unavailable"` (not omitted) when a provider is
misconfigured — the agent uses this to update its `UnifiedInboxSource.state` field.

**Polling Cadence**: The daemon should poll providers at intervals appropriate to their
rate limits. The agent does not initiate polling; it calls `channels.inbox.list` with
`since=lastSeen` and trusts the daemon to have collected upstream items since that timestamp.
Suggested daemon-side cadence: Slack/Discord 30s, email IMAP IDLE or 60s, others 120s.

**Secret / Credential Posture**: All provider credentials (Slack tokens, Discord bot tokens,
IMAP passwords) are stored exclusively in the daemon's credential store (the agent's SecretsManager
is for agent-local secrets only). The agent never receives raw provider credentials from
`channels.inbox.list` — only the digested `fromDigest` sender identifier.

**Redaction Policy**: `bodyPreview` must be truncated to 500 chars and must not contain
raw email addresses, phone numbers, or OAuth tokens. `fromDigest` replaces all raw sender
identifiers in the response payload.

**Agent Consumer**: `src/agent/unified-inbox.ts`
Once this method is published, add an `InboundChannelFeedAdapter` implementation in
`aggregateUnifiedInbox` (line 236) that calls the operator method and maps the response
into `UnifiedInboxItem[]`. Replace the hard-coded `{ available: false }` block at line 337.

---

## Responsibility 2 — Channel-to-Profile Routing Control Plane

### What the Daemon Must Do

Own the authoritative channel-to-profile routing table at runtime. Today the agent persists
assignments locally in a JSON file (`{agentRoot}/channels/profile-routes.json`) and all
records carry `daemonSyncState: 'local_only'` and `daemonMethodNeeded: 'channels.routing.assign'`.
The daemon must accept, store, and serve these assignments so that inbound messages on any
surface are routed to the correct isolated agent profile/session — not just the default session.

The agent-side seam is at:

```
src/agent/channel-profile-routing.ts:62    daemonSyncState: 'local_only'  (on ChannelProfileRoute)
src/agent/channel-profile-routing.ts:67    daemonMethodNeeded: 'channels.routing.assign'
src/agent/channel-profile-routing.ts:141   parseRoute() always sets daemonSyncState: 'local_only'
src/agent/channel-profile-routing.ts:197-198  SEAM comment on assignChannelToProfile()
src/agent/channel-profile-routing.ts:236   route object always built with daemonSyncState: 'local_only'
```

The comment at lines 13-26 is the authoritative integration note:

> "When the daemon method ships: 1. Add an adapter that calls operator.invoke('channels.routing.assign', ...).
> 2. Mirror the local store for offline fallback. 3. Remove the `daemonSyncState: 'local_only'` flag."

### Operator Methods to Publish

**`channels.routing.list`**

```
Input:
  {
    profileId?: string;    // filter by profile
    surfaceKind?: string;  // filter by surface ("slack", "discord", "any", ...)
  }

Output:
  {
    routes: ChannelRoute[];
  }

ChannelRoute:
  {
    assignmentId: string;
    channelId: string;       // surfaceKind[:routeId] composite key
    surfaceKind: string;
    routeId?: string;
    profileId: string;
    label?: string;
    createdAt: string;       // ISO 8601
    updatedAt: string;
  }
```

**`channels.routing.assign`** (the primary seam method)

```
Input:
  {
    channelId: string;      // surfaceKind or surfaceKind:routeId
    profileId: string;
    label?: string;
  }

Output:
  {
    assignmentId: string;
    channelId: string;
    profileId: string;
    created: boolean;       // true if new, false if updated
  }
```

**`channels.routing.delete`**

```
Input:
  {
    assignmentId: string;
  }

Output:
  {
    deleted: boolean;
  }
```

**Confirmation / Effect Semantics**: `channels.routing.assign` and `channels.routing.delete`
are control-plane mutations. They change which profile processes future inbound messages on
a channel. Both require `confirmationRequired: true` in the agent_operator_method call,
with an `explicitUserRequest` from the active user. `channels.routing.list` is read-only,
no confirmation.

**Certified Receipt Artifacts**: `channels.routing.assign` must return `assignmentId` in
the response. The agent uses this to transition `daemonSyncState` from `'local_only'` to
a synced state (the TypeScript union will need a new `'synced'` branch added). The local
JSON store at `profile-routes.json` acts as offline fallback until the daemon confirms.

**Routing Logic**: The daemon must implement the same resolution order as the agent's
`getProfileForChannel()` function (lines 272-295): exact match (surfaceKind + routeId),
then surface-only match (surfaceKind, no routeId), then wildcard (`surfaceKind === 'any'`).
This ensures offline and online routing produce identical results.

**Agent Consumer**: `src/agent/channel-profile-routing.ts`
Once published, add a daemon call inside `assignChannelToProfile()` (line 200) and update
`parseRoute()` (line 123) to handle a `'synced'` state when the returned record includes
`assignmentId` from the daemon.

---

## Responsibility 3 — Draft Sync Backend (`channels.drafts.*`)

### What the Daemon Must Do

Mirror the agent's local draft store (`{agentRoot}/channels/drafts.json`) server-side so
drafts are visible across surfaces (TUI session on one machine, web client on another).
Today drafts are strictly agent-local; the seam comment at `src/agent/channel-draft.ts:20-22`
names the exact gap:

> "SEAM — a future daemon `channels.drafts.*` operator method could mirror this store
> server-side for multi-surface sync. The local model is the source of truth until that
> contract is published."

The existing confirmed send path is already wired and must NOT change:
`queueDraftToSend()` (line 311) produces an `AgentChannelDeliveryInput`, which the caller
passes to `deliverAgentChannelMessage()` in `src/agent/channel-delivery.ts:155`. That
function calls `context.platform.channelDeliveryRouter.deliver()` — this path is complete
and requires no daemon changes.

### Operator Methods to Publish

**`channels.drafts.list`**

```
Input:
  {
    status?: "draft" | "queued" | "sent" | "failed";
    limit?: number;   // default 50, max 200
  }

Output:
  {
    drafts: DraftRecord[];
  }

DraftRecord:
  {
    id: string;
    createdAt: string;      // ISO 8601
    updatedAt: string;
    status: "draft" | "queued" | "sent" | "failed";
    title?: string;
    messageDigest: string;  // SHA-256 first-12 of body — body is NOT transmitted
    channel?: string;
    route?: string;
    webhook?: string;       // MUST be redacted in daemon storage
    link?: string;
    tags?: string[];
    sentResponseId?: string;
    sendError?: string;
  }
```

**`channels.drafts.get`**

```
Input:
  {
    id: string;
  }

Output:
  DraftRecord | { notFound: true; id: string; }
```

**Confirmation / Effect Semantics**: Read-only, no confirmation.

**`channels.drafts.save`**

```
Input:
  {
    id?: string;           // omit to create; provide to update
    title?: string;
    message: string;       // full body — daemon stores encrypted at rest
    channel?: string;
    route?: string;
    webhook?: string;      // daemon must redact in all list/read responses
    link?: string;
    tags?: string[];
    status?: "draft" | "queued";
  }

Output:
  {
    id: string;
    created: boolean;
  }
```

**`channels.drafts.delete`**

```
Input:
  {
    id: string;
  }

Output:
  {
    deleted: boolean;
  }
```

**Confirmation / Effect Semantics**: `channels.drafts.list` is read-only, no confirmation.
`channels.drafts.save` and `channels.drafts.delete` are local-state mutations (no external
provider effect), so they do NOT require `confirm:true` — but the daemon must enforce that
the `message` body in `channels.drafts.save` is encrypted at rest (the agent's local JSON
is plaintext; the daemon sync target must not be).

**Webhook Redaction**: Any `webhook` field stored server-side must be redacted (replaced
with `[redacted]`) in all list and read responses. The full URL is only needed at send time,
and send routes through `deliverAgentChannelMessage` on the agent side, not through the daemon.

**Sync Model**: The agent's local file is source of truth. The daemon is a sync mirror for
cross-surface visibility. On conflict (both sides modified same draft), the most recent
`updatedAt` timestamp wins. The agent does not need to poll; it can push to
`channels.drafts.save` on every local write once the contract is live.

**Agent Consumer**: `src/agent/channel-draft.ts`
Once published, add daemon calls in `saveDraft()` (line 217), `deleteDraft()` (line 292),
and `listDrafts()` (line 270) to mirror operations to the daemon. The local file at
`channelDraftFilePath()` (line 104) remains the offline fallback.

---

## Responsibility 4 — CalDAV Calendar Connectors and Email Auto-Tag / Spam Triage

### What the Daemon Must Do

**CalDAV Server Sync**: The agent ships a complete IMAP client (`src/agent/email/imap-client.ts`),
SMTP client (`src/agent/email/smtp-client.ts`), and `.ics` generation capability. What is NOT
shipped is bidirectional CalDAV sync to the user's calendar server (Google Calendar, Nextcloud,
Fastmail, etc.). The daemon must implement a CalDAV connector that:

1. Authenticates to the user's CalDAV endpoint using credentials from the daemon credential store.
2. Pushes `.ics` objects generated by the agent (received via operator method) to the correct
   calendar collection.
3. Polls the CalDAV server for new/updated events and makes them available to the agent via
   a read method.

The `style-reply-lane.ts` integration point at `src/agent/email/style-reply-lane.ts:85` names
the capability gap:

> "Configure email (email.enabled=true, IMAP+SMTP or an MCP inbox connector) before using
> style-matched drafts."

The `hasEmailCapability` boolean (line 48) must also return `true` when CalDAV sync is
available — the daemon should advertise its capabilities so the agent can update this flag.

**Email Auto-Tagging / Spam Triage**: The agent's `EmailService.checkInbox()` (line 242 in
`src/agent/email/email-service.ts`) performs a basic IMAP EXAMINE (read-only) to retrieve
unseen messages. It does not apply labels, tags, or spam scoring. The daemon must implement:

1. A spam/triage scoring pipeline (Bayesian or ML-based) that runs against inbound items
   fetched from `channels.inbox.list`.
2. A tagging system that applies user-defined labels to inbound items on the provider side
   (IMAP STORE flags, Slack emoji reactions, Discord thread tags).
3. An operator method surface for the agent to trigger or query triage results.

### Operator Methods to Publish

The canonical published operator method IDs for calendar and email are defined by the SDK handoff document. The daemon must implement exactly these IDs:

**`email.inbox.list`** (IMAP inbox via operator method protocol)

```
Input:
  {
    limit?: number;        // default 10, max 100
    since?: string;        // ISO 8601 date for SINCE search
    unreadOnly?: boolean;  // default true
  }

Output:
  {
    messages: Array<{
      uid: number;         // IMAP UID
      from: string;
      subject: string;
      date: string;
      unread: boolean;
      bodyPreview: string;
      messageId: string;
    }>;
    total: number;
  }
```

**Confirmation / Effect Semantics**: Read-only-network, no confirmation.

**`email.inbox.read`** (fetch full message body)

```
Input:
  { uid: number; }

Output:
  {
    uid: number;
    from: string;
    subject: string;
    date: string;
    messageId: string;
    bodyText: string;
    bodyHtml?: string;
    attachments?: Array<{ filename: string; contentType: string; sizeBytes: number }>;
  }
```

**Confirmation / Effect Semantics**: Read-only-network (BODY.PEEK, does not mark as read). No confirmation.

**`email.draft.create`** (append to IMAP Drafts folder)

```
Input:
  {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    confirm: true;
  }

Output:
  {
    uid: number;       // IMAP UID in Drafts folder
    draftId: string;
  }
```

**Confirmation / Effect Semantics**: `confirmed-effect` — appends to IMAP Drafts. Requires `confirm:true`.

**`email.send`** (SMTP send via operator method protocol)

```
Input:
  {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    confirm: true;     // REQUIRED — daemon must reject if absent
  }

Output:
  {
    messageId: string;
    sentAt: string;
  }
```

**Confirmation / Effect Semantics**: `confirmed-effect` — external email send, irreversible. Requires `confirm:true`.

**`calendar.events.list`** (CalDAV read)

```
Input:
  {
    calendarId?: string;   // omit for default calendar
    from?: string;         // ISO 8601 range start
    to?: string;           // ISO 8601 range end
    limit?: number;        // default 20
  }

Output:
  {
    events: CalendarEventSummary[];
  }

CalendarEventSummary:
  {
    id: string;
    title: string;         // SUMMARY field
    start: string;         // ISO 8601
    end: string;
    location?: string;
    description?: string;
    attendees?: string[];  // display names only, no raw addresses
  }
```

**Confirmation / Effect Semantics**: Read-only-network. No confirmation.

**`calendar.events.get`** (single event fetch)

```
Input:
  { eventId: string; calendarId?: string; }

Output:
  Full event object including attendees, recurrence, and raw iCalendar UID.
```

**Confirmation / Effect Semantics**: Read-only-network. No confirmation.

**`calendar.events.create`** (CalDAV write — canonical replacement for the former `calendar.events.push`)

```
Input:
  {
    title: string;
    start: string;         // ISO 8601
    end: string;
    description?: string;
    attendees?: string[];
    location?: string;
    calendarId?: string;
    confirm: true;
  }

Output:
  {
    eventId: string;       // CalDAV href or UID
    uid: string;
    createdAt: string;
  }
```

**Confirmation / Effect Semantics**: `confirmed-effect` — writes to the user's CalDAV server. Requires `confirm:true` and `explicitUserRequest`.

**`calendar.ics.import`** (import raw .ics to CalDAV)

```
Input:
  {
    icsContent: string;    // full RFC 5545 .ics object
    calendarId?: string;
    confirm: true;
  }

Output:
  { imported: number; eventIds: string[]; errors: string[] }
```

**Confirmation / Effect Semantics**: `confirmed-effect`. Requires `confirm:true`.

**`calendar.ics.export`** (export calendar as .ics)

```
Input:
  { calendarId?: string; from?: string; to?: string; }

Output:
  { icsContent: string; eventCount: number }
```

**Confirmation / Effect Semantics**: Read-only. No confirmation.

**Daemon-internal: Email Auto-Tagging / Spam Triage (`inbox.triage.*`)**

The triage pipeline (`inbox.triage.list`, `inbox.triage.tag`) is a daemon-internal capability used for pre-scoring inbound items from `channels.inbox.list`. These are NOT published operator methods that the agent calls directly; they are internal daemon steps. The agent receives pre-scored results via `channels.inbox.list` response metadata. If the daemon team decides to expose triage as a separate operator method surface in the future, those method IDs must be defined in a separate handoff and must not conflict with the canonical email/calendar IDs above.

**Certified Receipt Artifacts**: `calendar.events.create` must return `eventId` for the agent to record in the draft/confirmation boundary. `email.send` must return `messageId` and `sentAt`.

**CalDAV Credential Posture**: CalDAV credentials must never appear in operator method
responses. The daemon resolves them internally from its credential store. The `calendarId`
in requests is a logical identifier, not an authenticated URL.

**Agent Consumer**: `src/agent/email/style-reply-lane.ts` and `src/agent/email/email-service.ts`
The `hasEmailCapability` flag in `style-reply-lane.ts` (line 48) should be extended to check
for CalDAV connector availability via a daemon capability query. `checkInbox()` in
`email-service.ts` (line 242) can optionally be supplemented by `email.inbox.list` when the
daemon is connected, delegating IMAP access to the daemon's operator method path. Spam/triage
scoring is a daemon-internal pipeline; the agent does not call `inbox.triage.*` directly.

---

## Responsibility 5 — Remote Execution Backends (Docker / SSH / Cloud Terminal)

### What the Daemon Must Do

The `remote.*` operator methods (`remote.peers.invoke`, `remote.work.*`) are fully published
and consumed by the agent (see Already Published table above). The current daemon implementation
routes `remote.peers.invoke` to whatever command dispatch is wired for a given peer. What is
missing is the concrete execution backend layer that allows the daemon to dispatch commands
to:

1. **Docker containers** — run a command in a named container on the connected host.
2. **SSH targets** — execute a command on a remote host via SSH using key-based auth from
   the daemon credential store.
3. **Cloud terminal** — execute a command in a cloud shell environment (e.g. Google Cloud
   Shell, AWS CloudShell) via a provider API.

These backends are invoked transparently through the existing `remote.peers.invoke` surface.
The agent does not need new operator methods — it already calls:

```
remote.peers.invoke  →  POST /api/remote/peers/{peerId}/invoke
Input: { peerId, command, payload? }
```

(See `src/tools/agent-harness-remote.ts:188-199`)

The daemon must register peer records with a `backendKind` field that indicates which backend
handles dispatch for that peer. Execution results are returned synchronously or via the
existing `remote.work.*` work-item lifecycle (`remote.work.list`, `remote.work.cancel`).

### Backend Registration Contract

**`remote.peers.register`** (daemon-internal, optionally exposed)

```
Input:
  {
    peerId: string;          // stable peer identifier
    displayName: string;
    backendKind: "docker" | "ssh" | "cloud-terminal" | "local-process";
    backendConfig: {
      // For "docker":
      containerName?: string;
      dockerHost?: string;   // daemon resolves credentials internally

      // For "ssh":
      sshHost?: string;
      sshPort?: number;
      sshUser?: string;
      identityRef?: string;  // goodvibes://secrets/ reference

      // For "cloud-terminal":
      provider?: "gcp" | "aws" | "azure";
      projectId?: string;
      credentialRef?: string;
    };
  }
```

**Dispatch Semantics for `remote.peers.invoke`**

When the daemon receives `remote.peers.invoke { peerId, command, payload }`, it must:

1. Look up the peer's `backendKind` from the registered peer table.
2. Dispatch the command to the appropriate backend:
   - `docker`: run `docker exec {containerName} {command}` on the local Docker socket.
   - `ssh`: establish (or reuse from pool) an SSH connection to the target host and exec.
   - `cloud-terminal`: call the provider API (e.g. GCP `RunCommandRequest`) with `command`.
3. Return stdout/stderr/exit code in the invoke response, or enqueue as a work item for
   long-running commands.
4. Long-running invocations must create a work item visible in `remote.work.list` so the
   agent can poll status and call `remote.work.cancel` if needed.

**Confirmation / Effect Semantics**: `remote.peers.invoke` already carries `confirmationRequired: true`
and `effect: 'confirmed-connected-host-state'` on the agent side
(see `src/tools/agent-harness-remote.ts:36-37`). The daemon must enforce that no invocation
proceeds without the agent having passed `confirm:true` and `explicitUserRequest`. The daemon
should reject invocations that lack these fields.

**Certified Receipt Artifacts**: The agent needs the invoke response to include:
- `workId` — if the command is async, so it can track via `remote.work.list`.
- `exitCode` — if the command is sync, confirming completion.
- `stdoutDigest` — SHA-256 of the full stdout for integrity, since the agent may receive
  only a truncated preview.

**Credential Posture**: SSH private keys, Docker TLS client certs, and cloud API tokens are
stored exclusively in the daemon's credential store. The `identityRef` and `credentialRef`
fields in `backendConfig` are `goodvibes://secrets/` references. The agent never sees raw
credentials in any `remote.*` response.

**Agent Consumer**: `src/tools/agent-harness-remote.ts`
No agent-side code changes are required. The existing `remotePeersInvokeHandoff()` at line
181 already produces the correct `agent_operator_method` handoff. The agent will light up
automatically once the daemon routes `remote.peers.invoke` to Docker/SSH/cloud backends and
creates the peer records with `backendKind`.

---

## Recommended Sequencing

| Phase | Capability | Unblocks |
|---|---|---|
| **1** | `channels.routing.assign/list/delete` | Profile-isolated inbound routing; foundational for all provider inbound work |
| **2** | `channels.inbox.list` with Slack + Discord providers | Unified inbox inbound feed; allows agent to surface unread DMs |
| **3** | Remote execution backends (Docker first, then SSH) | Peer-invoke already shipped on agent side; Docker is lowest-friction backend |
| **4** | `channels.drafts.*` sync | Cross-surface draft visibility; blocked only by UX priority, not technical dependency |
| **5** | `channels.inbox.list` email provider | Requires daemon IMAP credential store; email-service.ts already has IMAP client for reference |
| **6** | CalDAV connector (`calendar.events.*`) | Depends on credential store patterns established in phase 5 |
| **7** | Email auto-tag / spam triage (`inbox.triage.*`) | Requires phase 2 inbox feed to have items to score |
| **8** | Cloud terminal backend for remote execution | Requires provider API integration; lowest urgency, SSH covers most cases |

### Rationale

Routing (phase 1) is foundational because the daemon needs to know which profile owns an
inbound channel before it can route any provider event. Inbox list (phase 2) delivers the
first user-visible value. Docker remote execution (phase 3) is already fully scaffolded on
the agent side and requires only a daemon peer registration + backend wiring — the smallest
surface area for the highest return. Drafts (phase 4) are agent-local today and the UX gap
is minor. Email CalDAV and triage (phases 5-7) share a credential store dependency and
should be sequenced together. Cloud terminal (phase 8) is additive.

---

## Integration Checklist (Per Responsibility)

### Channels Inbox (`channels.inbox.list`)
- [ ] Daemon polls Slack DMs via Slack Events API or RTM
- [ ] Daemon polls Discord DMs via Discord Gateway
- [ ] Daemon polls IMAP inbox (can reuse patterns from `src/agent/email/imap-client.ts`)
- [ ] All `fromDigest` values are SHA-256 of provider user id, first 16 hex chars
- [ ] `bodyPreview` truncated to 500 chars, no PII
- [ ] `nextSince` advances monotonically across polls
- [ ] Provider credentials in daemon credential store only

### Channel Routing (`channels.routing.*`)
- [ ] `channels.routing.assign` persists to daemon DB
- [ ] Resolution order matches agent: exact > surface-only > wildcard
- [ ] Response includes `assignmentId` for agent to transition `daemonSyncState`
- [ ] `channels.routing.assign` and `channels.routing.delete` require `confirm:true`

### Draft Sync (`channels.drafts.*`)
- [ ] Draft `message` body encrypted at rest in daemon storage
- [ ] `webhook` field redacted in all list/read responses
- [ ] `channels.drafts.get` returns single draft by id or `{ notFound: true }`
- [ ] `channels.drafts.save` response includes `id` and `created` boolean
- [ ] Agent local file remains offline fallback; `updatedAt` wins on conflict

### CalDAV, Email, and Email Triage
- [ ] CalDAV credentials never appear in operator responses
- [ ] `email.send` requires `confirm:true`; daemon must reject if absent
- [ ] `email.draft.create` requires `confirm:true` (appends to IMAP Drafts)
- [ ] `calendar.events.create` requires `confirm:true` and `explicitUserRequest`
- [ ] `calendar.ics.import` requires `confirm:true`
- [ ] `calendar.events.list`, `calendar.events.get`, `calendar.ics.export` are read-only, no confirmation
- [ ] `email.inbox.list`, `email.inbox.read` are read-only-network, no confirmation
- [ ] Spam/triage pipeline is daemon-internal; `inbox.triage.*` are NOT published operator methods
- [ ] `hasEmailCapability` signal extended to include CalDAV availability

### Remote Execution Backends
- [ ] Peer records registered with `backendKind`
- [ ] Docker backend: exec in named container via local Docker socket
- [ ] SSH backend: key from daemon credential store, pooled connections
- [ ] Async commands create work items visible in `remote.work.list`
- [ ] Invoke response includes `workId` (async) or `exitCode` (sync) and `stdoutDigest`
- [ ] Daemon rejects invocations without `confirm:true` and `explicitUserRequest`
