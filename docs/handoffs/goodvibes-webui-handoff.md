# GoodVibes WebUI Handoff — Dashboard / PWA Parity

**Date:** 2026-06-20
**Source:** goodvibes-agent v1.5.2 / SDK 0.33.38
**Author:** Handoff generated from agent-side source read

---

## Executive Summary

goodvibes-webui is a Vite + React 19 + TypeScript SPA (Bun) that acts as the browser/PWA dashboard for goodvibes-agent. It consumes the `@pellux/goodvibes-sdk` operator-method contracts via a client facade (`src/lib/goodvibes.ts`) backed by SSE real-time invalidation. It currently ships four views — Chat, Knowledge, Providers, Admin — and is missing:

1. PWA conversion (no manifest, no service worker, no install prompt)
2. SDK version lag (0.33.30 vs agent 0.33.38)
3. Five new views to mirror agent_harness surfaces: Communications, Personal Ops, Remote/Fleet, Learning/Autonomy, and Research

Recommended build order: **PWA + SDK bump first, then views** (Communications → Personal Ops → Remote/Fleet → Learning → Research).

---

## 1. PWA Conversion

### Gap

The webui is not a PWA. It has no `manifest.webmanifest`, no service worker, no install prompt, and no offline shell. This is the literal "web dashboard / PWA" gap described in the project description.

### What to Build

#### 1a. vite-plugin-pwa

Add `vite-plugin-pwa` (Workbox-based) to `vite.config.ts`. This is the single lowest-friction path to manifest + service worker on Vite.

```
bun add -d vite-plugin-pwa
```

```ts
// vite.config.ts additions
import { VitePWA } from 'vite-plugin-pwa'

VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
  manifest: {
    name: 'GoodVibes',
    short_name: 'GoodVibes',
    description: 'GoodVibes personal operator assistant dashboard',
    theme_color: '#0f172a',
    background_color: '#0f172a',
    display: 'standalone',
    orientation: 'portrait-primary',
    start_url: '/',
    scope: '/',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [
      {
        // SSE endpoint must NOT be cached — it is a live stream
        urlPattern: /\/api\/sse/,
        handler: 'NetworkOnly'
      },
      {
        urlPattern: /\/api\//,
        handler: 'NetworkFirst',
        options: { cacheName: 'api-cache', networkTimeoutSeconds: 4 }
      }
    ]
  }
})
```

#### 1b. Icons

Locate existing icons in `public/` or `src/assets/`. Create at minimum:
- `public/icons/icon-192.png` (192x192)
- `public/icons/icon-512.png` (512x512, maskable)
- `public/apple-touch-icon.png` (180x180)

If the project already has a logo SVG, rasterize it at those sizes via `sharp` or `@resvg/resvg-js` in a build script.

#### 1c. Offline Shell

The Workbox `precacheAndRoute` will cache all static assets. Add an offline fallback page at `public/offline.html` that renders a "reconnecting..." indicator. Wire it into Workbox's `offlineFallback` option.

#### 1d. Install Prompt Component

Create `src/components/InstallBanner.tsx`:
- Listen for the `beforeinstallprompt` DOM event, persist the prompt in a ref
- Render a dismissible banner ("Add GoodVibes to your home screen") only when the prompt is available and the user has not dismissed it
- Store dismissal in `localStorage` key `gv-install-dismissed`
- Must not render in installed (standalone) mode: check `window.matchMedia('(display-mode: standalone)')`.

Place `<InstallBanner />` in the root layout, above the nav.

#### 1e. Responsive / Mobile Layout

- All four existing views must be scroll-safe on 360px wide viewports
- Bottom navigation bar on mobile (< 640px): icons-only tabs for the five core views
- Top navigation bar on desktop (>= 640px): keep existing sidebar/topbar pattern
- Safe-area insets via `env(safe-area-inset-*)` on the shell container
- Use a `useViewport` hook that returns `{ isMobile: boolean }` driven by a `ResizeObserver`

#### Acceptance Criteria — PWA

