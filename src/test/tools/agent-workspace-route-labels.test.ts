import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';

/**
 * Every user-facing route these modules emit must name surfaces that actually
 * exist. A route like "Agent Workspace -> Model Routing -> Check local
 * servers" pointed users (and the model relaying it) at a category and action
 * that were never registered, so following the instruction dead-ended. This
 * test resolves every emitted workspace path against the real registry:
 *
 *   - every `Agent Workspace -> <category label> [-> <action label>]`
 *     occurrence, wherever it appears (userRoute values, tuiMirrors arrays,
 *     prose inside template literals, ...), parsed by longest-match against
 *     the registry's own labels so trailing prose or annotations after the
 *     route do not hide a phantom;
 *   - `breadcrumb: '...'` literals, which carry the same
 *     `category [-> action]` path without the "Agent Workspace" prefix and
 *     must match it exactly.
 *
 * A renamed category, a renamed action, or an invented label fails the build
 * instead of shipping as a phantom route. Routes that are not
 * workspace-anchored (slash commands such as "/health", "Main conversation",
 * surface names, file paths) are outside the registry and are not resolved
 * here.
 */

const ROUTE_EMITTING_SOURCES = [
  'src/tools/agent-route-planner-candidates-setup.ts',
  'src/tools/agent-route-planner-candidates-surfaces.ts',
  'src/tools/agent-route-planner-candidates-work.ts',
  'src/tools/agent-harness-setup-handoffs.ts',
  'src/tools/agent-harness-setup-plan.ts',
  'src/tools/agent-harness-setup-connected-host.ts',
  'src/tools/agent-harness-connected-host-status.ts',
  'src/tools/agent-harness-personal-ops-records.ts',
  'src/agent/setup-wizard.ts',
  'src/input/agent-workspace-setup.ts',
  'src/input/commands/brief-runtime.ts',
  'src/tools/agent-harness-personal-ops-operations.ts',
  'src/tools/agent-harness-personal-ops-lanes.ts',
  'src/tools/agent-harness-personal-ops-provider-records.ts',
  'src/tools/agent-harness-personal-ops-provider-task-records.ts',
  'src/tools/agent-harness-document-ops.ts',
  'src/tools/agent-harness-browser-control.ts',
  'src/tools/agent-harness-vibe-health.ts',
  'src/tools/agent-harness-project-context.ts',
  'src/tools/agent-harness-delegation-posture.ts',
  'src/tools/agent-harness-agent-orchestration.ts',
  'src/shell/startup-wiring.ts',
  'src/renderer/session-picker-modal.ts',
  'src/renderer/profile-picker-modal.ts',
  'src/renderer/context-inspector.ts',
  'src/renderer/settings-modal.ts',
  'src/input/profile-picker-modal.ts',
  'src/input/settings-modal-subscriptions.ts',
  'src/input/commands/mcp-runtime.ts',
  'src/input/commands/tasks-runtime.ts',
  'src/input/commands/session-content.ts',
  'src/input/commands/security-runtime.ts',
  'src/input/commands/provider-accounts-runtime.ts',
  'src/input/commands/health-runtime.ts',
  'src/input/commands/experience-runtime.ts',
] as const;

/** Minimum route occurrences expected per file, so a regex or refactor that stops matching fails loudly instead of passing on zero data. */
const MINIMUM_ROUTE_LITERALS: Readonly<Record<(typeof ROUTE_EMITTING_SOURCES)[number], number>> = {
  'src/tools/agent-route-planner-candidates-setup.ts': 14,
  'src/tools/agent-route-planner-candidates-surfaces.ts': 9,
  'src/tools/agent-route-planner-candidates-work.ts': 6,
  'src/tools/agent-harness-setup-handoffs.ts': 4,
  'src/tools/agent-harness-setup-plan.ts': 10,
  'src/tools/agent-harness-setup-connected-host.ts': 0,
  'src/tools/agent-harness-connected-host-status.ts': 1,
  'src/tools/agent-harness-personal-ops-records.ts': 6,
  'src/agent/setup-wizard.ts': 2,
  'src/input/agent-workspace-setup.ts': 10,
  'src/input/commands/brief-runtime.ts': 12,
  'src/tools/agent-harness-personal-ops-operations.ts': 15,
  'src/tools/agent-harness-personal-ops-lanes.ts': 7,
  'src/tools/agent-harness-personal-ops-provider-records.ts': 2,
  'src/tools/agent-harness-personal-ops-provider-task-records.ts': 2,
  'src/tools/agent-harness-document-ops.ts': 10,
  'src/tools/agent-harness-browser-control.ts': 3,
  'src/tools/agent-harness-vibe-health.ts': 2,
  'src/tools/agent-harness-project-context.ts': 1,
  'src/tools/agent-harness-delegation-posture.ts': 1,
  'src/tools/agent-harness-agent-orchestration.ts': 1,
  'src/shell/startup-wiring.ts': 2,
  'src/renderer/session-picker-modal.ts': 2,
  'src/renderer/profile-picker-modal.ts': 2,
  'src/renderer/context-inspector.ts': 0,
  'src/renderer/settings-modal.ts': 1,
  'src/input/profile-picker-modal.ts': 2,
  'src/input/settings-modal-subscriptions.ts': 3,
  'src/input/commands/mcp-runtime.ts': 3,
  'src/input/commands/tasks-runtime.ts': 1,
  'src/input/commands/session-content.ts': 1,
  'src/input/commands/security-runtime.ts': 1,
  'src/input/commands/provider-accounts-runtime.ts': 1,
  'src/input/commands/health-runtime.ts': 1,
  'src/input/commands/experience-runtime.ts': 1,
} as const;

