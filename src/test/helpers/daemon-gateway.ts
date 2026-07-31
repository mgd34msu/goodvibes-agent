/**
 * daemon-gateway.ts — the verb catalog THE DAEMON composes, for tests that need
 * to drive a verb this process no longer serves.
 *
 * ── Why a test builds one and the product does not ────────────────────────
 *
 * The agent used to call `attachWsOnlyGatewayVerbHandlers` on its own catalog,
 * registering fifteen verb families on a surface nothing outside this process
 * can reach — it composes no server and starts no listener. Those handlers are
 * gone from the product; the daemon serves them.
 *
 * The CONTRACTS they implement did not go anywhere, and this agent depends on
 * several of them across the wire: what `checkin.run` records, what
 * `principals.create` round-trips, what `rewind.plan` reports for a session it
 * does not hold, what a `profile.*` write does to the owner profile document.
 * A suite that verified one of those was verifying the platform's behaviour
 * through a convenient local composition, not the agent's own code, and the
 * behaviour is still worth pinning — at the owner that now implements it.
 *
 * So the tests build the composition the daemon builds, from the same public
 * wrapper, over the same graph. Nothing about the product's catalog changes:
 * `services.gatewayMethods` still has no handler for any of these, which is
 * pinned in daemon/gateway-ws-only-invokable.test.ts.
 *
 * ── One caution ───────────────────────────────────────────────────────────
 *
 * This composes real stores under the graph's own `shellPaths`, including the
 * owner-profile document at daemon scope. Every caller here runs against a temp
 * home, and a suite that does not is reaching the machine's real profile.
 */
import { GatewayMethodCatalog } from '@pellux/goodvibes-sdk/platform/control-plane';
import { attachWsOnlyGatewayVerbHandlers } from '@pellux/goodvibes-terminal-shell';
import { createSessionConversationRewindPort } from '../../runtime/conversation-rewind-port.ts';
import type { RuntimeServices } from '../../runtime/services.ts';

export interface DaemonGatewayCatalogOptions {
  /** Override the conversation port; defaults to this process's live registry. */
  readonly conversationRewindPort?: Parameters<typeof attachWsOnlyGatewayVerbHandlers>[1]['conversationRewindPort'];
}

/**
 * Build the catalog a daemon composed from this graph would carry.
 *
 * The dep list is exactly the one the agent's composition root used to pass, so
 * a suite driving this observes what a daemon over this graph does — not a
 * narrower stand-in that happens to answer.
 */
const cached = new WeakMap<RuntimeServices, GatewayMethodCatalog>();

export function buildDaemonGatewayCatalog(
  services: RuntimeServices,
  options: DaemonGatewayCatalogOptions = {},
): GatewayMethodCatalog {
  // One catalog per graph, like a daemon has. Rebuilding per call would give
  // each verb a fresh store, so a `principals.create` followed by a
  // `principals.list` would read an empty registry and the round-trip a suite
  // is asserting would never be observable.
  const existing = cached.get(services);
  if (existing && options.conversationRewindPort === undefined) return existing;
  const catalog = new GatewayMethodCatalog();
  const view = services.asDaemonGradeView();
  attachWsOnlyGatewayVerbHandlers(catalog, {
    processRegistry: services.processRegistry,
    sessionLiveTurnControls: services.sessionLiveTurnControls,
    powerManager: services.powerManager,
    memoryGovernor: services.memoryGovernor,
    voiceSetup: services.voiceSetup,
    workspaceCheckpointManager: services.guardedCheckpoints,
    sessionBroker: view.sessionBroker,
    secretsManager: services.secretsManager,
    approvalBroker: services.approvalBroker,
    requestApproval: (input) => services.approvalBroker.requestApproval(input),
    watcherRegistry: services.watcherRegistry,
    userPermissionRuleStore: view.userPermissionRuleStore,
    runtimeBus: services.runtimeBus,
    shellPaths: services.shellPaths,
    configManager: services.configManager,
    runtimeStore: services.runtimeStore,
    channelDeliveryRouter: services.channelDeliveryRouter,
    providerRegistry: services.providerRegistry,
    automationManager: services.automationManager,
    sessionLister: view.sessionBroker,
    attemptsController: services.orchestrationEngine,
    workingDirectory: services.workingDirectory,
    conversationRewindPort: options.conversationRewindPort ?? createSessionConversationRewindPort(),
  });
  if (options.conversationRewindPort === undefined) cached.set(services, catalog);
  return catalog;
}
