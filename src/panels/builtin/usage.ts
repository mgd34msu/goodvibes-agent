import type { PanelManager } from '../panel-manager.ts';
import { CostTrackerPanel } from '../cost-tracker-panel.ts';
import type { ResolvedBuiltinPanelDeps } from './shared.ts';
import { requireUiServices } from './shared.ts';

export function registerUsagePanels(manager: PanelManager, deps: ResolvedBuiltinPanelDeps): void {
  if (!deps.getOrchestratorUsage) return;

  const { getOrchestratorUsage, budgetThreshold } = deps;
  manager.registerType({
    id: 'cost',
    name: 'Cost',
    icon: '$',
    category: 'monitoring',
    description: 'Estimated assistant usage costs for this session and explicit delegated work, with budget alerts',
    factory: () => {
      const ui = requireUiServices(deps);
      return new CostTrackerPanel(ui.events.turns, ui.events.agents, getOrchestratorUsage, { budgetThreshold });
    },
  });
}
