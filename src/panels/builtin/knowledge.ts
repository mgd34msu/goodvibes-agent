import type { PanelManager } from '../panel-manager.ts';
import { MemoryPanel } from '../memory-panel.ts';
import { KnowledgePanel } from '../knowledge-panel.ts';
import type { ResolvedBuiltinPanelDeps } from './shared.ts';

export function registerKnowledgePanels(manager: PanelManager, deps: ResolvedBuiltinPanelDeps): void {
  if (!deps.memoryRegistry) return;

  const { agentKnowledgeService, memoryRegistry } = deps;
  manager.registerType({
    id: 'knowledge',
    name: 'Knowledge',
    icon: 'K',
    category: 'agent',
    description: 'Isolated Agent Knowledge plus local non-secret memory review',
    factory: () => new KnowledgePanel(memoryRegistry, agentKnowledgeService ?? null),
  });
  manager.registerType({
    id: 'memory',
    name: 'Memory',
    icon: 'M',
    category: 'agent',
    description: 'Project memory: decisions, constraints, incidents, and patterns with provenance links',
    factory: () => new MemoryPanel(memoryRegistry),
  });
}
