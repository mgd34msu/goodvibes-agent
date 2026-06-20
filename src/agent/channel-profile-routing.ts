/**
 * channel-profile-routing.ts
 *
 * Agent-side channel-to-profile routing scaffold.
 *
 * Assigns a channel (surface kind, optional route id) to an active GoodVibes
 * profile so that incoming channel interactions can be routed to the correct
 * agent persona/profile context.
 *
 * Persistence: JSON file at {agentRoot}/channels/profile-routes.json via
 * ShellPathService. Assignments are agent-local and survive sessions.
 *
 * SEAM — Daemon contract needed for full runtime routing:
 *
 *   Daemon method:  channels.routing.assign
 *   Input:          { channelId: string; profileId: string; routeId?: string }
 *   Output:         { assignmentId: string; channelId: string; profileId: string }
 *
 *   Until that method is published, this module persists assignments locally.
 *   The `daemonMethodNeeded` field on each assignment makes the gap machine-
 *   readable so tooling can detect and surface it.
 *
 *   When the daemon method ships:
 *   1. Add an adapter that calls operator.invoke('channels.routing.assign', ...)
 *   2. Mirror the local store for offline fallback
 *   3. Remove the `daemonSyncState: 'local_only'` flag from existing records
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Represents a channel-to-profile assignment.
 *
 * `surfaceKind` maps to the existing ChannelDeliverySurfaceKind values
 * (slack, discord, telegram, etc.) plus 'any' as a wildcard.
 */
export interface ChannelProfileRoute {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The channel surface kind (e.g. 'slack', 'discord', 'telegram'). Use 'any' as wildcard. */
  readonly surfaceKind: string;
  /** Optional route id to narrow beyond surface kind. */
  readonly routeId?: string;
  /** The profile id to route this channel to. */
  readonly profileId: string;
  /** Optional human-readable label. */
  readonly label?: string;
  /**
   * Indicates this assignment lives only in the local agent store.
   * Remains 'local_only' until daemon publishes channels.routing.assign.
   */
  readonly daemonSyncState: 'local_only';
  /**
   * SEAM: the daemon operator method needed for runtime-aware routing.
   * Remove this field once the contract is published and synced.
   */
  readonly daemonMethodNeeded: 'channels.routing.assign';
}

export interface ChannelProfileRouteSnapshot {
  readonly path: string;
  readonly exists: boolean;
  readonly routes: readonly ChannelProfileRoute[];
  readonly parseError?: string;
}

export interface ChannelProfileRouteAssignResult {
  readonly route: ChannelProfileRoute;
  readonly path: string;
  readonly created: boolean;
}

// ---------------------------------------------------------------------------
// Internal file model
// ---------------------------------------------------------------------------

interface ChannelProfileRouteFile {
  readonly version: 1;
  readonly routes: readonly ChannelProfileRoute[];
}

type ShellPaths = Pick<ShellPathService, 'resolveUserPath'>;

const ROUTE_VERSION = 1 as const;
const ROUTE_FILE_VERSION = 1 as const;
const ROUTE_LIMIT = 500;

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

export function channelProfileRouteFilePath(shellPaths: ShellPaths): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'channels', 'profile-routes.json');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptString(value: unknown): string | undefined {
  const s = readString(value);
  return s || undefined;
}

function parseRoute(value: unknown): ChannelProfileRoute | null {
  if (!isRecord(value) || value.version !== ROUTE_VERSION) return null;
  const id = readString(value.id);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const surfaceKind = readString(value.surfaceKind);
  const profileId = readString(value.profileId);
  if (!id || !createdAt || !updatedAt || !surfaceKind || !profileId) return null;
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    version: ROUTE_VERSION,
    id,
    createdAt,
    updatedAt,
    surfaceKind,
    profileId,
    ...( readOptString(value.routeId) ? { routeId: readOptString(value.routeId) } : {}),
    ...( readOptString(value.label) ? { label: readOptString(value.label) } : {}),
    daemonSyncState: 'local_only',
    daemonMethodNeeded: 'channels.routing.assign',
  };
}

