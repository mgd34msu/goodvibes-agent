# GoodVibes Competitive Parity Plan

June 2026. Based on the June 2026 competitive feature inventory.

## Summary

GoodVibes has six verifiable differentiators: review-first safety model, blind model comparison with durable judgment artifacts, isolated knowledge with provenance enforcement, document review packets with reviewer handoff, profiles as starter templates, and honest release gates. These are real and worth pressing.

The honest gaps are: direct email/calendar access (no IMAP/SMTP or CalDAV), channel-to-profile routing, shipped wake word and talk mode, hardware-aware model recommendations, and skill standard interop. Several other areas (channels, web surface, multi-agent backends) are partial.

This plan sequences the work by owner and impact.

---

## Scorecard

Capability columns: GV = GoodVibes, OC = OpenClaw, H = Hermes, O = Odysseus.
Statuses: leading / parity / partial / gap.

| Capability | GV | OC | H | O |
|---|---|---|---|---|
| Review-first safety model | **leading** | partial | partial | partial |
| Blind model comparison + judgment artifacts | **leading** | gap | gap | partial |
| Isolated knowledge with provenance enforcement | **leading** | partial | partial | partial |
| Document review packets + ZIP handoff | **leading** | gap | gap | gap |
| Profiles as starter templates | **leading** | partial | partial | gap |
| Honest release gates (machine-readable) | **leading** | gap | gap | gap |
| One-assistant mental model | parity | parity | parity | parity |
| First-run and always-on setup | parity | parity | parity | parity |
| Autonomous schedules and background work | parity | parity | parity | parity |
| Computer use: browser and shell | parity | parity | parity | parity |
| Deep research and knowledge reports | parity | parity | parity | parity |
| Models and local cookbook | **partial** | parity | parity | leading |
| Omnichannel inbox and delivery (breadth) | **partial** | leading | parity | partial |
| Closed learning loop (review-first) | **partial** | parity | leading | partial |
| Multi-agent and remote execution backends | **partial** | parity | leading | partial |
| Mobile/voice: wake word and talk mode | **partial** | leading | partial | partial |
| Web dashboard and PWA | **partial** | parity | parity | leading |
| Skill standard interop (agentskills.io) | **partial** | parity | leading | gap |
| Email and calendar: direct IMAP/SMTP/CalDAV | **gap** | partial | partial | leading |
| Channel-to-profile routing | **gap** | leading | gap | gap |

---

## Differentiators to Press

Do not chase parity in these areas. Competitors make different tradeoffs and the GoodVibes position is deliberate.

**Review-first autonomy is a feature, not a gap.** Hermes and OpenClaw write skills autonomously during use; GoodVibes requires a confirmation boundary before any behavior becomes durable. This is slower but auditable. The right response is not to remove the boundary but to reduce unnecessary friction for already-approved low-risk actions while keeping the irreversible-effect gate.

**Blind comparison with judgment artifacts is unique.** No competitor produces signed route-decision receipt artifacts that can be archived and audited. This is worth deepening (vision support, latency context in the compare view) not narrowing.

**Honest release gates are a trust signal.** Publishing a machine-readable readiness inventory with live verification pass/fail counts is a differentiator with downstream integrators and enterprises. Keep the gate strict and add the docs stale-command check.

**Isolated knowledge with fail-closed provenance.** No competitor documents per-segment certification or fail-closed behavior when provenance is missing. This is worth making more visible to users (gap surfacing in the Knowledge workspace).

---

## Explicit Non-Goals

- **Remove the review-first confirmation boundary** to match Hermes autonomous skill creation speed. Deliberate divergence.
- **Build 24+ messaging channels to match OpenClaw breadth** as a first priority. Routing quality and profile isolation matter more than raw count.
- **Match Odysseus primary web-first experience** before the PWA cockpit is certified. Ship the TUI improvements; let the PWA follow the daemon contract.
- **Copy agentskills.io autonomous creation** without the review gate. Implement import/export with review-first gating instead.

---

## Workstreams

### Agent Repo (code + goodvibes-sdk)

Work that lives in the goodvibes-agent package and the goodvibes-sdk it consumes. PRs go here.

#### Milestone A: Close the email/calendar gap

Target: direct IMAP/SMTP and CalDAV access without requiring a third-party MCP server.

1. **Add IMAP/SMTP email connector to the operator method surface.** First PR: define the operator method schema for `email.inbox.list`, `email.inbox.read`, `email.draft.create`, and `email.send` with required-field checks and a confirmed send boundary. No sending without explicit confirmation.
2. **Add CalDAV calendar connector.** First PR: define the operator method schema for `calendar.events.list`, `calendar.event.get`, and `calendar.event.create` with `.ics` import/export routes. Scope to Radicale and Nextcloud first; Apple and Fastmail in a follow-up.
3. **Add writing-style-matched draft replies as a Personal Ops lane.** First PR: add a `personal_ops` lane card that composes a draft in the user's writing style from a corpus of prior sent messages, with an explicit before-send review boundary and no auto-send.
4. **Promote Personal Ops item status from `gap` to `partial` then `parity`** in the inventory as each connector ships and is certified.

#### Milestone B: Skill standard interop

Target: agentskills.io-compatible import/export so GoodVibes skills are portable.