- Lighthouse PWA audit passes (installable, offline, manifest, service worker)
- `npm run build && npx serve dist` shows install prompt in Chrome
- App shell loads with no network (from SW cache)
- SSE endpoint is not cached (NetworkOnly)
- Install banner appears on first load and does not reappear after dismissal

---

## 2. SDK Bump: 0.33.30 → 0.33.38

### Gap

goodvibes-webui pins `@pellux/goodvibes-sdk@0.33.30`. goodvibes-agent is on `0.33.38`. The new agent-side surfaces (comms, remote, learning_auto_promote) were published with SDK changes in this range.

### Standard Update Procedure

The repo has no explicit `sdk-update-checklist` file, but the engineering rules (`.goodvibes/GOODVIBES.md`) specify: "Prefer public `@pellux/goodvibes-sdk` contracts and daemon routes." The standard steps are:

1. **Bump the dep in `package.json`:**
   ```
   bun add @pellux/goodvibes-sdk@0.33.38
   ```

2. **Run type-check immediately:**
   ```
   bunx tsc --noEmit
   ```
   Any breaking type changes surface here. The SDK is a devDependency type-only package; runtime behavior comes from the live daemon.

3. **Check the SDK CHANGELOG** for the 0.33.30→0.33.38 range for operator-method contract changes, new `methodId` strings, or deprecated fields used by `src/lib/goodvibes.ts`.

4. **Update `src/lib/goodvibes.ts` client facade** if any `invokeMethod` call signatures changed. The facade wraps `sdk.operator.invoke(methodId, input)` — if `methodId` strings were renamed or `input` shapes narrowed, update call sites.

5. **Update SSE invalidation topics** if the SDK published new event topic strings for the new surfaces (comms, remote).

6. **Run full build:**
   ```
   bun run build
   ```

7. **Verify against a live daemon running 0.33.38** before shipping.

#### Acceptance Criteria — SDK Bump

- `bunx tsc --noEmit` exits 0 with no errors after bump
- `bun run build` produces clean output
- Existing Chat, Knowledge, Providers, Admin views load and function normally
- `src/lib/goodvibes.ts` passes type-check at the new SDK version

---

## 3. New Views

All new views follow the existing pattern in goodvibes-webui:

- **Route:** registered in the SPA router (React Router or TanStack Router, whichever the webui uses) as a new `ViewId` path
- **Data fetch:** via `src/lib/goodvibes.ts` `invokeMethod(methodId, input)` — the same facade used by existing views
- **Real-time invalidation:** subscribe to the SSE topic returned by the daemon for each surface; on event, refetch with React Query / SWR
- **Confirmation gate:** every effect action must show a modal confirmation dialog before calling `invokeMethod`. The agent side enforces `confirm: true` + `explicitUserRequest`; the UI must make that boundary visible and explicit

### 3.1 Communications View

**Route:** `/communications` — ViewId: `communications`
**Nav label:** Communications (icon: inbox or message-square)

This view mirrors the `comms` family in agent_harness:
- `unified_inbox` (agent-harness-comms.ts: `unifiedInboxSummary`)
- `channel_drafts` (agent-harness-comms.ts: `channelDraftsSummary`)
- `channel_draft_save` (effect)
- `channel_draft_send` (effect)
- `channel_routing` (agent-harness-comms.ts: `channelRoutingSummary`)
- `channel_routing_assign` (effect)
- `channel_routing_remove` (effect)

#### Sub-panels

**Unified Inbox panel** (`CommunicationsInbox.tsx`)
- Calls `agent_harness mode:"unified_inbox" limit:50`
- Displays `inbox.summary` + `inbox.items` as a feed
- Shows `inbox.sources`, `inbox.deliveryItems`, `inbox.surfaceMessageItems`, `inbox.routeBindingItems` as collapsed sections
- Status badge derived from `inbox.status`
- Refresh button; auto-invalidates on SSE `channels.inbox` topic

