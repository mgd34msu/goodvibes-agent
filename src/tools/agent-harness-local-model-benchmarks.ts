import type { ArtifactDescriptor } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { CommandContext } from '../input/command-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import { readArtifactStore } from './agent-harness-model-catalog.ts';
import { localStackFor } from './agent-harness-local-model-endpoints.ts';
import type { LocalModelBenchmarkEvidence, LocalModelBenchmarkPlan, LocalModelBenchmarkWinner, LocalModelRecipe } from './agent-harness-model-routing-types.ts';
import { readRecord, readString } from './agent-harness-model-routing-utils.ts';

export function isLocalModelBenchmarkArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose !== 'agent-model-compare') return false;
  if (readString(artifact.metadata.benchmarkKind) === 'local-model-route') return true;
  const promptPreview = readString(artifact.metadata.promptPreview).toLowerCase();
  return promptPreview.includes('local model benchmark') || promptPreview.includes('benchmark this local route');
}

export function isModelCompareJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  return readString(artifact.metadata.purpose) === 'agent-model-compare-judgment';
}

export function benchmarkCreatedAt(artifact: ArtifactDescriptor): string | null {
  const timestamp = typeof artifact.createdAt === 'number' ? artifact.createdAt : null;
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

export function describeLocalBenchmarkArtifact(artifact: ArtifactDescriptor): Record<string, unknown> {
  return {
    artifactId: artifact.id,
    ...(artifact.filename ? { filename: artifact.filename } : {}),
    createdAt: benchmarkCreatedAt(artifact),
    comparisonId: readString(artifact.metadata.comparisonId) || null,
    promptPreview: previewHarnessText(readString(artifact.metadata.promptPreview) || 'local model benchmark', 120),
    candidateCount: artifact.metadata.candidateCount ?? null,
    completedCandidates: artifact.metadata.completedCandidates ?? null,
    benchmarkKind: readString(artifact.metadata.benchmarkKind) || 'local-model-route',
    reviewRoute: `agent_model_compare review artifactId:"${artifact.id}"`,
    revealRoute: `agent_model_compare reveal artifactId:"${artifact.id}"`,
  };
}

export function describeLocalBenchmarkJudgment(artifact: ArtifactDescriptor): Record<string, unknown> {
  const winnerModel = readString(artifact.metadata.winnerModel);
  const sourceArtifactId = readString(artifact.metadata.sourceArtifactId);
  return {
    artifactId: artifact.id,
    ...(artifact.filename ? { filename: artifact.filename } : {}),
    createdAt: benchmarkCreatedAt(artifact),
    judgmentId: readString(artifact.metadata.judgmentId) || null,
    comparisonId: readString(artifact.metadata.comparisonId) || null,
    sourceArtifactId: sourceArtifactId || null,
    winnerBlindId: readString(artifact.metadata.winnerBlindId) || null,
    revealIncludedInJudgment: artifact.metadata.revealIncludedInJudgment === true,
    winnerModel: winnerModel || null,
    winnerStack: winnerModel ? localStackFor(winnerModel) : null,
    promptPreview: previewHarnessText(readString(artifact.metadata.promptPreview) || 'local model benchmark judgment', 120),
    analyticsRoute: 'agent_model_compare analytics benchmarkKind:"local-model-route" includeReasons:true',
    exportRoute: `agent_model_compare export artifactId:"${artifact.id}" confirm:true explicitUserRequest:"Export this local benchmark judgment."`,
    applyRoute: winnerModel
      ? `agent_model_compare apply artifactId:"${artifact.id}" confirm:true explicitUserRequest:"Apply this revealed local benchmark winner."`
      : null,
  };
}

export function localBenchmarkEvidence(
  comparisons: readonly ArtifactDescriptor[],
  judgments: readonly ArtifactDescriptor[],
  storeAvailable: boolean,
): LocalModelBenchmarkEvidence {
  if (!storeAvailable) {
    return {
      status: 'unavailable',
      comparisonCount: 0,
      completedCandidateCount: 0,
      revealedJudgmentCount: 0,
      hiddenJudgmentCount: 0,
      winnerStacks: [],
      winnerModels: [],
      summary: 'Artifact history is unavailable in this runtime.',
      confidence: 'estimated',
    };
  }
  const winnerModels: LocalModelBenchmarkWinner[] = [];
  let hiddenJudgmentCount = 0;
  for (const judgment of judgments) {
    const winnerModel = readString(judgment.metadata.winnerModel);
    if (!winnerModel) {
      hiddenJudgmentCount += 1;
      continue;
    }
    const sourceArtifactId = readString(judgment.metadata.sourceArtifactId);
    winnerModels.push({
      judgmentArtifactId: judgment.id,
      sourceArtifactId: sourceArtifactId || null,
      registryKey: winnerModel,
      stack: localStackFor(winnerModel),
      promptPreview: previewHarnessText(readString(judgment.metadata.promptPreview) || 'local model benchmark judgment', 120),
      reviewRoute: sourceArtifactId
        ? `agent_model_compare review artifactId:"${sourceArtifactId}"`
        : 'agent_model_compare review',
      exportRoute: `agent_model_compare export artifactId:"${judgment.id}" confirm:true explicitUserRequest:"Export this local benchmark judgment."`,
      applyRoute: `agent_model_compare apply artifactId:"${judgment.id}" confirm:true explicitUserRequest:"Apply this revealed local benchmark winner."`,
    });
  }
  const winnerStacks = [...new Set(winnerModels.map((winner) => winner.stack).filter((stack): stack is string => Boolean(stack)))].sort((a, b) => a.localeCompare(b));
  const completedCandidateCount = comparisons.reduce((total, artifact) => {
    const value = artifact.metadata.completedCandidates;
    return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
  const status: LocalModelBenchmarkEvidence['status'] = winnerModels.length > 0
    ? 'reviewed-winner'
    : comparisons.length > 0
      ? 'comparison-saved'
      : 'unmeasured';
  return {
    status,
    comparisonCount: comparisons.length,
    completedCandidateCount,
    revealedJudgmentCount: winnerModels.length,
    hiddenJudgmentCount,
    winnerStacks,
    winnerModels,
    summary: winnerModels.length > 0
      ? `Reviewed benchmark winner(s): ${winnerModels.map((winner) => winner.registryKey).join(', ')}.`
      : comparisons.length > 0
        ? 'Saved local benchmark comparison exists; save a revealed judgment before route recommendations.'
        : 'No saved local benchmark comparison has been recorded yet.',
    confidence: winnerModels.length > 0 ? 'measured' : 'estimated',
  };
}

export function localModelBenchmarkHistory(context: CommandContext, includeParameters: boolean): Record<string, unknown> {
  const store = readArtifactStore(context);
  if (!store?.list) {
    const evidence = localBenchmarkEvidence([], [], false);
    return {
      status: 'unavailable',
      count: 0,
      reason: 'Artifact history is unavailable in this runtime.',
      saveRoute: 'agent_model_compare run benchmarkKind:"local-model-route" taskType:"local-model-route" confirm:true explicitUserRequest:"..."',
      evidence,
    };
  }
  const allArtifacts = store.list(100);
  const artifacts = allArtifacts.filter(isLocalModelBenchmarkArtifact)
    .slice(0, includeParameters ? 10 : 3);
  const localComparisonIds = new Set(artifacts.map((artifact) => artifact.id));
  const judgments = allArtifacts
    .filter((artifact) => {
      if (!isModelCompareJudgmentArtifact(artifact)) return false;
      const sourceArtifactId = readString(artifact.metadata.sourceArtifactId);
      if (sourceArtifactId && localComparisonIds.has(sourceArtifactId)) return true;
      return readString(artifact.metadata.promptPreview).toLowerCase().includes('local model benchmark');
    })
    .slice(0, includeParameters ? 10 : 3);
  const evidence = localBenchmarkEvidence(artifacts, judgments, true);
  return {
    status: artifacts.length > 0 ? 'history-found' : 'no-history',
    count: artifacts.length,
    artifacts: artifacts.map(describeLocalBenchmarkArtifact),
    judgments: judgments.map(describeLocalBenchmarkJudgment),
    evidence,
    nextAction: artifacts.length > 0
      ? evidence.status === 'reviewed-winner'
        ? 'Use the revealed saved judgment as evidence only; apply/update still needs a separate confirmed user request.'
        : `Review saved local benchmark ${artifacts[0]!.id}, then save a revealed judgment before recommending any default-model change.`
      : 'Run the setupPlan benchmark prompt and save the comparison artifact before recommending any default-model change.',
    analyticsRoute: 'agent_model_compare analytics benchmarkKind:"local-model-route" includeReasons:true',
    saveRoute: 'agent_model_compare run benchmarkKind:"local-model-route" taskType:"local-model-route" confirm:true explicitUserRequest:"..."',
    policy: 'Benchmark history is read-only evidence. Route changes still require a separate revealed judgment and confirmed apply/update action.',
  };
}

export function localModelBenchmarkPlan(recipe: LocalModelRecipe): LocalModelBenchmarkPlan {
  return {
    status: 'plan-ready',
    prompt: [
      'Benchmark this local route on one practical task:',
      '1. summarize the current project goal in five bullets,',
      '2. identify one likely setup risk,',
      '3. propose one next action with a command or route.',
    ].join(' '),
    measurements: [
      'time to first useful token',
      'total response latency',
      'whether the answer followed the requested structure',
      'whether the model handled project-specific nouns without hallucinating',
      'whether the route supports the needed context window and tool workflow',
    ],
    workspaceActionRoute: 'agent_harness mode:"run_workspace_action" actionId:"account-run-local-model-benchmark" confirm:true fields.confirm:"yes" fields.modelRefs:"<local-route>,<baseline-route>" explicitUserRequest:"Compare this local model route before making it default."',
    compareRoute: `agent_model_compare run prompt:"local model benchmark: ${recipe.label}" benchmarkKind:"local-model-route" taskType:"local-model-route" confirm:true explicitUserRequest:"Compare this local model route before making it default."`,
    refreshRoute: 'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh model catalog, benchmarks, and token limits after local model setup."',
    notes: [
      'Use the workspace action when the user wants a form with benchmark defaults; use compareRoute when the model already has exact modelRefs.',
      'Run the same prompt against the local route and a baseline route before selecting a winner.',
      'Keep benchmark notes in the saved comparison artifact before changing the default model.',
      'Do not treat cached public benchmark scores as a substitute for this local latency and fit check.',
    ],
  };
}
