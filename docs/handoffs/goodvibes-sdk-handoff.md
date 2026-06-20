# GoodVibes SDK Handoff — Agent-Side Seams Awaiting SDK Contracts

**Date:** 2026-06-20
**Status:** Agent-side code MERGED and SHIPPED. SDK contracts below are MISSING and must be implemented.
**Scope:** This document describes every SDK daemon operator method that the already-merged goodvibes-agent code is blocked on. It is intended for the SDK team as a precise implementation specification.

---

## Executive Summary

The goodvibes-agent codebase has shipped five areas of agent-side work that are fully implemented, tested, and running — but each contains a deliberate seam where an SDK daemon contract has not yet been published. The seams are machine-readable (discriminated union branches, `daemonSyncState` fields, `daemonMethodNeeded` fields) so the agent code can detect and surface the gap to the user at runtime. Once the SDK publishes the contracts below, the agent team will wire adapters into the existing seam points without needing to redesign the agent model.

**What already exists in the SDK (do NOT re-implement):**
- `remote.snapshot`, `remote.peers.list`, `remote.work.list`, `remote.pair.requests.list` — all live in `src/tools/agent-harness-remote.ts`
- `remote.pair.requests.approve`, `remote.pair.requests.reject`, `remote.peers.invoke`, `remote.work.cancel` — confirmed-mutation methods, all wired
- IMAP inbox fetch (via `EmailService.checkInbox`) using `imap-client.ts` — fully operational
- SMTP send (via `EmailService.sendMail`) using `smtp-client.ts` — fully operational with `confirm: true` guard
- `.ics` file parsing is handled locally; no SDK contract needed for that

**What is MISSING from the SDK (must be implemented):**
1. `channels.inbox.list` — provider inbound feed (Slack DMs, Discord DMs, email threads)
2. `channels.routing.list`, `channels.routing.assign`, `channels.routing.delete` — daemon-side channel-to-profile routing persistence
3. `channels.drafts.list`, `channels.drafts.get`, `channels.drafts.save`, `channels.drafts.delete` — server-side draft sync
4. `email.inbox.list`, `email.inbox.read`, `email.draft.create`, `email.send` — email operator methods exposing email through the standard operator method protocol
5. `calendar.events.list`, `calendar.events.get`, `calendar.events.create`, `calendar.ics.import`, `calendar.ics.export` — CalDAV / calendar operator methods
6. Docker/SSH/cloud terminal backend support — a NET-NEW daemon capability layered on the existing `remote.*` peer/work contracts; NO new agent-facing operator methods. See Section 5 for details.

---

## Seam Inventory: What Already Exists vs What Is Missing

| Area | Agent File | Agent-Side Status | SDK Contract | SDK Status |
|------|-----------|-------------------|--------------|------------|
| Provider inbound inbox | `src/agent/unified-inbox.ts` | Shipped; seam at `inboundChannelFeed.available: false` | `channels.inbox.list` | **MISSING** |
| Channel-to-profile routing | `src/agent/channel-profile-routing.ts` | Shipped; local JSON only; `daemonSyncState: 'local_only'` | `channels.routing.*` | **MISSING** |
| Channel draft cross-device sync | `src/agent/channel-draft.ts` | Shipped; local JSON only | `channels.drafts.*` | **MISSING** |
| IMAP inbox fetch | `src/agent/email/email-service.ts` | Shipped; `EmailService.checkInbox()` | Direct socket | **EXISTS** |
| SMTP send | `src/agent/email/email-service.ts` | Shipped; `EmailService.sendMail()` with `confirm:true` | Direct socket | **EXISTS** |
| Email via operator method protocol | (seam implied by style-reply-lane.ts) | Needs daemon-exposed method | `email.inbox.list`, `email.draft.create`, `email.send` | **MISSING** |
| CalDAV / calendar sync | `src/agent/email/style-reply-lane.ts` | Not shipped; noted in lane prerequisites | `calendar.events.*`, `calendar.ics.*` | **MISSING** |
| Remote peer/work protocol | `src/tools/agent-harness-remote.ts` | Fully shipped; 4 read + 4 mutation methods | `remote.*` | **EXISTS** |
| Docker/SSH/cloud terminal backend | `src/tools/agent-harness-remote.ts` | No agent-side seam — terminal is a daemon-internal backend capability layered on `remote.peers.invoke` via `backendKind` discriminator; NO new agent-side operator methods or code are needed | `backendKind` on peer registration (daemon-internal) | **DAEMON-ONLY** |

