import type { AutomationJob } from '@pellux/goodvibes-sdk/platform/automation';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../agent-workspace-snapshot.ts';
import { WORK_PLAN_STATUSES, type WorkPlanItemStatus } from '../../work-plans/work-plan-store.ts';

type StatusCounts = Record<WorkPlanItemStatus, number>;

function countReady<T extends { readonly status: string }>(items: readonly T[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

function workPlanCounts(ctx: CommandContext): { readonly total: number; readonly counts: StatusCounts } {
  const counts = Object.fromEntries(WORK_PLAN_STATUSES.map((status) => [status, 0])) as StatusCounts;
  try {
    const items = ctx.workspace?.workPlanStore?.listItems?.() ?? [];
    for (const item of items) {
      counts[item.status] += 1;
    }
    return { total: items.length, counts };
  } catch {
    return { total: 0, counts };
  }
}

function automationJobs(ctx: CommandContext): readonly AutomationJob[] {
  try {
    return ctx.ops?.automationManager?.listJobs?.() ?? [];
  } catch {
    return [];
  }
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function formatWorkPlanLine(total: number, counts: StatusCounts): string {
  if (total === 0) return '  work plan: empty';
  const active = counts.pending + counts.in_progress + counts.blocked;
  return [
    `  work plan: ${plural(total, 'item')}`,
    `active ${active}`,
    `pending ${counts.pending}`,
    `in progress ${counts.in_progress}`,
    `blocked ${counts.blocked}`,
    `done ${counts.done}`,
  ].join('; ');
}

function formatWarnings(warnings: readonly string[]): readonly string[] {
  if (warnings.length === 0) return ['  warnings: none'];
  return ['  warnings:', ...warnings.slice(0, 4).map((warning) => `    - ${warning}`)];
}

export function formatAgentOperatorBriefing(ctx: CommandContext): string {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(ctx);
  const workPlan = workPlanCounts(ctx);
  const jobs = automationJobs(ctx);
  const enabledJobs = jobs.filter((job) => job.enabled).length;
  const setupReady = countReady(snapshot.setupChecklist, 'ready');
  const setupRecommended = countReady(snapshot.setupChecklist, 'recommended');
  const setupBlocked = countReady(snapshot.setupChecklist, 'blocked');
  const readyChannels = snapshot.channels.filter((channel) => channel.ready).length;
  const enabledChannels = snapshot.channels.filter((channel) => channel.enabled).length;

  const nextActions = [
    snapshot.provider === 'unknown' || snapshot.model === 'unknown'
      ? 'Choose the assistant model with /model.'
      : '',
    snapshot.localMemoryCount === 0
      ? 'Store durable non-secret facts with /memory add or the Agent workspace memory form.'
      : snapshot.localMemoryReviewQueueCount > 0
        ? `Review ${plural(snapshot.localMemoryReviewQueueCount, 'memory record')} with /memory queue.`
        : '',
    snapshot.localSkillCount === 0 && snapshot.localSkillBundleCount === 0
      ? 'Create reusable procedures with /agent-skills create or import reviewed skill files.'
      : snapshot.activeSkillCount === 0
        ? 'Enable reviewed skills or bundles with /agent-skills enabled and /agent-skills bundle enabled.'
        : '',
    snapshot.localRoutineCount === 0
      ? 'Create repeatable workflows with /routines create; promote schedules only with explicit confirmation.'
      : snapshot.enabledRoutineCount === 0
        ? 'Enable reviewed routines with /routines enable.'
        : '',
    'Use /knowledge status, /knowledge search, and explicit ingest forms for Agent Knowledge only.',
    'Use /delegate only for explicit build, fix, implementation, or review handoff to GoodVibes TUI.',
  ].filter((line): line is string => line.length > 0);

  return [
    'Agent Briefing',
    `  chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`,
    `  session: ${snapshot.sessionId}`,
    `  profile: ${snapshot.activeRuntimeProfile}`,
    `  policy: ${snapshot.executionPolicy}; WRFC ${snapshot.wrfcPolicy}`,
    `  knowledge: ${snapshot.knowledgeRoute} (${snapshot.knowledgeIsolation}; no fallback)`,
    '',
    'Readiness',
    `  setup: ${setupReady}/${snapshot.setupChecklist.length} ready; ${setupRecommended} recommended; ${setupBlocked} blocked`,
    `  local memory: ${plural(snapshot.localMemoryCount, 'record')}; prompt-active ${snapshot.localMemoryPromptActiveCount}; review queue ${snapshot.localMemoryReviewQueueCount}`,
    `  personas: ${plural(snapshot.localPersonaCount, 'persona')}; active ${snapshot.activePersonaName}`,
    `  skills: ${snapshot.enabledSkillCount}/${snapshot.localSkillCount} enabled; bundles ${snapshot.enabledSkillBundleCount}/${snapshot.localSkillBundleCount}; active ${snapshot.activeSkillCount}`,
    `  routines: ${snapshot.enabledRoutineCount}/${snapshot.localRoutineCount} enabled`,
    `  channels: ${readyChannels}/${snapshot.channels.length} ready; ${enabledChannels} enabled`,
    `  voice/media: ${snapshot.voiceProviderCount} voice, ${snapshot.mediaProviderCount} media; browser surface ${snapshot.browserSurfaceEnabled ? 'enabled' : 'disabled'}`,
    formatWorkPlanLine(workPlan.total, workPlan.counts),
    `  schedules: ${enabledJobs}/${jobs.length} visible jobs enabled`,
    '',
    'Next Actions',
    ...nextActions.map((line) => `  - ${line}`),
    '',
    ...formatWarnings(snapshot.warnings),
  ].join('\n');
}

export function registerBriefRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'brief',
    aliases: ['briefing'],
    description: 'Show a concise Agent operator briefing and next actions',
    usage: '',
    argsHint: '',
    handler(_args, ctx) {
      ctx.print(formatAgentOperatorBriefing(ctx));
    },
  });
}
