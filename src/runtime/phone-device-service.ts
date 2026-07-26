/**
 * phone-device-service.ts — wires the SDK's paired-device capability contract
 * into this agent's running parts.
 *
 * Three bindings live here and nowhere else:
 *  - the node list, read from the distributed runtime's paired peers (a peer
 *    whose metadata carries a device-node announcement is a device node),
 *  - the dispatcher, which puts one `device.capability` work item on that
 *    peer's queue and waits for the completion,
 *  - the confirmation handler, which routes the ask through the shared
 *    approval broker so the prompt appears on whatever surface the person is
 *    actually looking at, with "always allow" offered as a remember tier.
 *
 * Nothing here knows or cares what KIND of node answers. A native node that
 * pairs with the same announcement and answers the same work type is served by
 * this exact code path.
 */
import { join } from 'node:path';
import {
  DeviceCapabilityService,
  DeviceCaptureArtifactStore,
  DeviceGrantStore,
  DeviceHousekeeper,
  DEVICE_CAPABILITY_CONTRACT_VERSION,
  buildDeviceCapabilityWorkRequest,
  decodeDeviceCapabilityMedia,
  parseDeviceCapabilityWorkResult,
  resolveDeviceNodeProfile,
  type DeviceCapabilityDispatcher,
  type DeviceCapabilityPolicy,
  type DeviceConfirmationHandler,
  type DeviceDispatchResult,
  type DeviceNodeAnnouncement,
  type DeviceNodeProfile,
} from '@pellux/goodvibes-sdk/platform/devices';
import type { ConfigKey, ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { DistributedRuntimeManager } from '@/runtime/index.ts';
import type { PermissionPromptDecision, PermissionPromptRequest } from '@pellux/goodvibes-sdk/platform/permissions';

/** Metadata key a device node's pair request carries its announcement under. */
export const DEVICE_NODE_ANNOUNCEMENT_KEY = 'deviceNode';

/** Minimal view of the approval path this service needs. */
export interface PhoneApprovalBridge {
  requestApproval(input: {
    readonly request: PermissionPromptRequest;
    readonly sessionId?: string | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
    readonly timeoutMs?: number | undefined;
  }): Promise<PermissionPromptDecision>;
}

export interface PhoneDeviceServiceOptions {
  readonly distributedRuntime: DistributedRuntimeManager;
  readonly approvals: PhoneApprovalBridge;
  readonly configManager: ConfigManager;
  /** Directory the grants ledger, captures, and disclosure log live under. */
  readonly stateDirectory: string;
  readonly getSessionId?: (() => string | undefined) | undefined;
}

function readNumber(configManager: ConfigManager, key: ConfigKey, fallback: number): number {
  const value: unknown = configManager.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readString(configManager: ConfigManager, key: ConfigKey, fallback: string): string {
  const value: unknown = configManager.get(key);
  return typeof value === 'string' && value ? value : fallback;
}

/** Read the live `device.*` configuration into the service's policy shape. */
export function readPhoneDevicePolicy(configManager: ConfigManager): DeviceCapabilityPolicy {
  return {
    mode: readString(configManager, 'device.capabilities.mode', 'honor-grants') as DeviceCapabilityPolicy['mode'],
    allowAlwaysOffer: readString(configManager, 'device.capabilities.allowAlwaysOffer', 'every-capability') as DeviceCapabilityPolicy['allowAlwaysOffer'],
    locationPrecision: readString(configManager, 'device.location.precision', 'precise-grantable') as DeviceCapabilityPolicy['locationPrecision'],
    clipboardReadMode: readString(configManager, 'device.clipboard.readMode', 'grantable') as DeviceCapabilityPolicy['clipboardReadMode'],
    requestTimeoutMs: readNumber(configManager, 'device.capabilities.requestTimeoutSeconds', 60) * 1000,
    captureRetentionMs: readNumber(configManager, 'device.capture.retentionHours', 24) * 60 * 60 * 1000,
  };
}

/**
 * Read a peer's device-node announcement out of its pairing metadata.
 * A peer without one is an ordinary peer, not a device node.
 */
export function readDeviceAnnouncement(
  peer: { readonly id: string; readonly label: string; readonly kind: string; readonly platform?: string | undefined; readonly version?: string | undefined; readonly capabilities: readonly string[]; readonly metadata: Record<string, unknown> },
): DeviceNodeAnnouncement | null {
  const raw = peer.metadata[DEVICE_NODE_ANNOUNCEMENT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const nodeKind = typeof record.nodeKind === 'string' ? record.nodeKind : '';
  if (!nodeKind) return null;
  const declared = Array.isArray(record.capabilities)
    ? record.capabilities.filter((entry): entry is string => typeof entry === 'string')
    : peer.capabilities;
  return {
    nodeId: peer.id,
    nodeKind,
    label: peer.label,
    platform: peer.platform ?? '',
    appVersion: peer.version ?? '',
    contractVersion: typeof record.contractVersion === 'number' ? record.contractVersion : DEVICE_CAPABILITY_CONTRACT_VERSION,
    capabilities: declared,
    secureContext: record.secureContext !== false,
  };
}

/** Everything the `phone` tool needs, assembled from the running agent. */
export interface PhoneDeviceService {
  readonly capabilities: DeviceCapabilityService;
  readonly grants: DeviceGrantStore;
  readonly artifacts: DeviceCaptureArtifactStore;
  readonly housekeeper: DeviceHousekeeper;
  listNodes(): readonly DeviceNodeProfile[];
  /** Recovery sweep plus the periodic timer; call once during bootstrap. */
  startHousekeeping(): Promise<void>;
  stopHousekeeping(): void;
}

export function createPhoneDeviceService(options: PhoneDeviceServiceOptions): PhoneDeviceService {
  const { distributedRuntime, approvals, configManager, stateDirectory } = options;

  const listNodes = (): readonly DeviceNodeProfile[] => {
    const profiles: DeviceNodeProfile[] = [];
    for (const peer of distributedRuntime.listPeers('device')) {
      if (peer.status === 'revoked') continue;
      const announcement = readDeviceAnnouncement(peer);
      if (!announcement) continue;
      const resolved = resolveDeviceNodeProfile(announcement);
      if (resolved.ok) profiles.push(resolved.profile);
    }
    return profiles;
  };

  const grants = new DeviceGrantStore(join(stateDirectory, 'device-grants.json'), {
    policy: {
      grantTtlMs: readNumber(configManager, 'device.grants.expiryDays', 90) * 24 * 60 * 60 * 1000,
      maxGrantsPerNode: readNumber(configManager, 'device.grants.maxPerNode', 64),
      auditRetentionMs: readNumber(configManager, 'device.grants.auditRetentionDays', 30) * 24 * 60 * 60 * 1000,
    },
    ownership: {
      // A grant belongs to a paired node. Once that node is gone the grant is
      // reaped rather than left to be re-honoured if the id is ever reused.
      isKnownNode: (nodeId) => listNodes().some((node) => node.nodeId === nodeId),
    },
  });

  const artifacts = new DeviceCaptureArtifactStore(join(stateDirectory, 'captures'), {
    policy: {
      retentionMs: readNumber(configManager, 'device.capture.retentionHours', 24) * 60 * 60 * 1000,
      maxArtifacts: readNumber(configManager, 'device.capture.maxArtifacts', 200),
    },
  });

  const housekeeper = new DeviceHousekeeper({
    grants,
    artifacts,
    disclosurePath: join(stateDirectory, 'device-housekeeping.json'),
  });

  const dispatcher: DeviceCapabilityDispatcher = {
    async dispatch(input): Promise<DeviceDispatchResult> {
      const payload = buildDeviceCapabilityWorkRequest({
        capabilityId: input.capabilityId,
        input: input.input,
        reason: typeof input.input.reason === 'string' ? input.input.reason : '',
        timeoutMs: input.timeoutMs,
        contractVersion: DEVICE_CAPABILITY_CONTRACT_VERSION,
      });
      const { work, completed } = await distributedRuntime.invokePeer({
        peerId: input.nodeId,
        command: input.capabilityId,
        type: 'device.capability',
        payload,
        actor: 'agent:phone-tool',
        waitMs: input.timeoutMs,
        timeoutMs: input.timeoutMs,
      });
      if (!completed || work.status !== 'completed') {
        return {
          ok: false,
          error: work.error?.trim()
            ? work.error.trim()
            : `The device did not answer within ${Math.round(input.timeoutMs / 1000)}s (work ${work.id} is ${work.status}).`,
          workId: work.id,
        };
      }
      const result = parseDeviceCapabilityWorkResult(work.result);
      if (!result) {
        return { ok: false, error: 'The device returned a result this contract does not recognise.', workId: work.id };
      }
      if (!result.ok) {
        return { ok: false, error: result.error ?? 'The device declined or failed the request.', workId: work.id };
      }
      const bytes = decodeDeviceCapabilityMedia(result);
      return {
        ok: true,
        workId: work.id,
        ...(result.data === undefined ? {} : { data: result.data }),
        ...(bytes ? { bytes } : {}),
        ...(result.mediaType ? { mediaType: result.mediaType } : {}),
      };
    },
  };

  const confirm: DeviceConfirmationHandler = async (request) => {
    // "Always allow" rides the standard remember-tier machinery, so the same
    // prompt renders it on every surface. The 'tool' tier is the durable one
    // here: this capability, on this node, until revoked or expired.
    const promptRequest: PermissionPromptRequest = {
      callId: `phone-${request.capabilityId}-${Date.now()}`,
      tool: 'phone',
      args: {
        node: request.nodeLabel,
        nodeId: request.nodeId,
        capability: request.capabilityId,
        reason: request.reason,
        ...request.input,
      },
      category: request.descriptor.effect === 'actuate' ? 'write' : 'read',
      analysis: {
        classification: `device.${request.descriptor.family}`,
        riskLevel: request.descriptor.sensitivity === 'elevated' ? 'high' : 'medium',
        summary: `${request.descriptor.title} on ${request.nodeLabel}`,
        reasons: [request.descriptor.purpose, request.reason].filter((entry) => entry.trim().length > 0),
        target: request.nodeLabel,
        sideEffects: request.descriptor.producesArtifact
          ? [`retains a ${request.descriptor.artifactKind} capture for the configured retention window`]
          : [],
      },
      ...(request.allowAlwaysOffered
        ? {
          rememberOptions: [{
            tier: 'tool' as const,
            label: `Always allow ${request.descriptor.title.toLowerCase()} on ${request.nodeLabel}`,
            detail: 'Durable grant for this one capability on this one device. Visible and revocable in the device grants surface.',
          }],
        }
        : {}),
    };
    const decision = await approvals.requestApproval({
      request: promptRequest,
      ...(options.getSessionId?.() ? { sessionId: options.getSessionId?.() } : {}),
      metadata: {
        deviceNodeId: request.nodeId,
        deviceNodeKind: request.nodeKind,
        deviceCapability: request.capabilityId,
        allowAlwaysOffered: request.allowAlwaysOffered,
      },
      timeoutMs: readNumber(configManager, 'device.capabilities.requestTimeoutSeconds', 60) * 1000,
    });
    if (!decision.approved) {
      return { decision: 'deny', actor: 'operator', ...(decision.reason ? { note: decision.reason } : {}) };
    }
    const durable = decision.rememberTier !== undefined && decision.rememberTier !== 'session';
    return { decision: durable ? 'always' : 'once', actor: 'operator' };
  };

  const capabilities = new DeviceCapabilityService({
    grants,
    artifacts,
    dispatcher,
    confirm,
    listNodes,
    policy: readPhoneDevicePolicy(configManager),
  });

  return {
    capabilities,
    grants,
    artifacts,
    housekeeper,
    listNodes,
    async startHousekeeping(): Promise<void> {
      // Recovery first: a grant whose node is gone, or a capture torn by a
      // crash, is removed BEFORE the first request of this run is served.
      await housekeeper.runRecoverySweep();
      housekeeper.start(readNumber(configManager, 'device.capture.sweepIntervalMinutes', 30) * 60 * 1000);
    },
    stopHousekeeping(): void {
      housekeeper.stop();
    },
  };
}