---

## Contract Specifications

---

### 1. `channels.inbox.list` — Provider Inbound Feed

**Purpose:** Expose per-provider inbound message feeds (Slack DMs, Discord DMs, email threads) through the daemon operator method protocol so the agent's unified inbox can aggregate them alongside the existing delivery/surface-message/route-binding sources.

**Seam location:** `src/agent/unified-inbox.ts`, lines 115-117

```typescript
// unified-inbox.ts lines 115-117
export type InboundChannelFeedState =
  | { readonly available: false; readonly reason: 'contract_not_published'; readonly daemonMethodNeeded: 'channels.inbox.list' }
  | { readonly available: true; readonly items: readonly UnifiedInboxItem[] };
```

And in the `aggregateUnifiedInbox` function return value (lines ~337-341):
```typescript
inboundChannelFeed: {
  available: false,
  reason: 'contract_not_published',
  daemonMethodNeeded: 'channels.inbox.list',
},
```

**Proposed method ID:** `channels.inbox.list`

**Direction:** Agent → Daemon (operator method call via `agent_operator_method`)

**Input shape:**
```typescript
{
  provider?: string;       // e.g. "slack" | "discord" | "email" | undefined = all providers
  limit?: number;          // max items to return, default 50, max 200
  since?: number;          // Unix ms timestamp for pagination cursor
}
```

**Output shape:**
```typescript
{
  items: Array<{
    id: string;               // provider-stable message id
    provider: string;         // e.g. "slack", "discord", "email"
    kind: "dm" | "channel" | "thread" | "email_thread";
    from: string;             // sender display name or address
    fromAddress?: string;     // email address or handle
    subject?: string;         // email subject or channel/DM name
    bodyPreview: string;      // first ~500 chars of body, plain text
    receivedAt: number;       // Unix ms timestamp
    unread: boolean;
    routeId?: string;         // associated GoodVibes route id if bound
    threadId?: string;        // thread/conversation id for grouping
    attachmentCount?: number;
  }>;
  total: number;
  truncated: boolean;
  cursor?: string;            // opaque pagination cursor
}
```

**Effect:** `read-only-network` — no provider write. Fetches live from provider APIs.

**Confirmation required:** No.

**How unified-inbox.ts will consume it:**
Once published, the agent team will:
1. Add an `InboundChannelFeedAdapter` implementation in `aggregateUnifiedInbox` that calls `operator.invoke('channels.inbox.list', { limit })`.
2. Map the returned items to `UnifiedInboxItem[]` (a new `kind: 'inbound_channel'` branch will be added to the union).
3. Set `inboundChannelFeed: { available: true, items: [...] }` on the `UnifiedInbox` return value.
4. Extend the `sources` array with a new `inbound_channel_feed` source entry.

**Consumer file:** `src/agent/unified-inbox.ts` — specifically the `aggregateUnifiedInbox` function and the `InboundChannelFeedState` type.

---

### 2. `channels.routing.list` / `channels.routing.assign` / `channels.routing.delete` — Daemon-Side Channel-to-Profile Routing

**Purpose:** Back the agent's channel-to-profile routing store with a daemon-side persistent record so assignments survive agent reinstalls and sync across devices. Currently every `ChannelProfileRoute` record carries `daemonSyncState: 'local_only'` and `daemonMethodNeeded: 'channels.routing.assign'` as explicit machine-readable seam markers.

**Seam location:** `src/agent/channel-profile-routing.ts`

The `ChannelProfileRoute` interface (lines ~48-67):
```typescript
export interface ChannelProfileRoute {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly surfaceKind: string;       // e.g. 'slack', 'discord', 'telegram', 'any' wildcard
  readonly routeId?: string;
  readonly profileId: string;
  readonly label?: string;
  readonly daemonSyncState: 'local_only';          // seam marker — changes when synced
  readonly daemonMethodNeeded: 'channels.routing.assign';  // seam marker
}
```

The `assignChannelToProfile` function comment (lines ~205-210):
```
// SEAM: when daemon publishes `channels.routing.assign`, add a call here and
// set `daemonSyncState` based on the daemon response.
```

