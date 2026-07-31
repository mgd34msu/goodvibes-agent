import type { AgentWorkspace } from '../input/agent-workspace.ts';
import type { CompositeRequest } from '../renderer/compositor.ts';
import { renderAgentWorkspace } from '../renderer/agent-workspace.ts';
import { type Line, createEmptyLine } from '@pellux/goodvibes-sdk/platform/types';

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

export function createFullscreenCompositeFromLines(
  lines: readonly Line[],
  width: number,
  height: number,
): CompositeRequest {
  return {
    width,
    height,
    header: [],
    viewport: normalizeFullscreenViewport(lines, width, height),
    footer: [],
    forceFullRedraw: true,
  };
}

export function createAgentWorkspaceFullscreenComposite(
  workspace: AgentWorkspace,
  width: number,
  height: number,
): CompositeRequest {
  // Mirror disk state on every repaint of the workspace panel so the
  // memory count and routine start counts never show a stale point-in-time
  // snapshot from the last workspace action (e.g. an external delete, or a
  // routine started from another shell/CLI invocation).
  workspace.syncLiveCountersForRender();
  return createFullscreenCompositeFromLines(renderAgentWorkspace(workspace, width, height), width, height);
}