**Drafts panel** (`CommunicationsDrafts.tsx`)
- List call: `agent_harness mode:"channel_drafts" limit:50`
- Each draft row: title, channel, status badge (draft / queued / sent / failed), timestamp
- Draft detail slide-over: `agent_harness mode:"channel_drafts" draftId:"<id>"`
- **CRITICAL:** webhook field must NOT be displayed. The agent redacts it (`redactDraftWebhook`). The UI must treat any `webhook` value as `[redacted]` and never render it in any form field or display.
- **Compose draft form** (`CommunicationsDraftForm.tsx`): fields `draftMessage` (required), `draftTitle`, `draftChannel`, `draftRoute`, `draftLink`, `draftTags` (comma-separated). No `draftWebhook` field — the UI must never surface webhook input.
- Save button: confirmation modal ("Save draft to local workspace?") → `agent_harness mode:"channel_draft_save" confirm:true explicitUserRequest:"save draft" ...fields`
- Send button on each draft: confirmation modal ("Send this draft? This will deliver the message via the configured channel.") → `agent_harness mode:"channel_draft_send" draftId:"<id>" confirm:true explicitUserRequest:"send draft"`

**Channel Routing panel** (`CommunicationsRouting.tsx`)
- List call: `agent_harness mode:"channel_routing" limit:50`
- Table: surfaceKind, profileId, routeId, label, daemonSyncState
- Assign form: fields `surfaceKind` (required), `profileId` (required), `routeLabel` (optional) — confirmation modal → `channel_routing_assign confirm:true`
- Remove button per row — confirmation modal → `channel_routing_remove draftRoute:"<routeId>" confirm:true`
- Note: the agent side marks routes as `local_only` until daemon sync; the UI should show a "Pending daemon sync" badge on such rows.

#### Acceptance Criteria — Communications

- Inbox feed renders items from `unifiedInboxSummary` response
- Webhook field is absent from all draft forms and display
- Confirmation modal appears before every save/send/assign/remove action
- SSE invalidation causes inbox to refetch without full page reload
- Draft status badges match: draft / queued / sent / failed

---

### 3.2 Personal Ops View

**Route:** `/personal-ops` — ViewId: `personal-ops`
**Nav label:** Personal Ops (icon: mail or user-check)

This view mirrors the `personal-ops` family, with special focus on the style-reply lane from `src/agent/email/style-reply-lane.ts`.

#### Sub-panels

**Overview / Briefing panel** (`PersonalOpsBriefing.tsx`)
- Calls `agent_harness mode:"personal_ops"` to get the lane map
- Shows lane cards: inbox, calendar, tasks, reminders, with readiness status
- Links to Personal Ops Queue: `agent_harness mode:"personal_ops_queue" limit:50`

**Inbox Lane — Style-Reply Composer** (`PersonalOpsStyleReply.tsx`)

This is the signature feature surfaced by `src/agent/email/style-reply-lane.ts`. The live record id is `inbox-style-reply-draft`.

Flow:
1. User fills in form:
   - `inboundFrom` (required, e.g. "Alice Smith <alice@example.com>")
   - `inboundSubject` (required)
   - `inboundBodyPreview` (optional — paste excerpt of inbound email)
   - `context` (optional — key points to weave into the reply)
2. "Compose draft in my style" button → calls:
   `personal_ops action:"read" laneId:"inbox" recordId:"inbox-style-reply-draft" fields:{...} confirm:true explicitUserRequest:"draft a reply in my style"`
3. The agent returns a locally-composed draft. The UI renders it in a read-only preview pane.
4. **Before-Send Review Boundary** (mandatory, enforced here):
   - The draft preview must show a bold "Review before sending" header
   - A separate "Send reviewed reply" button becomes active only after the user checks a checkbox: "I have reviewed the recipients and body"
   - Clicking Send opens a confirmation modal showing: To, Subject, Body excerpt — user must click "Confirm send"
   - The send call: `email action:"send" to:"<recipient>" subject:"Re: <subject>" body:"<reviewed body>" confirm:true explicitUserRequest:"send this reply"`
