import type { AgentWorkspace } from '../input/agent-workspace.ts';
import type { CompositeRequest } from '../renderer/compositor.ts';
import { renderAgentWorkspace } from '../renderer/agent-workspace.ts';
import { type Line, createEmptyLine } from '../types/grid.ts';

function normalizeFullscreenViewport(lines: readonly Line[], width: number, height: number): Line[] {
  const viewport = lines.slice(0, height).map((line) => {
    if (line.length === width) return line;
    const next = createEmptyLine(width);
    for (let index = 0; index < Math.min(width, line.length); index += 1) {
      next[index] = { ...line[index]! };
    }
    return next;
  });
  while (viewport.length < height) viewport.push(createEmptyLine(width));
  return viewport;
}

export function createAgentWorkspaceFullscreenComposite(
  workspace: AgentWorkspace,
  width: number,
  height: number,
): CompositeRequest {
  return {
    width,
    height,
    header: [],
    viewport: normalizeFullscreenViewport(renderAgentWorkspace(workspace, width, height), width, height),
    footer: [],
    forceFullRedraw: true,
    panelWidth: 0,
  };
}