const WORKSPACE_ROUTE_PREFIX = 'Agent Workspace -> ';
const SEGMENT_SEPARATOR = ' -> ';
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** Category labels, longest first, so "Tools & MCP" wins over any shorter overlap. */
const CATEGORY_LABELS_LONGEST_FIRST = [...AGENT_WORKSPACE_CATEGORIES]
  .map((category) => category.label)
  .sort((left, right) => right.length - left.length);

interface RouteOccurrence {
  readonly file: string;
  readonly line: number;
  /** Bounded snippet starting at the route, for failure messages. */
  readonly snippet: string;
  /** Text starting at the category label. */
  readonly rest: string;
  /** Breadcrumbs must consume their whole literal; inline routes may trail prose. */
  readonly exact: boolean;
}

function extractRouteOccurrences(file: string): readonly RouteOccurrence[] {
  const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
  const occurrences: RouteOccurrence[] = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (let at = line.indexOf(WORKSPACE_ROUTE_PREFIX); at !== -1; at = line.indexOf(WORKSPACE_ROUTE_PREFIX, at + 1)) {
      const rest = line.slice(at + WORKSPACE_ROUTE_PREFIX.length);
      occurrences.push({ file, line: index + 1, snippet: line.slice(at, at + 80), rest, exact: false });
    }
    const breadcrumbPattern = /breadcrumb: '([^']+)'/g;
    for (let match = breadcrumbPattern.exec(line); match !== null; match = breadcrumbPattern.exec(line)) {
      const literal = match[1] ?? '';
      occurrences.push({ file, line: index + 1, snippet: literal, rest: literal, exact: true });
    }
  }
  return occurrences;
}

/** True when the label sits at the start of `text` and is not immediately extended by more of the same segment kind. */
function matchesLabelPrefix(text: string, label: string): boolean {
  if (!text.startsWith(label)) return false;
  const next = text.slice(label.length);
  // The label must end the segment: either nothing follows, a separator into
  // the next segment, or anything that is clearly not a longer label ("; /cmd",
  // quote, period, prose). Longest-first candidate ordering already prevents a
  // shorter label from shadowing a longer registered one.
  return next.length === 0 || !/^[a-z0-9]/i.test(next[0] ?? '') || next.startsWith(SEGMENT_SEPARATOR);
}

function resolveOccurrence(occurrence: RouteOccurrence): string | null {
  const categoryLabel = CATEGORY_LABELS_LONGEST_FIRST.find((label) => matchesLabelPrefix(occurrence.rest, label));
  if (categoryLabel === undefined) {
    return `no registered workspace category label starts this route (known: ${CATEGORY_LABELS_LONGEST_FIRST.join(', ')})`;
  }
  const category = AGENT_WORKSPACE_CATEGORIES.find((entry) => entry.label === categoryLabel);
  if (!category) return `internal: category lookup failed for ${JSON.stringify(categoryLabel)}`;
  const afterCategory = occurrence.rest.slice(categoryLabel.length);
  if (!afterCategory.startsWith(SEGMENT_SEPARATOR)) {
    if (occurrence.exact && afterCategory.length > 0) {
      return `breadcrumb continues past category ${JSON.stringify(categoryLabel)} without a registered segment`;
    }
    return null;
  }
  const actionText = afterCategory.slice(SEGMENT_SEPARATOR.length);
  const actionLabels = [...category.actions].map((action) => action.label).sort((left, right) => right.length - left.length);
  const actionLabel = actionLabels.find((label) => matchesLabelPrefix(actionText, label));
  if (actionLabel === undefined) {
    return `category ${JSON.stringify(categoryLabel)} has no action starting this segment (known: ${actionLabels.join(', ')})`;
  }
  if (occurrence.exact && actionText.length > actionLabel.length) {
    return `breadcrumb continues past action ${JSON.stringify(actionLabel)}`;
  }
  return null;
}

describe('workspace route labels emitted to users', () => {
  for (const file of ROUTE_EMITTING_SOURCES) {
    test(`${file} emits only resolvable workspace routes`, () => {
      const occurrences = extractRouteOccurrences(file);
      expect(occurrences.length).toBeGreaterThanOrEqual(MINIMUM_ROUTE_LITERALS[file]);
      const failures: string[] = [];
      for (const occurrence of occurrences) {
        const failure = resolveOccurrence(occurrence);
        if (failure !== null) failures.push(`${occurrence.file}:${occurrence.line}: ${JSON.stringify(occurrence.snippet)}: ${failure}`);
      }
      expect(failures).toEqual([]);
    });
  }

  test('the extraction pattern still matches route occurrences at all', () => {
    const total = ROUTE_EMITTING_SOURCES.flatMap(extractRouteOccurrences).length;
    expect(total).toBeGreaterThanOrEqual(140);
  });
});
