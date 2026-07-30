/**
 * phone-device-service.ts — this agent's binding to the platform's paired-device
 * feature.
 *
 * The feature itself — which peers count as device nodes, how a capability
 * request becomes a work item, how the confirmation reaches the person, and how
 * every `device.*` setting maps onto the stores and the capability service —
 * lives in the SDK (`platform/devices/device-posture-runtime.ts`). It used to
 * live HERE and nowhere else, which is exactly why those settings did nothing in
 * any other daemon host: a behavioural contract written inside one consumer is a
 * contract only that consumer honours.
 *
 * What remains here is this agent's own I/O: its distributed runtime as the peer
 * transport, its approval bridge, its config manager, and the actor name its
 * audit trail records.
 */
import {
  createDevicePostureRuntime,
  readDeviceCapabilityPolicy,
  DEVICE_NODE_ANNOUNCEMENT_KEY,
  readDeviceAnnouncement,
} from '@pellux/goodvibes-sdk/platform/devices';
import type {
  DeviceApprovalBridge,
  DeviceCapabilityPolicy,
  DeviceNodeAnnouncement,
  DevicePeerView,
  DevicePostureRuntime,
} from '@pellux/goodvibes-sdk/platform/devices';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { DistributedRuntimeManager } from '@/runtime/index.ts';

/**
 * Re-exported so this agent's own modules and tests keep one import site for the
 * announcement contract: the metadata key a device node's pair request carries
 * its announcement under, and the reader that turns a peer into an announcement.
 */
export { DEVICE_NODE_ANNOUNCEMENT_KEY, readDeviceAnnouncement };
export type { DeviceNodeAnnouncement, DevicePeerView };

/** Who this agent records in the device audit trail. */
export const AGENT_DEVICE_ACTOR = 'agent:phone-tool';

/** Minimal view of the approval path this service needs. */
export type PhoneApprovalBridge = DeviceApprovalBridge;

export interface PhoneDeviceServiceOptions {
  readonly distributedRuntime: DistributedRuntimeManager;
  readonly approvals: PhoneApprovalBridge;
  readonly configManager: ConfigManager;
  /** Directory the grants ledger, captures, and disclosure log live under. */
  readonly stateDirectory: string;
  readonly getSessionId?: (() => string | undefined) | undefined;
}

/** Everything the `phone` tool needs, assembled from the running agent. */
export type PhoneDeviceService = DevicePostureRuntime;

/**
 * The `device.*` posture this agent is running under right now. The runtime
 * re-reads configuration per request; this is the same read, for a caller that
 * wants to report the posture rather than act on it.
 */
export function readPhoneDevicePolicy(configManager: ConfigManager): DeviceCapabilityPolicy {
  return readDeviceCapabilityPolicy(configManager);
}

export function createPhoneDeviceService(options: PhoneDeviceServiceOptions): PhoneDeviceService {
  return createDevicePostureRuntime({
    // The agent's distributed runtime manager IS the peer transport: the two
    // members the platform runtime reaches (listPeers, invokePeer) are the two
    // it implements.
    transport: options.distributedRuntime,
    approvals: options.approvals,
    config: options.configManager,
    stateDirectory: options.stateDirectory,
    actor: AGENT_DEVICE_ACTOR,
    ...(options.getSessionId ? { getSessionId: options.getSessionId } : {}),
  });
}
