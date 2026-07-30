/**
 * agent-phone-tool.ts — this agent's registration of the native `phone` tool.
 *
 * The tool itself is platform-owned (`platform/devices/device-phone-tool.ts`):
 * it is the only path that reaches the device capability service, so keeping it
 * in one product is what made the `device.*` posture unobservable in every other
 * host. The schema, the refusal wording, and the retention disclosure are now
 * identical wherever a device posture runtime is composed.
 *
 * What stays here is the registration itself, so this agent's composition root
 * keeps its own one-line call site and its own tests.
 */
import { createDevicePhoneTool, registerDevicePhoneTool } from '@pellux/goodvibes-sdk/platform/devices';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { PhoneDeviceService } from '../runtime/phone-device-service.ts';

export function createAgentPhoneTool(service: PhoneDeviceService): Tool {
  return createDevicePhoneTool(service);
}

export function registerAgentPhoneTool(registry: ToolRegistry, service: PhoneDeviceService): void {
  registerDevicePhoneTool(registry, service);
}
