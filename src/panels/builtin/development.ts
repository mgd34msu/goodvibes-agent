import type { PanelManager } from '../panel-manager.ts';
import { PlanDashboardPanel } from '../plan-dashboard-panel.ts';
import { CostTrackerPanel } from '../cost-tracker-panel.ts';
import type { ResolvedBuiltinPanelDeps } from './shared.ts';
import { requireUiServices } from './shared.ts';

export function registerDevelopmentPanels(manager: PanelManager, deps: ResolvedBuiltinPanelDeps): void {
  manager.registerType({
    id: 'plan',
    name: 'Plan',
    icon: 'P',
    category: 'agent',
    description: 'Active execution plan with phase progress and item status',
    factory: () => new PlanDashboardPanel(deps.planManager),
  });

  if (deps.getOrchestratorUsage) {
    const { getOrchestratorUsage, budgetThreshold } = deps;
    manager.registerType({
      id: 'cost',
      name: 'Cost',
      icon: '$',
      category: 'monitoring',
      description: 'Estimated costs per session, agent, and plan with budget alerts',
      factory: () => {
        const ui = requireUiServices(deps);
        return new CostTrackerPanel(ui.events.turns, ui.events.agents, getOrchestratorUsage, { budgetThreshold });
      },
    });
  }
}