1. **Define the skill export schema** aligned with agentskills.io. First PR: add a `skill-export.schema.json` and a confirmed `agent_learning_consolidation` export route that serializes a reviewed skill to the standard format.
2. **Add skill import with review gate.** First PR: add a confirmed `agent_local_registry` import route that ingests an agentskills.io-format skill file, presents a diff preview, and requires explicit confirmation before the skill becomes active.
3. **Add a skill discovery surface** to the Skills workspace that lists importable community skills with provenance and review status. First PR: static community skill index fetch with provenance metadata; no auto-import.
4. **Promote `skill-standard-interop` from `partial` to `parity`** in the inventory once import and export are certified end-to-end.

#### Milestone C: Hardware-aware model recommendations

Target: GPU/VRAM detection in the local cookbook so quantization tier recommendations are accurate.

1. **Add GPU/VRAM detection to the platform hardware scan.** First PR: extend the local cookbook hardware probe to detect NVIDIA/AMD GPU model and VRAM via `nvidia-smi`, `rocm-smi`, or Metal system profiler, with a safe fallback to CPU-only sizing when detection fails.
2. **Map VRAM tiers to quantization recommendations** in the cookbook rank output. First PR: add a `vramTier` field to cookbook candidate records with explicit Q4/Q5/Q6/Q8 guidance per tier.
3. **Promote `models-and-local-model-cookbook` from `partial` to `parity`** in the inventory once hardware-aware ranking is certified in the cookbook smoke test.

#### Milestone D: Deepen differentiators

These press the leading items further rather than chasing parity gaps.

1. **Add provenance gap surfacing to the Knowledge workspace.** First PR: add a `knowledge_space_health` inspection route that lists blocked segments with their blocking reason and a repair route.
2. **Extend blind compare to cover vision/multimodal prompts.** First PR: add image-payload support to the comparison artifact schema with model-identity redaction verified before reveal.
3. **Add a docs stale-command gate** to the release metadata verification tooling. First PR: extend `verifyReleaseMetadata` to scan docs files for slash commands that are not registered, and fail release preflight if any are found.
4. **Publish the release readiness schema** as a public JSON Schema file so downstream integrators can verify agent package releases programmatically.

---

### Runtime (connected host daemon)

Work that requires daemon contract changes. Agent-side can add inspection routes immediately; confirmed effects wait for the daemon to publish the method.

#### Milestone R1: Channel-to-profile routing contract

1. **Define a channel-to-profile routing operator method schema.** Daemon publishes `channels.routing.list`, `channels.routing.set`, and `channels.routing.delete` routes. First PR in daemon: define the schema; first PR in agent: add a Channels workspace routing configuration card that reads the routing table and shows the assign-channel-to-profile form.
2. **Add routing configuration to the Channels setup guide.** First PR: extend the channel setup guide to show the current routing assignment and a confirmed assign step after channel pairing succeeds.
3. **Promote `channel-to-profile-routing` from `gap` to `partial`** in the inventory once the daemon publishes the routing contract and the agent side surfaces it in the Channels workspace.

#### Milestone R2: Docker/SSH terminal backend contract

1. **Define a remote terminal backend operator method schema** for Docker and SSH backends. Daemon publishes `terminal.backends.list`, `terminal.backend.connect`, and `terminal.backend.disconnect` routes. First PR in daemon: schema definition.
2. **Add remote backend selection to the execution workspace.** First PR in agent: extend `execution action:"process_capabilities"` to show available remote backends from the daemon read model.
3. **Promote `multi-agent-and-remote-execution` from `partial` toward `parity`** as each backend ships.

#### Milestone R3: Email/calendar connector operator methods

The Agent-side work in Milestone A depends on these daemon methods.

1. **Publish IMAP/SMTP operator methods** from the daemon: `email.inbox.list`, `email.inbox.read`, `email.draft.create`, `email.send`. First PR in daemon: method schema and bounded output contract.
2. **Publish CalDAV operator methods** from the daemon: `calendar.events.list`, `calendar.event.get`, `calendar.event.create`, `calendar.ics.import`, `calendar.ics.export`. First PR in daemon: method schema.
3. Both milestones must publish certified receipt artifact schemas before the Agent-side confirmation boundary can use them.

---

### Companion Apps

Work that lives in the iOS, Android, or macOS companion applications.

#### Milestone C1: Wake word and talk mode

1. **Ship wake-word capture on macOS companion.** First PR: integrate a wake-word detection library (e.g., Porcupine or Silero) into the macOS companion, wire it to a push-to-talk session start, and surface the wake-word readiness status in `device action:"voice"`.
2. **Design a continuous talk mode loop.** First PR: define the TTS-output-to-push-to-talk handoff protocol so the companion can detect end-of-turn from the TTS stream and re-open the microphone without a button press.
3. **Ship talk mode on Android companion** using ElevenLabs or system TTS. First PR: implement the talk mode loop from the macOS design, wire to the Android companion's foreground audio session.
4. **Promote `mobile-voice-and-device-nodes` from `partial` toward `parity`** as each platform ships wake word and talk mode.

#### Milestone C2: Profile starter templates in onboarding

1. **Add a profile gallery fetch to the companion onboarding flow.** First PR: companion fetches a community starter template index, shows tiles with name/description/personality preview, and triggers the Agent-side profile import on selection.
2. **Add full channel configuration to profile export.** First PR: extend the profile export schema to include channel assignments and permission posture, making the export fully reproducible on a new device.