#### 2a. `channels.routing.list`

**Direction:** Agent → Daemon

**Input:**
```typescript
{
  profileId?: string;    // filter by profile
  surfaceKind?: string;  // filter by surface kind
  limit?: number;        // default 100
}
```

**Output:**
```typescript
{
  routes: Array<{
    id: string;
    createdAt: string;      // ISO 8601
    updatedAt: string;
    surfaceKind: string;
    routeId?: string;
    profileId: string;
    label?: string;
  }>;
  total: number;
}
```

**Effect:** `read-only` — no write. Returns daemon-persisted routing table.

**Confirmation required:** No.

#### 2b. `channels.routing.assign`

**Direction:** Agent → Daemon

**Input:**
```typescript
{
  channelId?: string;    // optional provider channel id
  surfaceKind: string;   // required — e.g. 'slack'
  routeId?: string;      // optional — narrows beyond surface kind
  profileId: string;     // required — the profile to route to
  label?: string;
}
```

**Output:**
```typescript
{
  assignmentId: string;   // daemon-assigned id (may differ from local id)
  channelId?: string;
  surfaceKind: string;
  routeId?: string;
  profileId: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Effect:** `confirmed-effect` — writes to daemon-side routing table. Agents must call with `confirm: true`.

**Confirmation required:** Yes.

#### 2c. `channels.routing.delete`

**Direction:** Agent → Daemon

**Input:**
```typescript
{
  assignmentId: string;   // the daemon-side id returned by channels.routing.assign
}
```

**Output:**
```typescript
{
  deleted: boolean;
  assignmentId: string;
}
```

**Effect:** `confirmed-effect` — removes a routing rule.

**Confirmation required:** Yes.

**How channel-profile-routing.ts will consume these:**
Once published:
1. `assignChannelToProfile` will call `channels.routing.assign` and on success set `daemonSyncState: 'synced'` (a new branch in the discriminated union). The `daemonMethodNeeded` field will be removed from synced records.
2. `listChannelProfileRoutes` will call `channels.routing.list` and merge results with local fallback.
3. `removeChannelProfileRoute` will call `channels.routing.delete` before removing from local store.

**Consumer file:** `src/agent/channel-profile-routing.ts` — `assignChannelToProfile`, `listChannelProfileRoutes`, `removeChannelProfileRoute`.

---

### 3. `channels.drafts.*` — Server-Side Draft Sync

**Purpose:** Mirror the local `ChannelDraft` store to the daemon so drafts are accessible across devices and survive local agent reinstalls. Currently drafts are pure local JSON at `{agentRoot}/channels/drafts.json`.

**Seam location:** `src/agent/channel-draft.ts`, file header comment (lines ~18-22):

```
// SEAM — a future daemon `channels.drafts.*` operator method could mirror this
// store server-side for multi-surface sync. The local model is the source of
// truth until that contract is published.
```

The `ChannelDraft` interface to mirror on the daemon (lines ~37-62):
```typescript
export interface ChannelDraft {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: 'draft' | 'queued' | 'sent' | 'failed';
  readonly title?: string;
  readonly message: string;
  readonly channel?: string;    // e.g. "slack:ops"
  readonly route?: string;
  readonly webhook?: string;    // MUST be stored redacted
  readonly link?: string;
  readonly tags?: readonly string[];
  readonly sentResponseId?: string;
  readonly sendError?: string;
}
```

#### 3a. `channels.drafts.list`

**Direction:** Agent → Daemon

**Input:**
```typescript
{
  status?: 'draft' | 'queued' | 'sent' | 'failed';
  limit?: number;   // default 50, max 200
}
```

**Output:**
```typescript
{
  drafts: Array<ChannelDraft>;   // same shape as the agent-local ChannelDraft
  total: number;
}
```

**Effect:** `read-only`

**Confirmation required:** No.

#### 3b. `channels.drafts.get`

**Direction:** Agent → Daemon

**Input:**
```typescript
{ draftId: string; }
```

**Output:**
```typescript
ChannelDraft | { notFound: true; draftId: string; }
```

**Effect:** `read-only`

**Confirmation required:** No.

#### 3c. `channels.drafts.save`

**Direction:** Agent → Daemon

**Input:** Full `ChannelDraft` shape (version 1).

**Output:**
```typescript
{
  draft: ChannelDraft;
  created: boolean;   // true if new, false if updated
}
```

**Effect:** `confirmed-effect` — writes to daemon-side draft store. Webhook values MUST be redacted before transmission (the agent already redacts them locally; the SDK MUST reject drafts containing raw webhook tokens).

**Confirmation required:** Yes (for writes). The agent's local `saveDraft` does not require confirmation because it is local-only; the sync call to the daemon does require it.

#### 3d. `channels.drafts.delete`

**Direction:** Agent → Daemon

**Input:**
```typescript
{ draftId: string; }
```

**Output:**
```typescript
{ deleted: boolean; draftId: string; }
```

**Effect:** `confirmed-effect`

**Confirmation required:** Yes.

**How channel-draft.ts will consume these:**
Once published:
1. `saveDraft` will call `channels.drafts.save` after successful local write, making local the primary and daemon the mirror.
2. `listDrafts` will optionally call `channels.drafts.list` to merge with local results when a `syncFromDaemon` option is passed.
3. `deleteDraft` will call `channels.drafts.delete` in parallel with local removal.

**Consumer file:** `src/agent/channel-draft.ts` — `saveDraft`, `listDrafts`, `getDraft`, `deleteDraft`.

---

### 4. Email Operator Methods — Daemon-Exposed Email Protocol

**Purpose:** Expose email capabilities through the standard operator method protocol so that email operations can be triggered via MCP connector actions (not just the direct IMAP/SMTP socket path). The agent's `style-reply-lane.ts` already defines a `followUpRoutes` send route that uses `email action:"send"` — this requires a daemon-side `email.send` method. CalDAV sync and auto-tagging are also noted here as missing capabilities.

**What already exists (do NOT re-implement):**
- `EmailService.checkInbox()` — direct IMAP fetch, available at `src/agent/email/email-service.ts` line 242. Returns `EmailSummary[]` with fields `{ from, subject, date, unread, bodyPreview }`.
- `EmailService.sendMail(opts: SendMailOptions)` — direct SMTP send, line 291. Requires `confirm: true` at call site.
- `.ics` local parsing — the agent handles ICS files locally; no SDK contract needed.

**What is MISSING:**

#### 4a. `email.inbox.list`

**Direction:** Agent → Daemon

**Input:**
```typescript
{
  limit?: number;   // default 10, max 100
  since?: string;   // ISO 8601 date for SINCE search
  unreadOnly?: boolean;  // default true
}
```

**Output:**
```typescript
{
  messages: Array<{
    uid: number;          // IMAP UID — matches ImapEnvelope.uid in imap-client.ts
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

**Note on ImapEnvelope:** `imap-client.ts` lines 40-47 defines `ImapEnvelope { uid, from, subject, date, messageId }`. The daemon's output must include `uid` so agents can use it as a stable reference for `email.inbox.read`.

**Effect:** `read-only-network`

**Confirmation required:** No.

#### 4b. `email.inbox.read`

**Direction:** Agent → Daemon

**Input:**
```typescript
{
  uid: number;    // IMAP UID from email.inbox.list
}
```

**Output:**
```typescript
{
  uid: number;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  bodyText: string;   // full plain-text body (not just preview)
  bodyHtml?: string;  // optional HTML body
  attachments?: Array<{ filename: string; contentType: string; sizeBytes: number }>;
}
```

**Effect:** `read-only-network` (uses BODY.PEEK — does not mark as read)

**Confirmation required:** No.

#### 4c. `email.draft.create`

**Direction:** Agent → Daemon

**Purpose:** Create a server-side draft (IMAP Drafts folder append). This is distinct from the local `ChannelDraft` store — this writes to the actual mail server.

**Input:**
```typescript
{
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;   // Message-ID of the message being replied to
  references?: string;  // References header chain
}
```

**Output:**
```typescript
{
  uid: number;       // IMAP UID assigned to the draft in the Drafts folder
  draftId: string;   // stable opaque id for subsequent operations
}
```

**Effect:** `confirmed-effect` — appends to IMAP Drafts folder.

**Confirmation required:** Yes. The style-reply flow in `style-reply-lane.ts` enforces a before-send review boundary; the draft must not be created server-side without explicit user confirmation.

#### 4d. `email.send`

**Direction:** Agent → Daemon

**Purpose:** Send a composed email via the configured SMTP path, routed through the daemon operator method protocol. This is the method referenced in `style-reply-lane.ts` line 145's `followUpRoutes[0].modelRoute`.

**Input:**
```typescript
{
  to: string;        // validated RFC-5322 address
  subject: string;
  body: string;
  inReplyTo?: string;
  confirm: true;     // REQUIRED — SDK must reject if false or missing
}
```

**Output:**
```typescript
{
  messageId: string;   // Message-ID header assigned to the sent message
  sentAt: string;      // ISO 8601 timestamp
}
```

**Effect:** `confirmed-effect` — external email send. Irreversible.

**Confirmation required:** Yes, hard-enforced. The existing `EmailService.sendMail` throws if `confirm !== true` (line 293). The daemon contract must mirror this invariant.

**Missing: CalDAV sync and auto-tagging**

The `style-reply-lane.ts` prerequisites list (line 85) references `email.enabled=true` and IMAP/SMTP but does NOT yet expose CalDAV or auto-tagging. These are documented here as future contracts:

#### 4e. `calendar.events.list`

**Input:** `{ calendarId?: string; from?: string; to?: string; limit?: number }`

**Output:** Array of calendar event summaries `{ id, title, start, end, location?, description?, attendees? }`.

**Effect:** `read-only-network`

#### 4f. `calendar.events.get`

**Input:** `{ eventId: string; calendarId?: string }`

**Output:** Full event object including attendees, recurrence, and raw iCalendar UID.

**Effect:** `read-only-network`

#### 4g. `calendar.events.create`

**Input:** `{ title: string; start: string; end: string; description?: string; attendees?: string[]; location?: string; calendarId?: string; confirm: true }`

**Output:** `{ eventId: string; uid: string; createdAt: string }`

**Effect:** `confirmed-effect` — creates event on CalDAV server.

**Confirmation required:** Yes.

#### 4h. `calendar.ics.import`

**Input:** `{ icsContent: string; calendarId?: string; confirm: true }` — the raw `.ics` text.

**Output:** `{ imported: number; eventIds: string[]; errors: string[] }`

**Effect:** `confirmed-effect`

**Confirmation required:** Yes.

#### 4i. `calendar.ics.export`

**Input:** `{ calendarId?: string; from?: string; to?: string }`

**Output:** `{ icsContent: string; eventCount: number }`

**Effect:** `read-only`

**Note on existing ICS support:** The agent already parses ICS files locally. `calendar.ics.import/export` contracts are for CalDAV server sync only — the local parsing path does not need to change.

**Consumer files:**
- `src/agent/email/style-reply-lane.ts` — the `followUpRoutes[0].modelRoute` references `email action:"send"`.
- `src/agent/email/email-service.ts` — `checkInbox()` and `sendMail()` are the direct-socket equivalents; daemon methods will provide an operator-protocol-compliant alternative path.

---

### 5. Remote Terminal Backend Contracts — Docker/SSH/Cloud

**Purpose:** Enable the daemon to route `remote.peers.invoke` calls to Docker containers, SSH targets, and cloud terminal sessions by registering them as peers with a `backendKind` discriminator in the daemon's internal backend registry.

**What already exists (do NOT re-implement):**
The following methods are fully implemented in `agent-harness-remote.ts` and MUST NOT be changed:
- `remote.snapshot` — `GET /api/remote` (lines ~80-97)
- `remote.peers.list` — `GET /api/remote/peers` (lines ~99-112)
- `remote.work.list` — `GET /api/remote/work` (lines ~114-127)
- `remote.pair.requests.list` — `GET /api/remote/pair/requests` (lines ~129-142)
- `remote.pair.requests.approve` — `POST /api/remote/pair/requests/{requestId}/approve` (lines ~141-159)
- `remote.pair.requests.reject` — `POST /api/remote/pair/requests/{requestId}/reject` (lines ~161-179)
- `remote.peers.invoke` — `POST /api/remote/peers/{peerId}/invoke` (lines ~181-200)
- `remote.work.cancel` — `POST /api/remote/work/{workId}/cancel` (lines ~202-220)

All of these use `effect: 'confirmed-connected-host-state'` and `confirmationRequired: true` for mutations, and `effect: 'read-only-network'` for reads.

**This is a NET-NEW daemon capability, not a new agent-side SDK contract.** Docker/SSH/cloud terminal support is implemented entirely inside the daemon's backend registry. There are NO new agent-facing operator method IDs, NO new `AgentHarnessTerminalArgs` types, and NO new agent-side code. The mechanism is:

1. The daemon registers Docker containers, SSH hosts, and cloud terminals as peer records in its internal registry, each annotated with a `backendKind` discriminator (`"docker"` | `"ssh"` | `"cloud-terminal"`).
2. The existing `remote.peers.invoke` operator method dispatches to the appropriate execution backend based on the peer's registered `backendKind` — identical to any other peer invocation.
3. Long-running terminal commands produce work items visible through the existing `remote.work.list` / `remote.work.cancel` surface.

The agent does not know or care whether a peer is backed by SSH or Docker — it calls `remote.peers.invoke { peerId, command }` exactly as it does today. See the daemon handoff document (Responsibility 5) for the full daemon-side `backendConfig` registration contract.

**No agent-side seam:** Unlike the other four capability areas in this document (channels inbox, routing, drafts, email/calendar), there is no existing agent-side typed sentinel, `daemonMethodNeeded` constant, or `daemonSyncState` marker for terminal backends. Terminal is an inferred future capability that the agent will benefit from automatically once the daemon wires it up — no agent code changes are required.

**If a `backendKind` field is added to peer list responses:** The SDK may optionally surface `backendKind` on `remote.peers.list` items so the webui can show a backend-type badge (docker / ssh / cloud) per peer. If the SDK team adds this field, it is additive and read-only; no agent mutation logic depends on it.

---

## Implementation Order (Recommended)

Priority is based on agent-side seam severity: blocking vs degraded vs future.

| Priority | Contract(s) | Rationale |
|----------|-------------|-----------|
| 1 (Blocking) | `channels.routing.assign`, `channels.routing.list`, `channels.routing.delete` | Every `ChannelProfileRoute` record emits `daemonSyncState: 'local_only'` at runtime — users see the gap on every routing operation |
| 2 (Blocking) | `channels.inbox.list` | The unified inbox `inboundChannelFeed.available: false` is displayed to users every time they open the inbox; no provider DMs are visible |
| 3 (Degraded) | `channels.drafts.save`, `channels.drafts.list`, `channels.drafts.delete`, `channels.drafts.get` | Drafts work locally but are lost on reinstall and don't sync across devices |
| 4 (Degraded) | `email.send`, `email.inbox.list`, `email.inbox.read` | Direct IMAP/SMTP works; operator method path is needed for MCP connector integration referenced in `style-reply-lane.ts` |
| 5 (Future) | `email.draft.create`, `calendar.events.*`, `calendar.ics.*` | CalDAV sync and auto-tagging are not yet surfaced in any agent UI; implement after core email operator methods |
| 6 (Future) | Docker/SSH/cloud terminal backends | Daemon-internal `backendKind` registration layered on `remote.peers.invoke`; no agent-side operator methods needed; wire daemon backend registry after channels contracts are stable |

---

## Effect Semantics Reference

All daemon operator methods follow this effect taxonomy (matching the existing `remote.*` pattern in `agent-harness-remote.ts`):

| Effect Value | Meaning | Confirmation Required |
|---|---|---|
| `read-only` | Local daemon read, no network | No |
| `read-only-network` | Network read, no write | No |
| `confirmed-effect` | External write (irreversible or hard to undo) | Yes — `confirm: true` + explicit user request |
| `confirmed-connected-host-state` | Session/connection lifecycle change on an external host | Yes |

Email sends (`email.send`) and CalDAV writes (`calendar.events.create`, `calendar.ics.import`) are `confirmed-effect`. Docker/SSH/cloud terminal dispatch routes through the existing `remote.peers.invoke` surface, which already carries `confirmed-connected-host-state`. All read operations are `read-only` or `read-only-network`.

---

*Document generated from agent-side source file analysis on 2026-06-20. Do not edit the seam markers in the agent source files until the SDK contracts are published — they serve as runtime signals to the user.*
