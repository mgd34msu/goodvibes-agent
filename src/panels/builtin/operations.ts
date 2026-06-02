import type { PanelManager } from '../panel-manager.ts';
import { ApprovalPanel } from '../approval-panel.ts';
import { AutomationControlPanel } from '../automation-control-panel.ts';
import { SubscriptionPanel } from '../subscription-panel.ts';
import { ProviderAccountsPanel } from '../provider-accounts-panel.ts';
import { SecurityPanel } from '../security-panel.ts';
import { TasksPanel } from '../tasks-panel.ts';
import { ProviderStatsPanel } from '../provider-stats-panel.ts';
import { ProviderHealthPanel } from '../provider-health-panel.ts';
import { PolicyPanel } from '../policy-panel.ts';
import { createProviderAccountSnapshotQuery } from '../provider-account-snapshot.ts';
import {
  createEnvironmentVariableQuery,
  createProviderRuntimeInspectionQuery,
} from '../../runtime/ui-service-queries.ts';
import { createRuntimeProviderApi } from '@/runtime/index.ts';
import type { ResolvedBuiltinPanelDeps } from './shared.ts';
import { requireUiServices } from './shared.ts';

export function registerOperationsPanels(manager: PanelManager, deps: ResolvedBuiltinPanelDeps): void {
  const ui = requireUiServices(deps);
  const providerRuntime = createProviderRuntimeInspectionQuery(createRuntimeProviderApi({
    benchmarkStore: ui.providers.benchmarkStore,
    favoritesStore: ui.providers.favoritesStore,
    providerRegistry: ui.providers.providerRegistry,
  }));
  const providerAccounts = createProviderAccountSnapshotQuery({
    providerModels: deps.providerRegistry,
    services: deps.serviceRegistry,
    subscriptions: deps.subscriptionManager,
    environment: createEnvironmentVariableQuery(process.env),
  });

  manager.registerType({
    id: 'approval',
    name: 'Approval',
    icon: 'A',
    category: 'monitoring',
    description: 'Action-specific approval workspace for why-prompted, why-denied, and what-if review',
    factory: () => new ApprovalPanel(deps.policyRuntimeState),
  });

  manager.registerType({
    id: 'automation',
    name: 'Automation',
    icon: 'M',
    category: 'monitoring',
    description: 'Read-only automation jobs, runs, deliveries, and failure posture from connected GoodVibes services',
    factory: () => new AutomationControlPanel(ui.readModels.automation),
  });

  manager.registerType({
    id: 'subscription',
    name: 'Subscriptions',
    icon: 'B',
    category: 'monitoring',
    description: 'OAuth-backed provider subscriptions and supported provider override posture',
    factory: () => new SubscriptionPanel(deps.serviceRegistry, deps.subscriptionManager),
  });

  manager.registerType({
    id: 'accounts',
    name: 'Accounts',
    icon: 'Q',
    category: 'monitoring',
    description: 'Provider auth routes, subscription quota-window hints, and billing-path safety notes',
    factory: () => new ProviderAccountsPanel({ providerAccounts }),
  });

  manager.registerType({
    id: 'security',
    name: 'Security',
    icon: 'U',
    category: 'monitoring',
    description: 'Security review workspace for token audit, policy posture, MCP quarantine, and incident pressure',
    factory: () => new SecurityPanel(ui.readModels.security),
  });

  manager.registerType({
    id: 'tasks',
    name: 'Tasks',
    icon: 'J',
    category: 'monitoring',
    description: 'Queued, running, blocked, failed, and completed task summaries from connected GoodVibes services',
    factory: () => new TasksPanel(ui.readModels.tasks),
  });

  manager.registerType({
    id: 'providers',
    name: 'Providers',
    icon: 'R',
    category: 'monitoring',
    description: 'Per-provider performance metrics: latency, error rate, request count, sparkline trends',
    factory: () => new ProviderStatsPanel(ui.events.turns, ui.events.providers, deps.requestRender, ui.readModels.providers),
  });

  manager.registerType({
    id: 'provider-health',
    name: 'Health',
    icon: 'N',
    category: 'monitoring',
    description: 'Provider health dashboard: real-time status, latency, errors, and rate-limit cooldowns',
    preload: true,
    factory: () => new ProviderHealthPanel(
      providerRuntime,
      {
        configManager: deps.configManager,
        turnEvents: ui.events.turns,
        providerEvents: ui.events.providers,
        providers: ui.readModels.providers,
        session: ui.readModels.session,
        security: ui.readModels.security,
        localAuth: ui.readModels.localAuth,
        settings: ui.readModels.settings,
        remote: ui.readModels.remote,
        continuity: ui.readModels.continuity,
      },
      deps.requestRender,
    ),
  });

  manager.registerType({
    id: 'policy',
    name: 'Policy',
    icon: 'U',
    category: 'monitoring',
    description: 'Policy governance: active/candidate bundles, divergence gate, rollout history, and simulation evidence',
    factory: () => new PolicyPanel(deps.policyRuntimeState),
  });
}