function parseRouteFile(raw: unknown): ChannelProfileRouteFile {
  if (!isRecord(raw)) return { version: ROUTE_FILE_VERSION, routes: [] };
  const routes = Array.isArray(raw.routes)
    ? raw.routes.map(parseRoute).filter((r): r is ChannelProfileRoute => r !== null)
    : [];
  return { version: ROUTE_FILE_VERSION, routes };
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readChannelProfileRoutes(shellPaths: ShellPaths): ChannelProfileRouteSnapshot {
  const path = channelProfileRouteFilePath(shellPaths);
  if (!existsSync(path)) return { path, exists: false, routes: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return { path, exists: true, routes: parseRouteFile(parsed).routes };
  } catch (error) {
    return {
      path,
      exists: true,
      routes: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeRoutes(path: string, routes: readonly ChannelProfileRoute[]): void {
  const file: ChannelProfileRouteFile = {
    version: ROUTE_FILE_VERSION,
    routes: routes.slice(0, ROUTE_LIMIT),
  };
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, path);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assign a channel (identified by surfaceKind + optional routeId) to a profile.
 *
 * If an assignment for the same (surfaceKind, routeId) pair already exists,
 * it is updated in-place. Otherwise a new assignment is created.
 *
 * Returns the assignment record and whether it was newly created.
 *
 * SEAM: when daemon publishes `channels.routing.assign`, add a call here and
 * set `daemonSyncState` based on the daemon response.
 */
export function assignChannelToProfile(
  shellPaths: ShellPaths,
  input: {
    readonly surfaceKind: string;
    readonly routeId?: string;
    readonly profileId: string;
    readonly label?: string;
  },
): ChannelProfileRouteAssignResult {
  const surfaceKind = input.surfaceKind.trim();
  const profileId = input.profileId.trim();
  if (!surfaceKind) throw new Error('surfaceKind is required for channel-to-profile assignment.');
  if (!profileId) throw new Error('profileId is required for channel-to-profile assignment.');

  const snapshot = readChannelProfileRoutes(shellPaths);
  const path = channelProfileRouteFilePath(shellPaths);
  const now = new Date().toISOString();

  // Find existing assignment for the same (surfaceKind, routeId) pair
  const routeId = input.routeId?.trim() || undefined;
  const existingIndex = snapshot.routes.findIndex(
    (r) => r.surfaceKind === surfaceKind && r.routeId === routeId,
  );
  const existing = existingIndex >= 0 ? snapshot.routes[existingIndex] : null;
  const created = !existing;

  const route: ChannelProfileRoute = {
    version: ROUTE_VERSION,
    id: existing?.id ?? `cpr-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    surfaceKind,
    profileId,
    ...(routeId ? { routeId } : {}),
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    daemonSyncState: 'local_only',
    daemonMethodNeeded: 'channels.routing.assign',
  };

  let updatedRoutes: readonly ChannelProfileRoute[];
  if (existingIndex >= 0) {
    updatedRoutes = snapshot.routes.map((r, i) => (i === existingIndex ? route : r));
  } else {
    updatedRoutes = [route, ...snapshot.routes];
  }

  writeRoutes(path, updatedRoutes);
  return { route, path, created };
}

/** List all channel-to-profile assignments, optionally filtered by profileId. */
export function listChannelProfileRoutes(
  shellPaths: ShellPaths,
  options: { readonly profileId?: string; readonly surfaceKind?: string } = {},
): ChannelProfileRouteSnapshot {
  const snapshot = readChannelProfileRoutes(shellPaths);
  let routes = snapshot.routes;
  if (options.profileId) {
    routes = routes.filter((r) => r.profileId === options.profileId);
  }
  if (options.surfaceKind) {
    routes = routes.filter((r) => r.surfaceKind === options.surfaceKind || r.surfaceKind === 'any');
  }
  return { ...snapshot, routes };
}

/**
 * Get the profile id for an incoming channel message.
 *
 * Resolution order: exact (surfaceKind + routeId) → surface wildcard (surfaceKind only) → any wildcard.
 * Returns null if no assignment exists.
 */
export function getProfileForChannel(
  shellPaths: ShellPaths,
  surfaceKind: string,
  routeId?: string,
): string | null {
  const snapshot = readChannelProfileRoutes(shellPaths);
  const { routes } = snapshot;

  // Exact match: surfaceKind + routeId
  if (routeId) {
    const exact = routes.find((r) => r.surfaceKind === surfaceKind && r.routeId === routeId);
    if (exact) return exact.profileId;
  }

  // Surface match: surfaceKind only (no routeId on the assignment)
  const surfaceMatch = routes.find((r) => r.surfaceKind === surfaceKind && !r.routeId);
  if (surfaceMatch) return surfaceMatch.profileId;

  // Wildcard match
  const wildcard = routes.find((r) => r.surfaceKind === 'any');
  if (wildcard) return wildcard.profileId;

  return null;
}

/** Remove a channel-to-profile assignment by id. Returns true if removed. */
export function removeChannelProfileRoute(
  shellPaths: ShellPaths,
  routeId: string,
): boolean {
  const snapshot = readChannelProfileRoutes(shellPaths);
  const before = snapshot.routes.length;
  const updated = snapshot.routes.filter((r) => r.id !== routeId);
  if (updated.length === before) return false;
  writeRoutes(channelProfileRouteFilePath(shellPaths), updated);
  return true;
}

/** Format the routing table for human-readable output. */
export function formatChannelProfileRoutes(snapshot: ChannelProfileRouteSnapshot): string {
  const lines = [
    'Channel-to-Profile Routing',
    `  path: ${snapshot.path}`,
    `  total: ${snapshot.routes.length}`,
    `  sync: local_only — daemon method needed: channels.routing.assign`,
    `  status: ${snapshot.parseError ? 'attention' : snapshot.exists ? 'ready' : 'empty'}`,
    ...(snapshot.parseError ? [`  parse error: ${snapshot.parseError}`] : []),
    '',
  ];
  if (snapshot.routes.length === 0) {
    lines.push('  no channel-to-profile assignments');
  } else {
    for (const route of snapshot.routes) {
      const channelDesc = route.routeId ? `${route.surfaceKind}:${route.routeId}` : route.surfaceKind;
      lines.push(`  ${route.id}  channel=${channelDesc} → profile=${route.profileId}${route.label ? ` (${route.label})` : ''}  sync=${route.daemonSyncState}`);
    }
  }
  return lines.join('\n');
}
