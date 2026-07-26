/**
 * phone-device-install.ts — one call that stands the paired-phone capability
 * feature up inside a booting agent.
 *
 * Kept apart from bootstrap.ts so the composition root gains one call rather
 * than a block: build the service, register the `phone` tool on it, and start
 * housekeeping.
 *
 * The startup sweep is not optional wiring. Grants and captures both outlive a
 * restart, so a grant whose phone is no longer paired, or a capture torn by a
 * crash, has to be removed BEFORE the first request of this run is served —
 * and the periodic sweep after it is what keeps a long-running process from
 * going days without one. A failed sweep is logged and the agent still boots:
 * housekeeping failing is a reason to say so, not a reason to refuse to start.
 */
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { registerDevicesGatewayMethods } from '@pellux/goodvibes-sdk/platform/control-plane';
import type { GatewayMethodCatalog } from '@pellux/goodvibes-sdk/platform/control-plane';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { registerAgentPhoneTool } from '../tools/agent-phone-tool.ts';
import { createPhoneDeviceService, type PhoneDeviceService, type PhoneDeviceServiceOptions } from './phone-device-service.ts';

export interface PhoneDeviceInstallOptions extends PhoneDeviceServiceOptions {
  readonly toolRegistry: ToolRegistry;
  /**
   * The gateway catalog. Binding it turns devices.nodes.list /
   * devices.grants.* / devices.housekeeping.run from cataloged-but-unhandled
   * into real handlers, which is what makes the grants surface work in the web
   * app rather than only through this agent's own tool.
   */
  readonly gatewayMethods?: GatewayMethodCatalog | undefined;
}

/** Build the service, register the tool and the gateway verbs, and start housekeeping. */
export function installPhoneDeviceTool(options: PhoneDeviceInstallOptions): PhoneDeviceService {
  const service = createPhoneDeviceService(options);
  registerAgentPhoneTool(options.toolRegistry, service);
  if (options.gatewayMethods) registerDevicesGatewayMethods(options.gatewayMethods, service);
  void service.startHousekeeping().catch((error: unknown) => {
    logger.warn('Device housekeeping sweep failed at startup', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return service;
}