5. **Auto-send is architecturally blocked** at the agent side (the live record's `effect` is `read-only`; the follow-up route carries `requiresConfirmation: true`). The UI must mirror this: the send button is disabled until the review checkbox is checked.

The UI must display the `runBoundary` text from the workflow descriptor as a visible notice: "Composing stays local. Sending requires the confirmed SMTP/connector route with explicit user review."

**Autonomy Queue panel** (`PersonalOpsAutonomyQueue.tsx`)
- Calls `agent_harness mode:"autonomy_queue" limit:25`
- Shows live autonomy work items, status, log tails
- Inspect call: `agent_harness mode:"autonomy_queue_item" queueItemId:"<id>"`

#### Acceptance Criteria — Personal Ops

- Style-reply form renders all four fields with correct required/optional labels
- Composed draft appears in read-only preview after compose call
- Send button is disabled until review checkbox is checked
- Confirmation modal shows full To/Subject/Body before sending
- "Composing stays local" boundary notice is permanently visible
- Autonomy queue renders with live status from `autonomy_queue` mode

---

### 3.3 Remote / Fleet View

**Route:** `/remote` — ViewId: `remote`
**Nav label:** Fleet (icon: network or server)

This view mirrors the `remote` family from `src/tools/agent-harness-remote.ts`. All four read surfaces call `agent_operator_method` via the operator facade; the webui calls the same daemon methods through `invokeMethod`.

#### Sub-panels

**Snapshot panel** (`RemoteSnapshot.tsx`)
- Calls `methodId: "remote.snapshot"` → `GET /api/remote`
- Displays: connected peer count, queued work count, leased work count, pair request counts
- Auto-refreshes every 30 seconds; SSE invalidation on `remote.*` topic

**Peers panel** (`RemotePeers.tsx`)
- Calls `methodId: "remote.peers.list"` → `GET /api/remote/peers`
- Table: peerId, status (connected / disconnected), last-seen
- "Invoke command on peer" button per row → opens `RemotePeerInvokeModal.tsx`:
  - Fields: `command` (required), `payload` (optional JSON)
  - Confirmation modal: "Invoke `<command>` on peer `<peerId>`?" → `methodId: "remote.peers.invoke"` with `confirm:true`
  - The agent side (`remotePeersInvokeHandoff`) marks effect as `confirmed-connected-host-state`

**Work Queue panel** (`RemoteWork.tsx`)
- Calls `methodId: "remote.work.list"` → `GET /api/remote/work`
- Table: workId, status (queued / leased), created, description
- "Cancel" button per queued/leased item → confirmation modal → `methodId: "remote.work.cancel"` with `confirm:true`

**Pair Requests panel** (`RemotePairRequests.tsx`)
- Calls `methodId: "remote.pair.requests.list"` → `GET /api/remote/pair/requests`
- Table: requestId, status (pending / approved / rejected), note, timestamps
- "Approve" / "Reject" buttons on pending rows:
  - Approve: confirmation modal "Approve pairing from `<requestId>`?" → `methodId: "remote.pair.requests.approve"` with `confirm:true`
  - Reject: confirmation modal "Reject pairing from `<requestId>`?" → `methodId: "remote.pair.requests.reject"` with `confirm:true`
  - Both map to the `confirmed-connected-host-state` effect level

#### Acceptance Criteria — Remote / Fleet

- Snapshot panel shows live counts within 30 seconds of data change
- Peer invoke modal requires confirmation before calling `remote.peers.invoke`
- Work cancel requires confirmation before calling `remote.work.cancel`
- Pair approve/reject require confirmation before calling respective methods
- All four operator methods are called through `src/lib/goodvibes.ts` `invokeMethod` — not direct fetch

---

### 3.4 Learning / Autonomy View

**Route:** `/learning` — ViewId: `learning`
**Nav label:** Learning (icon: brain or sparkles)

This view surfaces the `learning_*` family and the `learning_auto_promote` effect mode.

#### Sub-panels

**Curator panel** (`LearningCurator.tsx`)
- Calls `agent_harness mode:"learning_curator" limit:25`
- Ranks memory, notes, personas, skills, routines review / promotion proposals
- Each candidate card: id, label, category, readiness status
- "Inspect" button per card → `agent_harness mode:"learning_candidate" candidateId:"<id>"`

**Auto-Promote panel** (`LearningAutoPromote.tsx`)
- Describes what auto-promote does: "Automatically promotes ready-to-promote learning candidates and consolidates duplicates."
- Shows current promotable count from the curator call
- "Run Auto-Promote" button → confirmation modal:
  "This will autonomously promote all ready candidates and consolidate duplicates. This cannot be undone. Proceed?"
  → `agent_harness mode:"learning_auto_promote" confirm:true explicitUserRequest:"run auto-promote"`
- The `learning_auto_promote` descriptor in the catalog (`kind: 'effect'`, `requiresConfirmation` implied, `family: 'personal-ops'`) places this firmly behind the confirmation gate.
- After run: shows result summary (how many promoted, how many consolidated)

**Memory Posture panel** (`LearningMemoryPosture.tsx`)
- Calls `agent_harness mode:"memory_posture" limit:20`
- Shows memory providers (semantic recall, external memory) with status badges
- Provider detail: `agent_harness mode:"memory_provider" providerId:"<id>"`

**Skills panel** (lightweight, links to Knowledge view)
- Calls `agent_harness mode:"propose_skill_drafts" confirm:true explicitUserRequest:"propose skill drafts"` — this is an effect mode requiring confirmation
- Show proposed skill drafts for review before accepting

#### Acceptance Criteria — Learning / Autonomy

- Curator panel lists candidates with readiness ranks
- Auto-promote shows item count and is gated behind a confirmation modal
- `learning_auto_promote` is never called without `confirm:true` and `explicitUserRequest`
- Memory posture shows provider statuses from `memory_posture`
- Propose-skill-drafts button opens confirmation modal before calling the effect mode

---

### 3.5 Research View (Stretch Goal)

**Route:** `/research` — ViewId: `research`
**Nav label:** Research (icon: search or flask)

This view surfaces the `research` family. It is lower priority than the four above.

#### Sub-panels

**Research Briefing** (`ResearchBriefing.tsx`)
- Calls `agent_harness mode:"research_briefing" limit:10`
- Shows next-action queue: active runs, source review queue, report queue

**Runs List** (`ResearchRuns.tsx`)
- Calls `agent_harness mode:"research_runs" limit:20`
- Table: runId, phase, created, log tail excerpt
- Inspect run: `agent_harness mode:"research_run" runId:"<id>"`

**Source Queue** (`ResearchSources.tsx`)
- Calls `agent_harness mode:"research_queue" limit:30`
- Table: sourceId, credibility, status
- Inspect source: `agent_harness mode:"research_source" sourceId:"<id>"`

#### Acceptance Criteria — Research

- Briefing shows current run and source counts
- Run phase is displayed with a progress indicator
- No write/effect actions in this view for the initial implementation

---

## 4. Cross-Cutting Requirements

### 4.1 Confirmation Boundary

The agent side enforces a strict `confirm: true` + `explicitUserRequest` gate on every effect action (see `requireConfirmedAction` in `src/tools/agent-harness-tool-utils.ts`). The webui must mirror this by:

- Every button that triggers a state-changing `invokeMethod` call must first open a `ConfirmationModal.tsx`
- The modal must show: the action name, a plain-English description of what will happen, and a "Confirm" / "Cancel" button pair
- The "Confirm" click is what triggers `invokeMethod(..., { confirm: true, explicitUserRequest: "<user-facing description>" })`
- Effect kinds that require this gate (from the mode catalog): all modes where `requiresConfirmation: true` is set — this includes `channel_draft_save`, `channel_draft_send`, `channel_routing_assign`, `channel_routing_remove`, `remote_pair_approve`, `remote_pair_reject`, `remote_peers_invoke`, `remote_work_cancel`, `learning_auto_promote`, `propose_skill_drafts`, `run_personal_ops_read` (when used for sends), and all `set_*` / `run_*` modes

**Shared component:** `src/components/ConfirmationModal.tsx`

```ts
interface ConfirmationModalProps {
  title: string
  description: string
  confirmLabel?: string      // default: "Confirm"
  cancelLabel?: string       // default: "Cancel"
  onConfirm: () => void
  onCancel: () => void
  isOpen: boolean
  isDangerous?: boolean      // renders confirm button in red
}
```

All effect buttons in the four new views must use this component.

### 4.2 Webhook / Secret Redaction

The agent side redacts webhook values via `redactDraftWebhook` in `src/tools/agent-harness-comms.ts`:

```ts
function redactDraftWebhook<T extends { readonly webhook?: string }>(draft: T): T {
  return draft.webhook ? { ...draft, webhook: '[redacted]' } : draft;
}
```

The webui must:
- Never include a `webhook` input field in any form (Communications Drafts compose form, Channel Routing assign form)
- If a draft response unexpectedly includes a `webhook` field, display only `[redacted]` — never the raw value
- Apply the same treatment to any field named `token`, `secret`, `apiKey`, or `password` that may appear in operator method responses: display `[redacted]`
- Never log these values to `console.log` or analytics

### 4.3 SSE Real-time Invalidation Topics

Map daemon SSE topics to the views that should invalidate:

| SSE Topic | Invalidates |
|---|---|
| `channels.inbox` | Communications / Unified Inbox |
| `channels.drafts` | Communications / Drafts panel |
| `channels.routing` | Communications / Routing panel |
| `remote.peers` | Remote / Peers panel |
| `remote.work` | Remote / Work panel |
| `remote.pair.requests` | Remote / Pair Requests panel |
| `personal-ops.autonomy` | Personal Ops / Autonomy Queue |
| `learning.curator` | Learning / Curator panel |

Add these topic subscriptions to the SSE handler in `src/lib/goodvibes.ts` (or wherever the webui manages its SSE stream).

### 4.4 Navigation Structure

Add the five ViewIds to the router and navigation:

```
/                  → redirect to /chat (existing default)
/chat              → Chat view (existing)
/knowledge         → Knowledge view (existing)
/providers         → Providers view (existing)
/admin             → Admin view (existing)
/communications    → Communications view (NEW)
/personal-ops      → Personal Ops view (NEW)
/remote            → Remote / Fleet view (NEW)
/learning          → Learning / Autonomy view (NEW)
/research          → Research view (NEW, stretch)
```

Desktop sidebar order (suggested): Chat, Communications, Personal Ops, Knowledge, Remote, Learning, Research, Providers, Admin.
Mobile bottom-nav (5 primary tabs): Chat, Communications, Personal Ops, Remote, Learning.

---

## 5. Recommended Build Order and Effort Sizing

| Phase | Task | Effort | Dependencies |
|---|---|---|---|
| 1 | PWA: vite-plugin-pwa + manifest + icons | 0.5 day | None |
| 1 | PWA: offline shell + service worker config | 0.5 day | vite-plugin-pwa |
| 1 | PWA: install prompt component | 0.5 day | None |
| 1 | PWA: responsive/mobile layout + bottom nav | 1 day | None |
| 2 | SDK bump 0.33.30 → 0.33.38 + facade update | 0.5 day | None |
| 3 | ConfirmationModal shared component | 0.5 day | None |
| 4 | Communications view (Inbox + Drafts + Routing) | 2 days | SDK bump, ConfirmationModal |
| 5 | Personal Ops view (Briefing + Style-Reply + Autonomy) | 2 days | SDK bump, ConfirmationModal |
| 6 | Remote / Fleet view (Snapshot + Peers + Work + Pair) | 1.5 days | SDK bump, ConfirmationModal |
| 7 | Learning / Autonomy view (Curator + Auto-Promote + Memory) | 1.5 days | SDK bump, ConfirmationModal |
| 8 | Research view (stretch) | 1 day | SDK bump |
| 9 | SSE invalidation wiring for all new views | 0.5 day | All new views |

**Total estimated effort:** ~11 days for phases 1–8, +1 day for research stretch.

Phase 1 and 2 should be shipped as a single PR before any new views land — they are prerequisites that unblock the PWA and ensure the SDK contract is correct.

---

## 6. Files to Create / Modify

### New files

```
src/views/CommunicationsView.tsx
src/views/CommunicationsDrafts.tsx
src/views/CommunicationsDraftForm.tsx
src/views/CommunicationsInbox.tsx
src/views/CommunicationsRouting.tsx
src/views/PersonalOpsView.tsx
src/views/PersonalOpsBriefing.tsx
src/views/PersonalOpsStyleReply.tsx
src/views/PersonalOpsAutonomyQueue.tsx
src/views/RemoteView.tsx
src/views/RemoteSnapshot.tsx
src/views/RemotePeers.tsx
src/views/RemoteWork.tsx
src/views/RemotePairRequests.tsx
src/views/RemotePeerInvokeModal.tsx
src/views/LearningView.tsx
src/views/LearningCurator.tsx
src/views/LearningAutoPromote.tsx
src/views/LearningMemoryPosture.tsx
src/views/ResearchView.tsx       (stretch)
src/views/ResearchBriefing.tsx   (stretch)
src/views/ResearchRuns.tsx       (stretch)
src/views/ResearchSources.tsx    (stretch)
src/components/ConfirmationModal.tsx
src/components/InstallBanner.tsx
src/hooks/useViewport.ts
public/icons/icon-192.png
public/icons/icon-512.png
public/apple-touch-icon.png
public/offline.html
```

### Modified files

```
package.json              — add vite-plugin-pwa, bump @pellux/goodvibes-sdk to 0.33.38
vite.config.ts            — add VitePWA plugin with manifest and Workbox config
src/lib/goodvibes.ts      — update SDK import version, add new SSE topics, update any facade types
src/router.tsx            — add 5 new routes (/communications, /personal-ops, /remote, /learning, /research)
src/components/Sidebar.tsx (or Nav) — add new nav items
src/App.tsx (or root layout) — add <InstallBanner />, mobile bottom-nav
```

---

## 7. Key SDK / Operator Method Reference

| UI Call | agent_harness mode or operator methodId | Effect Level |
|---|---|---|
| Unified inbox fetch | `unified_inbox` | read |
| Drafts list | `channel_drafts` | read |
| Draft detail | `channel_drafts draftId:"<id>"` | read |
| Save draft | `channel_draft_save` + confirm | effect |
| Send draft | `channel_draft_send` + confirm | effect |
| Routing list | `channel_routing` | read |
| Assign routing | `channel_routing_assign` + confirm | effect |
| Remove routing | `channel_routing_remove` + confirm | effect |
| Personal ops map | `personal_ops` | read |
| Personal ops queue | `personal_ops_queue` | read |
| Style-reply compose | `personal_ops action:"read" laneId:"inbox" recordId:"inbox-style-reply-draft"` + confirm | read (local-only) |
| Send reviewed reply | `email action:"send"` + confirm | effect |
| Autonomy queue | `autonomy_queue` | read |
| Remote snapshot | `remote.snapshot` (operator method) | read-network |
| Remote peers list | `remote.peers.list` (operator method) | read-network |
| Remote work list | `remote.work.list` (operator method) | read-network |
| Pair requests list | `remote.pair.requests.list` (operator method) | read-network |
| Approve pair | `remote.pair.requests.approve` + confirm | effect |
| Reject pair | `remote.pair.requests.reject` + confirm | effect |
| Invoke peer | `remote.peers.invoke` + confirm | effect |
| Cancel work | `remote.work.cancel` + confirm | effect |
| Learning curator | `learning_curator` | read |
| Learning candidate | `learning_candidate candidateId:"<id>"` | read |
| Auto-promote | `learning_auto_promote` + confirm | effect |
| Memory posture | `memory_posture` | read |
| Research briefing | `research_briefing` | read |
| Research runs | `research_runs` | read |
| Research sources | `research_queue` | read |
