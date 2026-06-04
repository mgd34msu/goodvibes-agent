import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, relative } from 'node:path';
import { hasGoodVibesCommandHelp, listGoodVibesHelpTopics, renderGoodVibesCommandHelp, renderGoodVibesHelp } from './help.ts';
import { listBlockedGoodVibesCliCommandTokens, listGoodVibesCliCommands, listGoodVibesCliCommandTokens, parseGoodVibesCli } from './parser.ts';
import { renderAutocompletePackageText } from '../renderer/autocomplete-overlay.ts';
import { renderBookmarkModalPackageText } from '../renderer/bookmark-modal.ts';
import { renderContextInspectorPackageText } from '../renderer/context-inspector.ts';
import { renderFilePickerPackageText } from '../renderer/file-picker-overlay.ts';
import { renderHelpOverlayPackageText } from '../renderer/help-overlay.ts';
import { renderHistorySearchOverlayPackageText } from '../renderer/history-search-overlay.ts';
import { renderLiveTailModalPackageText } from '../renderer/live-tail-modal.ts';
import { renderMcpWorkspacePackageText } from '../renderer/mcp-workspace.ts';
import { renderModelPickerPackageText } from '../renderer/model-picker-overlay.ts';
import { renderModelWorkspacePackageText } from '../renderer/model-workspace.ts';
import { renderProcessModalPackageText } from '../renderer/process-modal.ts';
import { renderProfilePickerPackageText } from '../renderer/profile-picker-modal.ts';
import { renderSearchOverlayPackageText } from '../renderer/search-overlay.ts';
import { renderSessionPickerPackageText } from '../renderer/session-picker-modal.ts';
import { renderSelectionModalPackageText } from '../renderer/selection-modal-overlay.ts';
import { renderSettingsModalPackageText } from '../renderer/settings-modal.ts';
import { renderAgentWorkspacePackageText } from '../input/agent-workspace-categories.ts';
import { renderOnboardingWizardPackageText } from '../input/onboarding/onboarding-wizard.ts';
import { CommandRegistry } from '../input/command-registry.ts';
import { registerBuiltinCommands } from '../input/commands.ts';
import { AGENT_HARNESS_MODES } from '../tools/agent-harness-tool-schema.ts';
import { describeCliCommandPolicy, describeCommandPolicy } from '../tools/agent-harness-metadata.ts';

export interface PackageCliBinVerification {
  readonly command: 'goodvibes-agent';
  readonly target: string;
  readonly exists: boolean;
  readonly executable: boolean;
  readonly usesBunShebang: boolean;
  readonly hasSourceEntrypoint: boolean;
}

export interface PackageCliVerificationReport {
  readonly packageName: string;
  readonly version: string;
  readonly bins: readonly PackageCliBinVerification[];
  readonly tarball: {
    readonly entryCount: number;
    readonly unpackedSize: number;
    readonly requiredPathsPresent: readonly string[];
    readonly forbiddenPaths: readonly string[];
  };
  readonly packageFacingText: {
    readonly checkedPaths: readonly string[];
    readonly failures: readonly string[];
  };
  readonly issues: readonly string[];
}

const REQUIRED_BIN_COMMANDS = ['goodvibes-agent'] as const;
const BASE_REQUIRED_TARBALL_PATHS = [
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'package.json',
  'src/main.ts',
  'dist/package/main.js',
  'bin/goodvibes-agent.ts',
  'tsconfig.json',
  'release/release-notes.md',
  'release/performance-snapshot.json',
  'release/release-readiness.json',
  'release/live-verification/live-verification.json',
  'release/live-verification/live-verification.md',
] as const;
const REQUIRED_PACKAGE_FILE_ENTRIES = [
  'bin',
  'dist/package',
  'src',
  'LICENSE',
  'tsconfig.json',
  'README.md',
  'CHANGELOG.md',
  'docs/*.md',
  'release/release-notes.md',
  'release/performance-snapshot.json',
  'release/release-readiness.json',
  'release/live-verification/live-verification.json',
  'release/live-verification/live-verification.md',
] as const;
const REQUIRED_PACKAGE_FILE_EXCLUSIONS = [
  '!src/test',
  '!src/**/*.test.ts',
  '!src/**/__tests__',
  '!src/cli/package-verification.ts',
  '!src/verification',
] as const;
const REQUIRED_PACKAGE_SCRIPTS: Readonly<Record<string, string>> = {
  typecheck: 'bunx tsc --noEmit',
  'check:types': 'bun run typecheck',
  prebuild: 'bun run scripts/prebuild.ts',
  build: 'bun build src/main.ts --compile --outfile dist/goodvibes-agent',
  'build:package-runtime': 'bun run scripts/build-package-runtime.ts',
  'build:linux-x64': 'bun build src/main.ts --compile --target=bun-linux-x64 --outfile dist/goodvibes-agent-linux-x64',
  'build:linux-arm64': 'bun build src/main.ts --compile --target=bun-linux-arm64 --outfile dist/goodvibes-agent-linux-arm64',
  'build:macos-x64': 'bun build src/main.ts --compile --target=bun-darwin-x64 --outfile dist/goodvibes-agent-macos-x64',
  'build:macos-arm64': 'bun build src/main.ts --compile --target=bun-darwin-arm64 --outfile dist/goodvibes-agent-macos-arm64',
  'build:windows': 'bun build src/main.ts --compile --target=bun-windows-x64 --outfile dist/goodvibes-agent-windows.exe',
  'build:all-shell': 'bun run build:linux-x64 && bun run build:linux-arm64 && bun run build:macos-x64 && bun run build:macos-arm64 && bun run build:windows',
  test: 'bun run scripts/run-tests.ts',
  version: 'bun run scripts/prebuild.ts',
  release: 'bun run scripts/release.ts',
  'release:dry': 'bun run scripts/release.ts --dry-run',
  'publish:package': 'bun run scripts/publish-package.ts',
  'publish:dry-run': 'bun run scripts/publish-package.ts --dry-run',
  'publish:check': 'bun run scripts/publish-check.ts',
  'package:install-check': 'bun run scripts/package-install-check.ts',
  'architecture:check': 'bun run scripts/check-architecture.ts',
  'perf:check': 'bun run scripts/perf-check.ts',
  'ci:gate': 'bun run typecheck && bun run test && bun run architecture:check && bun run perf:check && bun run build && bun run publish:check && bun run package:install-check && bun run verification:ledger',
  'build:prod': 'bun run scripts/build.ts',
  'build:all': 'bun run scripts/build.ts --all',
  'verification:ledger': 'bun run scripts/verification-ledger.ts',
  'verification:live': 'bun run scripts/verify-live.ts',
};
const REQUIRED_CI_GATE_COMMANDS: readonly { readonly command: RegExp; readonly label: string }[] = [
  { command: /\bbun\s+(?:x\s+tsc\s+--noEmit|run\s+typecheck)\b/, label: 'typecheck' },
  { command: /\bbun\s+run\s+test\b/, label: 'bun run test' },
  { command: /\bbun\s+run\s+architecture:check\b/, label: 'architecture:check' },
  { command: /\bbun\s+run\s+perf:check\b/, label: 'perf:check' },
  { command: /\bbun\s+run\s+build\b(?!:)/, label: 'bun run build' },
  { command: /\bbun\s+run\s+scripts\/post-build-smoke\.ts\b/, label: 'compiled binary smoke' },
  { command: /\bbun\s+run\s+publish:check\b/, label: 'publish:check' },
  { command: /\bbun\s+run\s+package:install-check\b/, label: 'package:install-check' },
  { command: /\bbun\s+run\s+verification:ledger\b/, label: 'verification:ledger' },
];
const FORBIDDEN_TARBALL_PREFIXES = ['.github/', 'src/test/', 'src/.test/', 'src/verification/', 'src/daemon/', '.goodvibes/', 'vendor/'] as const;
const FORBIDDEN_TARBALL_DOCS = [
  ['docs/cloud', 'flare-batch.md'].join(''),
  ['docs/home', 'assistant-surface.md'].join(''),
  'docs/wrfc/',
] as const;
const FORBIDDEN_TARBALL_FILES = new Set([
  'src/panels/diff-panel.ts',
  'src/panels/file-explorer-panel.ts',
  'src/panels/file-preview-panel.ts',
  'src/cli/package-verification.ts',
  'src/panels/git-panel.ts',
  'src/panels/agent-inspector-panel.ts',
  'src/panels/agent-inspector-shared.ts',
  'src/panels/agent-logs-panel.ts',
  'src/panels/agent-logs-shared.ts',
  ['src/panels/', 'sandbox-panel.ts'].join(''),
  'src/panels/symbol-outline-panel.ts',
  'src/panels/worktree-panel.ts',
  'src/panels/wrfc-panel.ts',
  'src/input/commands/quit-shared.ts',
  'src/cli/service-command.ts',
  'src/cli/surface-command.ts',
  'src/tools/wrfc-agent-guard.ts',
  'src/renderer/agent-detail-modal.ts',
  'src/renderer/git-status.ts',
  'src/renderer/process-summary.ts',
]);
const BASE_PACKAGE_FACING_TEXT_PATHS = [
  'README.md',
  'CHANGELOG.md',
] as const;
const PACKAGE_FACING_FORBIDDEN_TEXT = [
  ['/api/', 'knowledge'].join(''),
  ['/api/home', 'assistant'].join(''),
  ['home', 'assistant.home', 'Graph'].join(''),
  ['include', 'AllSpaces'].join(''),
  ['knowledge', 'SpaceId'].join(''),
  ['@pellux/goodvibes-', 'tui'].join(''),
  ['@pellux/goodvibes-', 'daemon'].join(''),
  ['goodvibes-', 'daemon'].join(''),
  ['~/.goodvibes/', 'tui'].join(''),
  ['Home', ' Assistant'].join(''),
  ['Home', 'Graph'].join(''),
  ['Cloud', 'flare'].join(''),
  ['near', '-fork'].join(''),
  ['Optional ', 'Browser Access'].join(''),
  ['Optional ', 'Other-Device Access'].join(''),
  ['Optional ', 'Incoming Events'].join(''),
  ['Service ', '& Network'].join(''),
  ['Surfaces ', '& Integrations'].join(''),
  ['runtime', '-isolation'].join(''),
  ['goodvibes-agent', 'serve'].join(' '),
  ['goodvibes-agent', 'service'].join(' '),
  ['goodvibes-agent', 'services'].join(' '),
  ['goodvibes-agent', 'surfaces'].join(' '),
  ['goodvibes-agent', 'surface'].join(' '),
  ['goodvibes-agent', 'listener'].join(' '),
  ['goodvibes-agent', 'control-plane'].join(' '),
  ['goodvibes-agent', 'remote'].join(' '),
  ['goodvibes-agent', 'bridge'].join(' '),
  ['goodvibes-agent', 'web'].join(' '),
  ['goodvibes-agent', 'launch'].join(' '),
  ['goodvibes-agent', 'start'].join(' '),
  ['tui ', '[path]'].join(''),
  ['tui', '|launch'].join(''),
  ['tui', '|launch|start'].join(''),
  'Every plan must have a multi-agent execution strategy',
  'ALWAYS work in parallel when implementing a plan',
  'PRIMARY GOAL: Fully complete and functional code',
  'WRFC',
  'ReviewerReport',
  '"wrfcId"',
] as const;
const PACKAGE_FACING_REQUIRED_TEXT: readonly {
  readonly path: string;
  readonly required: readonly string[];
}[] = [
  { path: 'README.md', required: ['/api/goodvibes-agent/knowledge', 'bun add -g @pellux/goodvibes-agent'] },
  { path: 'docs/README.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/getting-started.md', required: ['/api/goodvibes-agent/knowledge', 'bun add -g @pellux/goodvibes-agent'] },
  { path: 'docs/connected-host.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/release-and-publishing.md', required: ['/api/goodvibes-agent/knowledge', 'bun add -g @pellux/goodvibes-agent'] },
];
const NON_COMMAND_ROUTE_ROOTS = new Set(['api']);
const HTTP_ROUTE_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const EXACT_SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const ALLOWED_PACKAGE_FACING_PACKAGE_NAMES = new Set([
  '@pellux/goodvibes-agent',
]);
const NON_BUN_INSTALL_COMMAND_PATTERN = /(?:^|[\s`])(?:npm\s+(?:install|i|exec)|npx|pnpm\s+(?:add|dlx|exec)|yarn\s+(?:add|global\s+add|dlx|exec))\b.*(?:@pellux\/goodvibes-agent|goodvibes-agent)/i;
const RELEASE_EVIDENCE_USER_SURFACE_PATTERNS: readonly RegExp[] = [
  /\buser[- ](?:facing|visible)\b[^\n]*(?:\brelease evidence\b|\brelease_evidence\b)/i,
  /(?:\brelease evidence\b|\brelease_evidence\b)[^\n]*\buser[- ](?:facing|visible)\b/i,
];
const HARNESS_USER_SURFACE_UMBRELLA_PATTERNS: readonly RegExp[] = [
  /\bagent_harness\b[^\n]*\buser[- ](?:facing|visible)\b[^\n]*\bharness (?:surface|route)s?\b/i,
  /\buser[- ](?:facing|visible)\b[^\n]*\bharness (?:surface|route)s?\b[^\n]*\bagent_harness\b/i,
];
const CLI_COMMANDS_WITHOUT_DETAILED_HELP = new Set(['tui', 'help', 'version']);
const CLI_TOKENS_WITHOUT_DETAILED_HELP = new Set(['help', 'version']);
const CLI_COMMANDS_HANDLED_OUTSIDE_MANAGEMENT = new Set(['tui', 'status', 'doctor', 'onboarding', 'help', 'version', 'completion']);
const CLI_COMMANDS_WITHOUT_TOP_LEVEL_HELP_ENTRY = new Set(['tui', 'tasks']);
const CLI_COMMANDS_ALLOWED_TYPE_ONLY = new Set(['unknown']);
const MODEL_TOOL_DESCRIPTION_MAX_LENGTH = 72;
const MODEL_TOOL_SCHEMA_DESCRIPTION_MAX_LENGTH = 72;
const RELEASE_READINESS_RELATIVE_PATH = 'release/release-readiness.json';
const RELEASE_NOTES_RELATIVE_PATH = 'release/release-notes.md';
const RELEASE_PERFORMANCE_SNAPSHOT_RELATIVE_PATH = 'release/performance-snapshot.json';
const RELEASE_LIVE_VERIFICATION_JSON_RELATIVE_PATH = 'release/live-verification/live-verification.json';
const RELEASE_LIVE_VERIFICATION_MARKDOWN_RELATIVE_PATH = 'release/live-verification/live-verification.md';
const RELEASE_READINESS_REQUIRED_IDS = [
  'operator-workspace-primary-surface',
  'first-run-onboarding',
  'provider-model-routing',
  'provider-account-posture',
  'isolated-agent-knowledge',
  'artifact-ingest-boundary',
  'local-memory-notes-personas',
  'skills-routines-behavior-library',
  'routine-schedule-promotion',
  'reminders-and-notifications',
  'channel-readiness-send',
  'companion-pairing',
  'approvals-and-automation-actions',
  'planning-workplan',
  'explicit-build-delegation',
  'mcp-tool-trust',
  'voice-tts-media',
  'conversation-session-artifacts',
  'support-auth-trust-bundles',
  'doctor-compat-status',
  'release-package-install',
  'live-release-evidence',
  'release-readiness-inventory-gate',
  'connected-host-channel-core',
  'connected-host-automation-runtime',
  'connected-host-operator-api',
  'connected-host-agent-knowledge-routes',
  'connected-host-media-routes',
  'connected-host-provider-accounts',
  'connected-host-pairing-realtime',
  'connected-host-cloud-batch',
  'additional-channel-adapter-matrix',
  'telephony-conversation-channel',
  'mobile-device-command-depth',
  'live-outcome-certification',
] as const;
const RELEASE_READINESS_OPERATOR_AUDIT_ITEM_IDS = new Set([
  'live-release-evidence',
  'release-readiness-inventory-gate',
  'live-outcome-certification',
]);
const RELEASE_READINESS_REQUIRED_QUALITY_DIMENSIONS = [
  'capabilityCoverage',
  'userAccess',
  'modelAccess',
  'safetyBoundary',
  'releaseEvidence',
] as const;
const RELEASE_LIVE_VERIFICATION_REQUIRED_CHECK_IDS = [
  'verification-ledger',
  'compiled-cli-present',
  'cli-version',
  'cli-status-json',
  'cli-compat-json',
  'cli-agent-knowledge-status',
  'cli-providers',
  'cli-doctor',
  'connected-host-status',
  'connected-host-health',
  'openai-compatible-models',
  'agent-knowledge-status',
  'agent-knowledge-ask-isolated',
  'agent-knowledge-search-isolated',
] as const;
const RELEASE_PERFORMANCE_REQUIRED_EXTRA_METRIC_NAMES = [
  'event.queue.depth',
  'tool.executor.overhead.p95',
  'compaction.latency.p95',
  'slo.turn_start.p95',
  'slo.cancel.p95',
  'slo.reconnect_recovery.p95',
  'slo.permission_decision.p95',
  'slo.integration.delivery_success_rate',
  'slo.integration.dlq_depth',
] as const;
const RELEASE_PERFORMANCE_BUDGETS: Record<typeof RELEASE_PERFORMANCE_REQUIRED_EXTRA_METRIC_NAMES[number], number> = {
  'event.queue.depth': 1000,
  'tool.executor.overhead.p95': 5,
  'compaction.latency.p95': 500,
  'slo.turn_start.p95': 2000,
  'slo.cancel.p95': 500,
  'slo.reconnect_recovery.p95': 10000,
  'slo.permission_decision.p95': 100,
  'slo.integration.delivery_success_rate': 95,
  'slo.integration.dlq_depth': 10,
};
const RELEASE_PERFORMANCE_HIGHER_IS_BETTER_METRICS = new Set<typeof RELEASE_PERFORMANCE_REQUIRED_EXTRA_METRIC_NAMES[number]>([
  'slo.integration.delivery_success_rate',
]);
const RELEASE_READINESS_ALLOWED_OWNERS = new Set(['agent', 'connected-host', 'companion', 'release']);
const RELEASE_READINESS_ALLOWED_STATUSES = new Set(['covered', 'gap', 'unknown']);
const RELEASE_READINESS_BLOCKER_STATUSES = new Set(['gap', 'unknown']);
const AGENT_HARNESS_MODE_SET = new Set<string>(AGENT_HARNESS_MODES);
const RELEASE_LIVE_VERIFICATION_MAX_AGE_DAYS = 7;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const RELEASE_READINESS_REQUIRED_SOURCE_IDS = [
  'release-surface-review',
  'runtime-contract-review',
  'goodvibes-agent',
  'goodvibes-connected-host',
  'goodvibes-companion',
] as const;

interface PackageFacingVersionPins {
  readonly packageVersion: string;
  readonly bunVersion: string;
}

interface PackageFacingTextSource {
  readonly path: string;
  readonly content: string;
  readonly sourceFunction?: string;
  readonly sourcePath?: string;
}

interface PackageFacingSlashCommandCatalog {
  readonly names: ReadonlySet<string>;
  readonly textSources: readonly PackageFacingTextSource[];
  readonly failures: readonly string[];
}

interface PackageFacingCliCommandCatalog {
  readonly supportedTokens: ReadonlySet<string>;
  readonly blockedTokens: ReadonlySet<string>;
  readonly failures: readonly string[];
}

function matchesForbiddenPrefix(path: string, prefix: string): boolean {
  const directory = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === directory || path.startsWith(prefix);
}

export function isForbiddenPackageTarballPath(path: string): boolean {
  if (FORBIDDEN_TARBALL_PREFIXES.some((prefix) => matchesForbiddenPrefix(path, prefix))) return true;
  if (path.endsWith('.test.ts')) return true;
  if (path.includes('/__tests__/') || path.endsWith('/__tests__')) return true;
  if (FORBIDDEN_TARBALL_FILES.has(path)) return true;
  return FORBIDDEN_TARBALL_DOCS.some((docPath) => {
    if (docPath.endsWith('/')) return matchesForbiddenPrefix(path, docPath);
    return path === docPath || path.startsWith(docPath);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPackageJson(root: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as unknown;
  if (!isRecord(parsed)) throw new Error('package.json must contain a JSON object.');
  return parsed;
}

export function isExactSemver(value: string): boolean {
  return EXACT_SEMVER_PATTERN.test(value);
}

function readTopChangelogRelease(root: string): { readonly version: string; readonly date: string } | null {
  const changelogPath = join(root, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) return null;
  const changelog = readFileSync(changelogPath, 'utf-8');
  const heading = changelog.split(/\r?\n/).find((line) => line.startsWith('## '));
  if (!heading) return null;
  const match = /^##\s+([0-9]+\.[0-9]+\.[0-9]+)\s+-\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s*$/.exec(heading);
  return match ? { version: match[1]!, date: match[2]! } : null;
}

export function packageDocPaths(root: string): readonly string[] {
  const docsPath = join(root, 'docs');
  if (!existsSync(docsPath)) return [];
  return readdirSync(docsPath)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `docs/${entry}`)
    .sort();
}

export function requiredTarballPaths(root: string): readonly string[] {
  return [...BASE_REQUIRED_TARBALL_PATHS, ...packageDocPaths(root)];
}

function packageFacingTextPaths(root: string): readonly string[] {
  return [...BASE_PACKAGE_FACING_TEXT_PATHS, ...packageDocPaths(root)];
}

function packageFacingCliHelpTextSources(): readonly PackageFacingTextSource[] {
  return [
    { path: 'cli:help', content: renderGoodVibesHelp() },
    ...listGoodVibesHelpTopics().map((topic) => ({
      path: `cli:help:${topic}`,
      content: renderGoodVibesCommandHelp(topic),
    })),
    {
      path: 'tui:autocomplete-overlay',
      content: renderAutocompletePackageText(),
      sourcePath: 'src/renderer/autocomplete-overlay.ts',
      sourceFunction: 'renderAutocompletePackageText',
    },
    {
      path: 'tui:bookmark-modal',
      content: renderBookmarkModalPackageText(),
      sourcePath: 'src/renderer/bookmark-modal.ts',
      sourceFunction: 'renderBookmarkModalPackageText',
    },
    {
      path: 'tui:context-inspector',
      content: renderContextInspectorPackageText(),
      sourcePath: 'src/renderer/context-inspector.ts',
      sourceFunction: 'renderContextInspectorPackageText',
    },
    {
      path: 'tui:file-picker',
      content: renderFilePickerPackageText(),
      sourcePath: 'src/renderer/file-picker-overlay.ts',
      sourceFunction: 'renderFilePickerPackageText',
    },
    {
      path: 'tui:help-overlay',
      content: renderHelpOverlayPackageText(),
      sourcePath: 'src/renderer/help-overlay.ts',
      sourceFunction: 'renderHelpOverlayPackageText',
    },
    {
      path: 'tui:history-search-overlay',
      content: renderHistorySearchOverlayPackageText(),
      sourcePath: 'src/renderer/history-search-overlay.ts',
      sourceFunction: 'renderHistorySearchOverlayPackageText',
    },
    {
      path: 'tui:live-tail-modal',
      content: renderLiveTailModalPackageText(),
      sourcePath: 'src/renderer/live-tail-modal.ts',
      sourceFunction: 'renderLiveTailModalPackageText',
    },
    {
      path: 'tui:mcp-workspace',
      content: renderMcpWorkspacePackageText(),
      sourcePath: 'src/renderer/mcp-workspace.ts',
      sourceFunction: 'renderMcpWorkspacePackageText',
    },
    {
      path: 'tui:model-picker',
      content: renderModelPickerPackageText(),
      sourcePath: 'src/renderer/model-picker-overlay.ts',
      sourceFunction: 'renderModelPickerPackageText',
    },
    {
      path: 'tui:model-workspace',
      content: renderModelWorkspacePackageText(),
      sourcePath: 'src/renderer/model-workspace.ts',
      sourceFunction: 'renderModelWorkspacePackageText',
    },
    {
      path: 'tui:onboarding-wizard',
      content: renderOnboardingWizardPackageText(),
      sourcePath: 'src/input/onboarding/onboarding-wizard.ts',
      sourceFunction: 'renderOnboardingWizardPackageText',
    },
    {
      path: 'tui:process-modal',
      content: renderProcessModalPackageText(),
      sourcePath: 'src/renderer/process-modal.ts',
      sourceFunction: 'renderProcessModalPackageText',
    },
    {
      path: 'tui:profile-picker',
      content: renderProfilePickerPackageText(),
      sourcePath: 'src/renderer/profile-picker-modal.ts',
      sourceFunction: 'renderProfilePickerPackageText',
    },
    {
      path: 'tui:search-overlay',
      content: renderSearchOverlayPackageText(),
      sourcePath: 'src/renderer/search-overlay.ts',
      sourceFunction: 'renderSearchOverlayPackageText',
    },
    {
      path: 'tui:selection-modal',
      content: renderSelectionModalPackageText(),
      sourcePath: 'src/renderer/selection-modal-overlay.ts',
      sourceFunction: 'renderSelectionModalPackageText',
    },
    {
      path: 'tui:session-picker',
      content: renderSessionPickerPackageText(),
      sourcePath: 'src/renderer/session-picker-modal.ts',
      sourceFunction: 'renderSessionPickerPackageText',
    },
    {
      path: 'tui:settings-modal',
      content: renderSettingsModalPackageText(),
      sourcePath: 'src/renderer/settings-modal.ts',
      sourceFunction: 'renderSettingsModalPackageText',
    },
    {
      path: 'tui:agent-workspace',
      content: renderAgentWorkspacePackageText(),
      sourcePath: 'src/input/agent-workspace-categories.ts',
      sourceFunction: 'renderAgentWorkspacePackageText',
    },
  ];
}

interface PackageTextExport {
  readonly path: string;
  readonly functionName: string;
}

const PACKAGE_TEXT_EXPORT_ROOTS = ['src/renderer', 'src/input'] as const;

function packageTextSourceFiles(root: string): readonly { readonly path: string; readonly absolutePath: string }[] {
  return PACKAGE_TEXT_EXPORT_ROOTS.flatMap((relativeRoot) => {
    const absoluteRoot = join(root, relativeRoot);
    if (!existsSync(absoluteRoot)) return [];
    return listFilesUnder(absoluteRoot)
      .filter((path) => path.endsWith('.ts'))
      .map((absolutePath) => ({
        absolutePath,
        path: `${relativeRoot}/${absolutePath.slice(absoluteRoot.length + 1).replace(/\\/g, '/')}`,
      }));
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function isStandalonePackageTextExport(functionName: string): boolean {
  return !functionName.endsWith('StatePackageText');
}

function packageTextExports(root: string): readonly PackageTextExport[] {
  return packageTextSourceFiles(root)
    .flatMap(({ path, absolutePath }) => {
      const content = readFileSync(absolutePath, 'utf-8');
      return [...content.matchAll(/\bexport\s+function\s+(render[A-Za-z0-9]+PackageText)\s*\(/g)].map((match) => ({
        path,
        functionName: match[1] ?? '',
      }));
    })
    .filter((source) => isStandalonePackageTextExport(source.functionName))
    .sort((left, right) => `${left.path}#${left.functionName}`.localeCompare(`${right.path}#${right.functionName}`));
}

function packageTextExportKey(source: PackageTextExport): string {
  return `${source.path}#${source.functionName}`;
}

function verifyPackageTextSourceCoverage(root: string, sources: readonly PackageFacingTextSource[]): readonly string[] {
  const failures: string[] = [];
  const exports = packageTextExports(root);
  const exportKeys = new Set(exports.map(packageTextExportKey));
  const registeredKeys = new Set(
    sources
      .filter((source) => source.sourcePath && source.sourceFunction)
      .map((source) => `${source.sourcePath}#${source.sourceFunction}`),
  );

  for (const key of registeredKeys) {
    if (!exportKeys.has(key)) {
      failures.push(`registered package-facing text source references missing export: ${key}`);
    }
  }
  for (const source of exports) {
    const key = packageTextExportKey(source);
    if (!registeredKeys.has(key)) {
      failures.push(`package-facing text source is not registered: ${key}`);
    }
  }
  return failures;
}

function managementHandledCliCommands(root: string): ReadonlySet<string> {
  const managementPath = join(root, 'src', 'cli', 'management.ts');
  if (!existsSync(managementPath)) return new Set();
  const source = readFileSync(managementPath, 'utf-8');
  return new Set([...source.matchAll(/\bcase\s+['"]([a-z][a-z0-9-]*)['"]\s*:/g)].map((match) => match[1] ?? ''));
}

function declaredCliCommandTypes(root: string): ReadonlySet<string> {
  const typesPath = join(root, 'src', 'cli', 'types.ts');
  if (!existsSync(typesPath)) return new Set();
  const source = readFileSync(typesPath, 'utf-8');
  const match = /export\s+type\s+GoodVibesCliCommand\s*=([\s\S]*?);/.exec(source);
  if (!match) return new Set();
  return new Set([...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1] ?? ''));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mainHelpMentionsCommand(help: string, command: string): boolean {
  return new RegExp(`(^|[^a-z0-9-])${escapeRegExp(command)}($|[^a-z0-9-])`, 'i').test(help);
}

function buildPackageFacingCliCommandCatalog(root: string): PackageFacingCliCommandCatalog {
  const supportedTokens = new Set(listGoodVibesCliCommandTokens());
  const blockedTokens = new Set(listBlockedGoodVibesCliCommandTokens());
  const canonicalCommands: readonly string[] = listGoodVibesCliCommands().filter((command) => command !== 'unknown');
  const declaredCommands = declaredCliCommandTypes(root);
  const managementCommands = managementHandledCliCommands(root);
  const mainHelp = renderGoodVibesHelp();
  const failures: string[] = [];
  if (supportedTokens.size === 0) {
    failures.push('package-facing CLI command lint could not discover any parser command tokens.');
  }
  if (declaredCommands.size === 0) {
    failures.push('package-facing CLI command lint could not discover GoodVibesCliCommand type literals.');
  }
  for (const command of declaredCommands) {
    if (!canonicalCommands.includes(command) && !CLI_COMMANDS_ALLOWED_TYPE_ONLY.has(command)) {
      failures.push(`package-facing CLI command type is declared but not parsed: ${command}`);
    }
  }
  for (const command of canonicalCommands) {
    if (!declaredCommands.has(command)) {
      failures.push(`package-facing CLI parser command is missing GoodVibesCliCommand type declaration: ${command}`);
    }
  }
  for (const token of blockedTokens) {
    if (supportedTokens.has(token)) {
      failures.push(`package-facing CLI command lint has conflicting supported and blocked command token: ${token}`);
    }
  }
  for (const topic of listGoodVibesHelpTopics()) {
    if (!supportedTokens.has(topic)) {
      failures.push(`package-facing CLI help topic is not a supported parser command token: ${topic}`);
    }
  }
  for (const token of supportedTokens) {
    if (!CLI_TOKENS_WITHOUT_DETAILED_HELP.has(token) && !hasGoodVibesCommandHelp(token)) {
      failures.push(`package-facing CLI parser token is missing detailed help alias coverage: ${token}`);
    }
  }
  for (const command of canonicalCommands) {
    if (!CLI_COMMANDS_WITHOUT_DETAILED_HELP.has(command) && !hasGoodVibesCommandHelp(command)) {
      failures.push(`package-facing CLI command is missing detailed help: ${command}`);
    }
    if (!CLI_COMMANDS_HANDLED_OUTSIDE_MANAGEMENT.has(command) && !managementCommands.has(command)) {
      failures.push(`package-facing CLI command is missing management handler coverage: ${command}`);
    }
    if (!CLI_COMMANDS_WITHOUT_TOP_LEVEL_HELP_ENTRY.has(command) && !mainHelpMentionsCommand(mainHelp, command)) {
      failures.push(`package-facing CLI command is missing top-level help coverage: ${command}`);
    }
  }
  return { supportedTokens, blockedTokens, failures };
}

function looksLikeShellEnvironmentPrefix(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return true;
  return /^([A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+$/.test(prefix);
}

function isCommandLikePrefix(prefix: string): boolean {
  const trimmedPrefix = prefix.trim();
  return trimmedPrefix.length === 0
    || trimmedPrefix === '-'
    || trimmedPrefix === '*'
    || /^[0-9]+\.$/.test(trimmedPrefix)
    || /[`"'(]\s*$/.test(prefix)
    || looksLikeShellEnvironmentPrefix(prefix);
}

function stripTrailingCommandPunctuation(value: string): string {
  return value.replace(/[),.;:]+$/g, '');
}

function shellTokenizeCommandSnippet(snippet: string): readonly string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < snippet.length; index += 1) {
    const char = snippet[index] ?? '';
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(stripTrailingCommandPunctuation(current));
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped || quote !== null) return null;
  if (current.length > 0) tokens.push(stripTrailingCommandPunctuation(current));
  return tokens.filter((token) => token.length > 0);
}

function candidateCommandSnippetEnd(line: string, startIndex: number): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = startIndex; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '`') return index;
    if (/\s/.test(char)) {
      const rest = line.slice(index);
      const descriptionColumn = /^ {2,}[A-Z]/.test(rest);
      if (descriptionColumn) return index;
    }
  }
  return line.length;
}

function packageFacingCliCommandSnippets(line: string): readonly string[] {
  const snippets: string[] = [];
  const commandPattern = /goodvibes-agent(?:$|\s+)/g;
  for (let match = commandPattern.exec(line); match !== null; match = commandPattern.exec(line)) {
    const prefix = line.slice(0, match.index);
    if (!isCommandLikePrefix(prefix)) continue;
    const endIndex = candidateCommandSnippetEnd(line, match.index);
    const snippet = line.slice(match.index, endIndex).trim();
    if (snippet.length > 0) snippets.push(snippet);
  }
  return snippets;
}

function verifyPackageFacingCliCommandMentions(path: string, content: string, cliCommands: PackageFacingCliCommandCatalog): readonly string[] {
  const failures: string[] = [];
  const lines = content.split(/\r?\n/);
  const commandPattern = /goodvibes-agent\s+([a-z][a-z0-9-]*)(?=$|[\s`.,;:)\]])/g;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    for (const snippet of packageFacingCliCommandSnippets(line)) {
      const tokens = shellTokenizeCommandSnippet(snippet);
      if (tokens === null) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} has an unparseable Agent CLI command snippet: ${snippet}`);
        continue;
      }
      const binaryIndex = tokens.indexOf('goodvibes-agent');
      if (binaryIndex < 0) continue;
      const parsed = parseGoodVibesCli(tokens.slice(binaryIndex + 1), 'goodvibes-agent');
      for (const error of parsed.errors) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} has invalid Agent CLI command snippet "${snippet}": ${error}`);
      }
    }
    commandPattern.lastIndex = 0;
    for (let match = commandPattern.exec(line); match !== null; match = commandPattern.exec(line)) {
      const token = match[1] ?? '';
      const prefix = line.slice(0, match.index);
      if (!isCommandLikePrefix(prefix)) continue;
      if (cliCommands.blockedTokens.has(token)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} mentions blocked Agent CLI command: goodvibes-agent ${token}`);
        continue;
      }
      if (!cliCommands.supportedTokens.has(token)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} references unknown Agent CLI command: goodvibes-agent ${token}`);
      }
    }
  }
  return failures;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizedPackageFileEntry(entry: string): string {
  return normalize(entry).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function packageManifestPositiveEntryCoversPath(entry: string, path: string): boolean {
  if (entry.startsWith('!')) return false;
  const normalizedEntry = normalizedPackageFileEntry(entry);
  if (normalizedEntry.length === 0) return false;
  if (normalizedEntry.endsWith('/*.md')) {
    const directory = normalizedEntry.slice(0, -'/*.md'.length);
    const relativePath = path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : '';
    return relativePath.length > 0 && !relativePath.includes('/') && relativePath.endsWith('.md');
  }
  return path === normalizedEntry || path.startsWith(`${normalizedEntry}/`);
}

function existingForbiddenPackagePathsCoveredByManifest(root: string, files: readonly string[]): readonly string[] {
  const forbiddenCandidates = [
    ...FORBIDDEN_TARBALL_PREFIXES,
    ...FORBIDDEN_TARBALL_DOCS,
    ...FORBIDDEN_TARBALL_FILES,
  ].map(normalizedPackageFileEntry);
  return [...new Set(forbiddenCandidates)]
    .filter((path) => existsSync(join(root, path)))
    .filter((path) => files.some((entry) => packageManifestPositiveEntryCoversPath(entry, path)))
    .sort();
}

function verifyPackageFilesManifest(root: string, files: readonly string[]): readonly string[] {
  const issues: string[] = [];
  for (const requiredFile of REQUIRED_PACKAGE_FILE_ENTRIES) {
    if (!files.includes(requiredFile)) {
      issues.push(`package.json files must include ${requiredFile}.`);
    }
  }
  for (const excludedFile of REQUIRED_PACKAGE_FILE_EXCLUSIONS) {
    if (!files.includes(excludedFile)) {
      issues.push(`package.json files must exclude ${excludedFile}.`);
    }
  }
  for (const entry of files) {
    if (entry.startsWith('!')) continue;
    const normalizedEntry = normalizedPackageFileEntry(entry);
    if (isForbiddenPackageTarballPath(normalizedEntry)) {
      issues.push(`package.json files must not include forbidden Agent package path: ${entry}.`);
    }
  }
  for (const path of existingForbiddenPackagePathsCoveredByManifest(root, files)) {
    const exclusion = `!${path}`;
    if (!files.includes(exclusion)) {
      issues.push(`package.json files must exclude existing forbidden Agent package path covered by broad includes: ${exclusion}.`);
    }
  }
  return issues;
}

function verifyPackageScripts(scripts: Record<string, string>): readonly string[] {
  const issues: string[] = [];
  for (const [name, expected] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
    const actual = scripts[name];
    if (actual !== expected) {
      issues.push(`package.json script ${name} must be "${expected}".`);
    }
  }
  return issues;
}

function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readPackageManagerBunVersion(pkg: Record<string, unknown>): string {
  const packageManager = readStringValue(pkg.packageManager);
  const match = /^bun@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(packageManager);
  return match?.[1] ?? '';
}

function readGithubSetupBunVersion(root: string): string | null {
  const setupActionPath = join(root, '.github', 'actions', 'setup', 'action.yml');
  if (!existsSync(setupActionPath)) return null;
  const source = readFileSync(setupActionPath, 'utf-8');
  const match = /^\s*bun-version:\s*"?([^"\s]+)"?\s*$/m.exec(source);
  return match?.[1] ?? '';
}

function isStableReleaseLine(version: string): boolean {
  if (!isExactSemver(version)) return false;
  const [major] = version.split('.').map((part) => Number(part));
  return Number.isInteger(major) && major >= 1;
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) result[key] = entry;
  }
  return result;
}

function calculateP95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function readFiniteNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseDateOnlyUtc(value: string): Date | null {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function verifyReleaseLiveVerificationFreshness(
  generatedAt: Date,
  readinessCheckedAt: Date | null,
  now = new Date(),
): readonly string[] {
  const issues: string[] = [];
  if (readinessCheckedAt !== null && generatedAt.getTime() < readinessCheckedAt.getTime()) {
    issues.push(`release live verification report must not predate readiness inventory checkedAt ${readinessCheckedAt.toISOString().slice(0, 10)}.`);
  }
  const ageDays = Math.floor((now.getTime() - generatedAt.getTime()) / DAY_MILLISECONDS);
  if (ageDays > RELEASE_LIVE_VERIFICATION_MAX_AGE_DAYS) {
    issues.push(`release live verification report is stale: generatedAt is ${ageDays} day(s) old; rerun strict live verification.`);
  }
  if (generatedAt.getTime() - now.getTime() > DAY_MILLISECONDS) {
    issues.push('release live verification report generatedAt is more than one day in the future.');
  }
  return issues;
}

function verifyNoLiveVerificationLocalPathLeaks(root: string, jsonSource: string, markdownSource: string): readonly string[] {
  const combined = `${jsonSource}\n${markdownSource}`;
  const markers = [
    { marker: normalize(root), label: 'project root' },
    { marker: homedir(), label: 'home directory' },
    { marker: '/home/', label: 'Unix home path' },
    { marker: '/Users/', label: 'macOS user path' },
    { marker: '\\Users\\', label: 'Windows user path' },
  ] as const;
  const issues: string[] = [];
  for (const { marker, label } of markers) {
    if (marker.length > 1 && combined.includes(marker)) {
      issues.push(`release live verification artifacts must redact local ${label}: ${marker}.`);
    }
  }
  if (/\b(?:10|192\.168|172\.(?:1[6-9]|2[0-9]|3[0-1]))(?:\.[0-9]{1,3}){2}\b/.test(combined)) {
    issues.push('release live verification artifacts must redact private network addresses.');
  }
  return issues;
}

function verifyReleaseLiveVerificationMarkdownConsistency(
  markdown: string,
  generatedAt: string,
  counts: Record<string, number>,
): readonly string[] {
  if (markdown.trim().length === 0) return [];
  const issues: string[] = [];
  if (!markdown.includes('# GoodVibes Agent Live Verification')) {
    issues.push('release live verification Markdown report must keep the GoodVibes Agent title.');
  }
  if (generatedAt.length > 0 && !markdown.includes(`Generated: ${generatedAt}`)) {
    issues.push('release live verification Markdown report generated timestamp must match JSON generatedAt.');
  }
  for (const status of ['pass', 'warn', 'fail', 'skip'] as const) {
    const count = counts[status] ?? 0;
    if (!markdown.includes(`| ${status} | ${count} |`)) {
      issues.push(`release live verification Markdown report ${status} count must match JSON counts.${status}.`);
    }
  }
  return issues;
}

function verifyNoReleaseReadinessLocalEvidenceLeaks(root: string, source: string): readonly string[] {
  const markers = [
    { marker: normalize(root), label: 'project root' },
    { marker: homedir(), label: 'home directory' },
    { marker: '../', label: 'sibling checkout path' },
    { marker: '/home/', label: 'Unix home path' },
    { marker: '/Users/', label: 'macOS user path' },
    { marker: '\\Users\\', label: 'Windows user path' },
  ] as const;
  const issues: string[] = [];
  for (const { marker, label } of markers) {
    if (marker.length > 1 && source.includes(marker)) {
      issues.push(`release readiness inventory evidence must not depend on local ${label}: ${marker}.`);
    }
  }
  if (/\b(?:10|192\.168|172\.(?:1[6-9]|2[0-9]|3[0-1]))(?:\.[0-9]{1,3}){2}\b/.test(source)) {
    issues.push('release readiness inventory evidence must not include private network addresses.');
  }
  return issues;
}

function verifyReleasePerformanceSnapshotPolicy(root: string): readonly string[] {
  const snapshotPath = join(root, RELEASE_PERFORMANCE_SNAPSHOT_RELATIVE_PATH);
  if (!existsSync(snapshotPath)) {
    return [`release performance snapshot is missing: ${RELEASE_PERFORMANCE_SNAPSHOT_RELATIVE_PATH}.`];
  }

  const issues: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`release performance snapshot is invalid JSON: ${message}`];
  }
  if (!isRecord(parsed)) {
    return ['release performance snapshot must contain a JSON object.'];
  }

  const surfacePerf = isRecord(parsed.surfacePerf) ? parsed.surfacePerf : {};
  if (!isRecord(parsed.surfacePerf)) {
    issues.push('release performance snapshot is missing surfacePerf object.');
  }
  const targetBudgetMs = readFiniteNumberValue(surfacePerf.targetBudgetMs);
  if (targetBudgetMs === null || targetBudgetMs <= 0) {
    issues.push('release performance snapshot surfacePerf.targetBudgetMs must be a positive number.');
  }
  if (readStringValue(surfacePerf.budgetStatus) !== 'ok') {
    issues.push('release performance snapshot surfacePerf.budgetStatus must be ok.');
  }
  const overBudgetCount = readFiniteNumberValue(surfacePerf.overBudgetCount);
  if (overBudgetCount !== 0) {
    issues.push('release performance snapshot surfacePerf.overBudgetCount must be 0.');
  }

  const recentCycles = Array.isArray(surfacePerf.recentCycles) ? surfacePerf.recentCycles : [];
  if (!Array.isArray(surfacePerf.recentCycles)) {
    issues.push('release performance snapshot surfacePerf.recentCycles must be an array.');
  }
  if (recentCycles.length < 10) {
    issues.push('release performance snapshot must include at least 10 render samples.');
  }
  const durations: number[] = [];
  for (const [index, cycle] of recentCycles.entries()) {
    if (!isRecord(cycle)) {
      issues.push(`release performance snapshot render cycle ${index + 1} must be an object.`);
      continue;
    }
    const durationMs = readFiniteNumberValue(cycle.durationMs);
    if (durationMs === null || durationMs <= 0) {
      issues.push(`release performance snapshot render cycle ${index + 1} must include a positive durationMs.`);
      continue;
    }
    durations.push(durationMs);
    if (cycle.overBudget !== false) {
      issues.push(`release performance snapshot render cycle ${index + 1} must not be over budget.`);
    }
  }
  if (targetBudgetMs !== null && durations.length > 0) {
    const p95 = calculateP95(durations);
    if (p95 > targetBudgetMs) {
      issues.push(`release performance snapshot render p95 ${p95}ms exceeds target budget ${targetBudgetMs}ms.`);
    }
  }

  const extraMetrics = readNumberRecord(parsed.extraMetrics);
  if (!isRecord(parsed.extraMetrics)) {
    issues.push('release performance snapshot is missing extraMetrics object.');
  }
  for (const metricName of RELEASE_PERFORMANCE_REQUIRED_EXTRA_METRIC_NAMES) {
    if (!(metricName in extraMetrics)) {
      issues.push(`release performance snapshot is missing required extra metric: ${metricName}.`);
      continue;
    }
    const value = extraMetrics[metricName];
    const budget = RELEASE_PERFORMANCE_BUDGETS[metricName];
    if (RELEASE_PERFORMANCE_HIGHER_IS_BETTER_METRICS.has(metricName)) {
      if (value < budget) {
        issues.push(`release performance snapshot metric ${metricName} ${value} is below release budget ${budget}.`);
      }
    } else if (value > budget) {
      issues.push(`release performance snapshot metric ${metricName} ${value} exceeds release budget ${budget}.`);
    }
  }
  return issues;
}

function verifyReleaseLiveVerificationReport(root: string, readinessCheckedAt: Date | null): readonly string[] {
  const issues: string[] = [];
  const jsonPath = join(root, RELEASE_LIVE_VERIFICATION_JSON_RELATIVE_PATH);
  const markdownPath = join(root, RELEASE_LIVE_VERIFICATION_MARKDOWN_RELATIVE_PATH);
  let markdown = '';

  if (!existsSync(jsonPath)) {
    return [`release live verification report is missing: ${RELEASE_LIVE_VERIFICATION_JSON_RELATIVE_PATH}.`];
  }
  if (!existsSync(markdownPath)) {
    issues.push(`release live verification Markdown report is missing: ${RELEASE_LIVE_VERIFICATION_MARKDOWN_RELATIVE_PATH}.`);
  } else {
    markdown = readFileSync(markdownPath, 'utf-8');
    if (!markdown.includes('Result: PASS')) {
      issues.push('release live verification Markdown report must record Result: PASS.');
    }
  }

  let parsed: unknown;
  let jsonSource = '';
  try {
    jsonSource = readFileSync(jsonPath, 'utf-8');
    parsed = JSON.parse(jsonSource) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [...issues, `release live verification report is invalid JSON: ${message}`];
  }
  issues.push(...verifyNoLiveVerificationLocalPathLeaks(root, jsonSource, markdown));
  if (!isRecord(parsed)) {
    return [...issues, 'release live verification report must contain a JSON object.'];
  }

  if (parsed.ok !== true) {
    issues.push('release live verification report must have ok=true.');
  }
  if (parsed.strict !== true) {
    issues.push('release live verification report must be generated with --strict.');
  }
  const generatedAt = readStringValue(parsed.generatedAt);
  const generatedAtDate = new Date(generatedAt);
  if (!generatedAt || Number.isNaN(generatedAtDate.getTime())) {
    issues.push('release live verification report must include a valid generatedAt timestamp.');
  } else {
    issues.push(...verifyReleaseLiveVerificationFreshness(generatedAtDate, readinessCheckedAt));
  }

  const counts = readNumberRecord(parsed.counts);
  issues.push(...verifyReleaseLiveVerificationMarkdownConsistency(markdown, generatedAt, counts));
  for (const status of ['warn', 'fail', 'skip'] as const) {
    if ((counts[status] ?? 0) !== 0) {
      issues.push(`release live verification report must have zero ${status} checks.`);
    }
  }
  if ((counts.pass ?? 0) < RELEASE_LIVE_VERIFICATION_REQUIRED_CHECK_IDS.length) {
    issues.push(`release live verification report must pass at least ${RELEASE_LIVE_VERIFICATION_REQUIRED_CHECK_IDS.length} required checks.`);
  }

  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  if (!Array.isArray(parsed.checks)) {
    issues.push('release live verification report is missing checks array.');
  }
  const checksById = new Map<string, Record<string, unknown>>();
  for (const [index, check] of checks.entries()) {
    if (!isRecord(check)) {
      issues.push(`release live verification check ${index + 1} must be an object.`);
      continue;
    }
    const id = readStringValue(check.id);
    if (!id) {
      issues.push(`release live verification check ${index + 1} is missing an id.`);
      continue;
    }
    checksById.set(id, check);
    if (readStringValue(check.status) !== 'pass') {
      issues.push(`release live verification check ${id} must pass.`);
    }
  }
  for (const requiredId of RELEASE_LIVE_VERIFICATION_REQUIRED_CHECK_IDS) {
    const check = checksById.get(requiredId);
    if (!check) {
      issues.push(`release live verification report is missing required check: ${requiredId}.`);
    } else if (readStringValue(check.status) !== 'pass') {
      issues.push(`release live verification required check ${requiredId} did not pass.`);
    }
  }

  return issues;
}

function verifyReleaseReadinessPolicy(root: string, packageVersion: string): readonly string[] {
  const readinessPath = join(root, RELEASE_READINESS_RELATIVE_PATH);
  if (!existsSync(readinessPath)) {
    return [`release readiness inventory is missing: ${RELEASE_READINESS_RELATIVE_PATH}.`];
  }

  const issues: string[] = [];
  let parsed: unknown;
  let source = '';
  try {
    source = readFileSync(readinessPath, 'utf-8');
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`release readiness inventory is invalid JSON: ${message}`];
  }
  issues.push(...verifyNoReleaseReadinessLocalEvidenceLeaks(root, source));

  if (!isRecord(parsed)) {
    return ['release readiness inventory must contain a JSON object.'];
  }
  if (parsed.schemaVersion !== 1) {
    issues.push('release readiness inventory schemaVersion must be 1.');
  }
  if (readStringValue(parsed.gate) !== 'goodvibes-agent-release-readiness') {
    issues.push('release readiness inventory gate must be goodvibes-agent-release-readiness.');
  }
  const checkedAt = readStringValue(parsed.checkedAt).trim();
  const checkedAtDate = parseDateOnlyUtc(checkedAt);
  if (checkedAtDate === null) {
    issues.push('release readiness inventory checkedAt must be a real YYYY-MM-DD date.');
  }

  const policy = isRecord(parsed.policy) ? parsed.policy : {};
  if (!isRecord(parsed.policy)) {
    issues.push('release readiness inventory is missing a policy object.');
  }
  const blockerStatuses = readStringArray(policy.blockerStatuses);
  for (const status of RELEASE_READINESS_BLOCKER_STATUSES) {
    if (!blockerStatuses.includes(status)) {
      issues.push(`release readiness inventory policy.blockerStatuses must include ${status}.`);
    }
  }
  const sourceNaming = readStringValue(policy.sourceNaming);
  if (!sourceNaming.includes('neutral evidence aliases')) {
    issues.push('release readiness inventory policy must require neutral evidence aliases.');
  }
  const qualityGate = readStringValue(policy.qualityGate);
  if (!qualityGate.includes('release-quality') || !qualityGate.includes('capability coverage')) {
    issues.push('release readiness inventory policy.qualityGate must require release-quality coverage.');
  }
  const requiredQualityDimensions = readStringArray(policy.requiredQualityDimensions);
  for (const dimension of RELEASE_READINESS_REQUIRED_QUALITY_DIMENSIONS) {
    if (!requiredQualityDimensions.includes(dimension)) {
      issues.push(`release readiness inventory policy.requiredQualityDimensions must include ${dimension}.`);
    }
  }

  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  if (!Array.isArray(parsed.sources)) {
    issues.push('release readiness inventory is missing a sources array.');
  }
  const sourceIds = new Set<string>();
  for (const [index, source] of sources.entries()) {
    if (!isRecord(source)) {
      issues.push(`release readiness inventory source ${index + 1} must be an object.`);
      continue;
    }
    const id = readStringValue(source.id).trim();
    if (id.length === 0) {
      issues.push(`release readiness inventory source ${index + 1} is missing an id.`);
      continue;
    }
    sourceIds.add(id);
  }
  for (const requiredSource of RELEASE_READINESS_REQUIRED_SOURCE_IDS) {
    if (!sourceIds.has(requiredSource)) {
      issues.push(`release readiness inventory is missing required source alias: ${requiredSource}.`);
    }
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (!Array.isArray(parsed.items)) {
    issues.push('release readiness inventory is missing an items array.');
  }
  if (items.length < RELEASE_READINESS_REQUIRED_IDS.length) {
    issues.push(`release readiness inventory must cover at least ${RELEASE_READINESS_REQUIRED_IDS.length} required capability items.`);
  }

  const itemIds = new Set<string>();
  const blockerItemIds: string[] = [];
  const modelAccessHarnessModes = new Set<string>();
  let connectedHostCoveredCount = 0;
  let releaseCoveredCount = 0;
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      issues.push(`release readiness inventory item ${index + 1} must be an object.`);
      continue;
    }
    const id = readStringValue(item.id).trim();
    const capability = readStringValue(item.capability).trim();
    const owner = readStringValue(item.owner).trim();
    const status = readStringValue(item.status).trim();
    const evidence = readStringValue(item.evidence).trim();
    const action = readStringValue(item.action).trim();
    const quality = isRecord(item.quality) ? item.quality : {};
    const label = id.length > 0 ? id : `item ${index + 1}`;
    if (id.length === 0) {
      issues.push(`release readiness inventory item ${index + 1} is missing an id.`);
    } else if (itemIds.has(id)) {
      issues.push(`release readiness inventory has duplicate item id: ${id}.`);
    } else {
      itemIds.add(id);
    }
    if (capability.length === 0) {
      issues.push(`release readiness inventory ${label} is missing capability text.`);
    }
    if (!RELEASE_READINESS_ALLOWED_OWNERS.has(owner)) {
      issues.push(`release readiness inventory ${label} has invalid owner: ${owner}.`);
    }
    if (!RELEASE_READINESS_ALLOWED_STATUSES.has(status)) {
      issues.push(`release readiness inventory ${label} has invalid status: ${status}.`);
    }
    if (evidence.length === 0) {
      issues.push(`release readiness inventory ${label} is missing evidence.`);
    }
    if (owner === 'connected-host' && status === 'covered' && !evidence.includes('goodvibes-connected-host')) {
      issues.push(`release readiness inventory ${label} must cite the goodvibes-connected-host source alias.`);
    }
    if (owner === 'companion' && status === 'covered' && !evidence.includes('goodvibes-companion')) {
      issues.push(`release readiness inventory ${label} must cite the goodvibes-companion source alias.`);
    }
    if (action.length === 0) {
      issues.push(`release readiness inventory ${label} is missing action.`);
    }
    if (!isRecord(item.quality)) {
      issues.push(`release readiness inventory ${label} is missing quality evidence dimensions.`);
    }
    for (const dimension of RELEASE_READINESS_REQUIRED_QUALITY_DIMENSIONS) {
      const value = readStringValue(quality[dimension]).trim();
      if (value.length === 0) {
        issues.push(`release readiness inventory ${label} is missing quality.${dimension}.`);
      }
      if (/\b(?:unknown|todo|gap|unverified|unproven)\b/i.test(value)) {
        issues.push(`release readiness inventory ${label} quality.${dimension} must not be marked unknown, todo, gap, unverified, or unproven.`);
      }
    }
    const userAccess = readStringValue(quality.userAccess).trim();
    if (
      RELEASE_READINESS_OPERATOR_AUDIT_ITEM_IDS.has(id)
      && !/\b(?:operator\/audit|audit|maintainer|release operator)s?\b/i.test(userAccess)
    ) {
      issues.push(`release readiness inventory ${label} quality.userAccess must describe release evidence as operator/audit or maintainer material.`);
    }
    const modelAccess = readStringValue(quality.modelAccess);
    for (const match of modelAccess.matchAll(/mode:"([a-z_]+)"/g)) {
      const mode = match[1];
      if (!mode) continue;
      if (!AGENT_HARNESS_MODE_SET.has(mode)) {
        issues.push(`release readiness inventory ${label} quality.modelAccess references unknown agent_harness mode:"${mode}".`);
        continue;
      }
      modelAccessHarnessModes.add(mode);
    }
    if (RELEASE_READINESS_BLOCKER_STATUSES.has(status)) {
      blockerItemIds.push(label);
    }
    if (owner === 'connected-host' && status === 'covered') connectedHostCoveredCount += 1;
    if (owner === 'release' && status === 'covered') releaseCoveredCount += 1;
  }

  for (const requiredId of RELEASE_READINESS_REQUIRED_IDS) {
    if (!itemIds.has(requiredId)) {
      issues.push(`release readiness inventory is missing required capability item: ${requiredId}.`);
    }
  }
  if (connectedHostCoveredCount === 0) {
    issues.push('release readiness inventory must include connected-host covered capability evidence.');
  }
  if (releaseCoveredCount === 0) {
    issues.push('release readiness inventory must include release covered capability evidence.');
  }
  for (const mode of AGENT_HARNESS_MODES) {
    if (!modelAccessHarnessModes.has(mode)) {
      issues.push(`release readiness inventory model access must cover agent_harness mode:"${mode}".`);
    }
  }

  const releaseScriptPath = join(root, 'scripts', 'release.ts');
  if (existsSync(releaseScriptPath)) {
    const releaseScript = readFileSync(releaseScriptPath, 'utf-8');
    if (!releaseScript.includes(RELEASE_READINESS_RELATIVE_PATH)) {
      issues.push(`release script must stage release readiness inventory: ${RELEASE_READINESS_RELATIVE_PATH}.`);
    }
    if (!releaseScript.includes(RELEASE_PERFORMANCE_SNAPSHOT_RELATIVE_PATH)) {
      issues.push(`release script must stage release performance snapshot: ${RELEASE_PERFORMANCE_SNAPSHOT_RELATIVE_PATH}.`);
    }
    if (!releaseScript.includes(RELEASE_LIVE_VERIFICATION_JSON_RELATIVE_PATH)) {
      issues.push(`release script must stage release live verification JSON report: ${RELEASE_LIVE_VERIFICATION_JSON_RELATIVE_PATH}.`);
    }
    if (!releaseScript.includes(RELEASE_LIVE_VERIFICATION_MARKDOWN_RELATIVE_PATH)) {
      issues.push(`release script must stage release live verification Markdown report: ${RELEASE_LIVE_VERIFICATION_MARKDOWN_RELATIVE_PATH}.`);
    }
  }
  if (isStableReleaseLine(packageVersion) && blockerItemIds.length > 0) {
    issues.push(`release readiness inventory still has blocker entries for package ${packageVersion}: ${blockerItemIds.sort().join(', ')}.`);
  }
  if (blockerItemIds.length === 0) {
    issues.push(...verifyReleaseLiveVerificationReport(root, checkedAtDate));
  }
  return issues;
}

function verifyGithubReleaseWorkflowPolicy(root: string): readonly string[] {
  const releaseWorkflowPath = join(root, '.github', 'workflows', 'release.yml');
  if (!existsSync(releaseWorkflowPath)) return [];
  const issues: string[] = [];
  const source = readFileSync(releaseWorkflowPath, 'utf-8');
  const requiredMarkers = [
    'Verify branch CI passed for release SHA',
    '--workflow ci.yml',
    'select(.name == "test")',
  ] as const;
  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`GitHub release workflow must verify branch CI and its test job before release: missing ${marker}.`);
    }
  }
  const requiredPackReleaseMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'Check tag matches package version', label: 'tag/package version match check' },
    { marker: 'test "$TAG_VERSION" = "$PACKAGE_VERSION"', label: 'tag/package version assertion' },
    { marker: 'Pack release tarball', label: 'pack job' },
    { marker: 'needs: validate-release', label: 'pack job CI validation dependency' },
    { marker: 'bun run build:package-runtime', label: 'package runtime build before packing' },
    { marker: 'bun pm pack --destination dist', label: 'Bun package tarball creation' },
    { marker: 'Expected exactly one package tarball in dist', label: 'single tarball assertion' },
    { marker: 'Upload package tarball', label: 'package tarball upload' },
    { marker: 'name: npm-tarball', label: 'package tarball artifact name' },
    { marker: 'Download package tarball', label: 'package tarball download' },
    { marker: 'Extract changelog excerpt', label: 'release changelog excerpt' },
    { marker: 'awk -v version="$VERSION"', label: 'version-specific changelog extraction' },
    { marker: 'softprops/action-gh-release@', label: 'GitHub Release creation action' },
    { marker: 'body_path: ${{ steps.changelog.outputs.excerpt_file }}', label: 'GitHub Release changelog body' },
    { marker: 'files: dist/*.tgz', label: 'GitHub Release tarball attachment' },
    { marker: 'draft: false', label: 'non-draft GitHub Release' },
    { marker: 'prerelease: false', label: 'non-prerelease GitHub Release' },
  ];
  for (const { marker, label } of requiredPackReleaseMarkers) {
    if (!source.includes(marker)) {
      issues.push(`GitHub release workflow must keep package tarball/GitHub Release policy: missing ${label}.`);
    }
  }
  const requiredPublishMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: "vars.PUBLISH_NPM == 'true'", label: 'optional npm publish repository variable guard' },
    { marker: 'NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}', label: 'npm token secret handoff' },
    { marker: 'bun run publish:package', label: 'staged package publish script' },
    { marker: 'npm view "@pellux/goodvibes-agent@${VERSION}" version --registry=https://registry.npmjs.org', label: 'exact registry version verification' },
    { marker: 'Bun registry install smoke', label: 'registry install smoke step' },
    { marker: 'TOKEN_SENTINEL="goodvibes-agent-registry-smoke-token-do-not-print', label: 'connected-host token sentinel' },
    { marker: 'operator-tokens.json', label: 'connected-host token sentinel fixture' },
    { marker: 'bun add -g "@pellux/goodvibes-agent@${VERSION}" --registry https://registry.npmjs.org --minimum-release-age 0', label: 'exact Bun global registry install' },
    { marker: 'grep -Fq "${TOKEN_SENTINEL}"', label: 'token sentinel leak check' },
    { marker: 'run_installed_agent "--version"', label: 'installed --version smoke' },
    { marker: 'run_installed_agent "--help"', label: 'installed --help smoke' },
    { marker: 'run_installed_agent "status --json"', label: 'installed status --json smoke' },
  ];
  for (const { marker, label } of requiredPublishMarkers) {
    if (!source.includes(marker)) {
      issues.push(`GitHub release workflow must keep npm publish/install smoke policy: missing ${label}.`);
    }
  }
  const forbiddenGateCommands: readonly { readonly command: RegExp; readonly label: string }[] = [
    { command: /\bbun\s+run\s+test\b/, label: 'bun run test' },
    { command: /\bbun\s+test\b/, label: 'bun test' },
    { command: /\bbunx?\s+tsc\b|\bbun\s+x\s+tsc\b|\bbun\s+run\s+typecheck\b/, label: 'typecheck' },
    { command: /\bbun\s+run\s+architecture:check\b/, label: 'architecture:check' },
    { command: /\bbun\s+run\s+perf:check\b/, label: 'perf:check' },
    { command: /\bbun\s+run\s+publish:check\b/, label: 'publish:check' },
    { command: /\bbun\s+run\s+package:install-check\b/, label: 'package:install-check' },
    { command: /\bbun\s+run\s+build\b(?!:)/, label: 'bun run build' },
  ];
  for (const { command, label } of forbiddenGateCommands) {
    if (command.test(source)) {
      issues.push(`GitHub release workflow must not duplicate branch-CI gate: ${label}.`);
    }
  }
  return issues;
}

function verifyGithubCiWorkflowPolicy(root: string): readonly string[] {
  const ciWorkflowPath = join(root, '.github', 'workflows', 'ci.yml');
  if (!existsSync(ciWorkflowPath)) return ['GitHub CI workflow is missing: .github/workflows/ci.yml.'];
  const issues: string[] = [];
  const source = readFileSync(ciWorkflowPath, 'utf-8');
  const requiredMarkers = [
    'name: CI',
    'jobs:',
    'test:',
  ] as const;
  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`GitHub CI workflow must keep the branch-CI test job contract: missing ${marker}.`);
    }
  }
  for (const { command, label } of REQUIRED_CI_GATE_COMMANDS) {
    if (!command.test(source)) {
      issues.push(`GitHub CI workflow must run branch-CI release gate: ${label}.`);
    }
  }
  return issues;
}

function verifyReleaseScriptPolicy(root: string): readonly string[] {
  const releaseScriptPath = join(root, 'scripts', 'release.ts');
  if (!existsSync(releaseScriptPath)) return ['release script is missing: scripts/release.ts.'];
  const issues: string[] = [];
  const source = readFileSync(releaseScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'skipValidation && !dryRun', label: 'real-release validation guard' },
    { marker: '--skip-validation is only allowed with --dry-run', label: 'skip-validation dry-run error' },
    { marker: 'process.env.GOODVIBES_AGENT_RELEASE_NOTES', label: 'release notes environment fallback' },
    { marker: '--notes-file requires a markdown file path', label: 'notes-file argument validation' },
    { marker: 'product release notes are required', label: 'real-release product notes requirement' },
    { marker: 'release notes must describe product changes, not raw commit hashes', label: 'raw commit hash release-notes rejection' },
    { marker: '[0-9a-f]{7,40}', label: 'commit-hash release-notes detector' },
    { marker: 'releaseEvidenceInputPaths', label: 'declared release evidence inputs' },
    { marker: 'releaseBlockingGitStatusLines', label: 'dirty worktree release blocker classifier' },
    { marker: 'releaseEvidenceHygieneIssues', label: 'release evidence text hygiene scanner' },
    { marker: 'assertReleaseEvidenceHygiene', label: 'release evidence text hygiene assertion' },
    { marker: "assertReleaseEvidenceHygiene('release evidence text hygiene', root)", label: 'pre-validation release evidence hygiene check' },
    { marker: "assertReleaseEvidenceHygiene('post-release evidence text hygiene', root)", label: 'post-mutation release evidence hygiene check' },
    { marker: 'missing final newline', label: 'release evidence final newline check' },
    { marker: 'trailing whitespace', label: 'release evidence trailing whitespace check' },
    { marker: 'git status --porcelain --untracked-files=all', label: 'complete worktree preflight' },
    { marker: 'non-release-evidence changes', label: 'product dirty worktree release error' },
    { marker: 'Pre-generated release evidence detected', label: 'release evidence dirty worktree allowance' },
    { marker: 'git rev-parse --abbrev-ref HEAD', label: 'main branch preflight' },
    { marker: 'releases must be cut from main', label: 'main branch release requirement' },
    { marker: 'bun run typecheck', label: 'release typecheck gate' },
    { marker: 'bun run architecture:check', label: 'release architecture gate' },
    { marker: 'bun run perf:check', label: 'release performance gate' },
    { marker: 'bun run build', label: 'release build gate' },
    { marker: 'bun run publish:check', label: 'release publish check gate' },
    { marker: 'bun run package:install-check', label: 'release package install check gate' },
    { marker: 'bun run verification:ledger', label: 'release verification ledger gate' },
    { marker: 'bun pm pack --dry-run', label: 'release pack dry-run gate' },
    { marker: 'git diff --check', label: 'release diff hygiene gate' },
    { marker: 'bun run scripts/prebuild.ts', label: 'release version fallback sync' },
    { marker: 'formatLocalReleaseDate()', label: 'local release date heading' },
    { marker: 'assertReleasePackagePolicy', label: 'post-mutation package policy validation' },
    { marker: 'verifyReleaseMetadata(root)', label: 'post-mutation metadata validation' },
    { marker: 'verifyPackageFacingText(root).failures', label: 'post-mutation package-facing text validation' },
    { marker: 'release/release-notes.md', label: 'release notes staging artifact' },
    { marker: 'release/performance-snapshot.json', label: 'release performance snapshot staging artifact' },
    { marker: '...packageDocPaths(root)', label: 'release docs staging surface' },
    { marker: 'releaseMetadataPaths(root).map(shellQuote)', label: 'metadata/docs staging command' },
    { marker: 'git tag -a ${tag}', label: 'annotated release tag' },
    { marker: 'Previewing git commit and tag', label: 'dry-run commit/tag preview heading' },
    { marker: 'Dry-run release preview for ${tag} complete.', label: 'dry-run completion message' },
    { marker: 'No files, commits, or tags were written.', label: 'dry-run no-write message' },
    { marker: 'rerun without --dry-run from a clean main worktree after product changes are committed', label: 'dry-run real-release next step' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`release script must keep release policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPublishPackageScriptPolicy(root: string): readonly string[] {
  const publishScriptPath = join(root, 'scripts', 'publish-package.ts');
  if (!existsSync(publishScriptPath)) return ['publish package script is missing: scripts/publish-package.ts.'];
  const issues: string[] = [];
  const source = readFileSync(publishScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'GOODVIBES_PUBLIC_PACKAGE_NAME is not supported', label: 'fixed public Agent package name guard' },
    { marker: 'GOODVIBES_PUBLISH_REGISTRY', label: 'explicit publish registry override' },
    { marker: 'syncProjectSurfaces(root)', label: 'project surface sync before staging' },
    { marker: 'assertSourcePackagePolicy(root)', label: 'source package policy check' },
    { marker: 'bun', label: 'Bun package runtime build command' },
    { marker: 'build:package-runtime', label: 'package runtime build before staging' },
    { marker: 'entry === \'docs/*.md\'', label: 'package docs glob expansion' },
    { marker: 'isForbiddenPackageTarballPath(relativePath)', label: 'forbidden path filter during copy' },
    { marker: 'staged package contains forbidden paths', label: 'staged forbidden-path assertion' },
    { marker: 'requiredTarballPaths(root)', label: 'shared required package path assertion' },
    { marker: 'staged package is missing package-facing doc', label: 'staged docs presence assertion' },
    { marker: 'staged package-facing doc is empty', label: 'staged docs non-empty assertion' },
    { marker: 'assertStagedPackagePolicy(stageDir)', label: 'staged package policy check' },
    { marker: 'buildNpmPublishAuthEnv', label: 'npm publish auth builder' },
    { marker: 'staged package.json is missing string name/version fields', label: 'staged package name/version check' },
    { marker: 'staged package.json has unexpected package name', label: 'staged package name guard' },
    { marker: 'getPublishedNpmVersion', label: 'idempotent published-version lookup' },
    { marker: 'is already published; skipping npm publish', label: 'idempotent publish skip' },
    { marker: "['pack', '--json']", label: 'dry-run npm pack command' },
    { marker: "['publish', '--access', 'public', '--registry', registry]", label: 'public npm publish command' },
    { marker: 'rmSync(tempRoot, { recursive: true, force: true })', label: 'publish staging cleanup' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`publish package script must keep staging/publish policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPackageInstallCheckScriptPolicy(root: string): readonly string[] {
  const installCheckPath = join(root, 'scripts', 'package-install-check.ts');
  if (!existsSync(installCheckPath)) return ['package install check script is missing: scripts/package-install-check.ts.'];
  const issues: string[] = [];
  const source = readFileSync(installCheckPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'verifyPackageCliInstall(process.cwd())', label: 'shared package install policy report' },
    { marker: 'CONNECTED_HOST_TOKEN_SENTINEL', label: 'connected-host token sentinel' },
    { marker: 'redactSensitiveOutput', label: 'sensitive output redaction' },
    { marker: 'assertNoSensitiveOutput', label: 'token sentinel output guard' },
    { marker: 'GOODVIBES_AGENT_INSTALL_CHECK_TMPDIR', label: 'install check temp-root override' },
    { marker: "run('bun', ['pm', 'pack', '--destination', packDir, '--quiet'])", label: 'packed artifact creation' },
    { marker: "run('bun', ['add', '-g', tarballPath, '--registry', 'https://registry.npmjs.org']", label: 'Bun global install from packed artifact' },
    { marker: 'BUN_GLOBAL_INSTALL_TIMEOUT_MS', label: 'Bun global install timeout' },
    { marker: 'writeConnectedHostTokenSentinel(bareHomeDir)', label: 'connected-host token fixture' },
    { marker: 'GOODVIBES_WORKING_DIR', label: 'isolated installed smoke workspace' },
    { marker: 'installed bin does not use the Bun shebang', label: 'installed Bun shebang assertion' },
    { marker: 'installed bundled runtime is empty', label: 'installed runtime non-empty assertion' },
    { marker: 'assertInstalledRequiredPackagePaths(installedPackageRoot)', label: 'installed required package path assertion' },
    { marker: 'requiredTarballPaths(process.cwd())', label: 'shared required package paths' },
    { marker: 'build-machine dependency path', label: 'bundled runtime path-leak guard' },
    { marker: "run('goodvibes-agent', ['--help']", label: 'installed help smoke' },
    { marker: "run('goodvibes-agent', ['--version']", label: 'installed version smoke' },
    { marker: "run('goodvibes-agent', ['status', '--json']", label: 'installed status json smoke' },
    { marker: "['serve', 'daemon', 'service', 'web', 'surfaces', 'remote']", label: 'blocked lifecycle command smoke' },
    { marker: 'runExpectingExit', label: 'blocked command exit assertion' },
    { marker: 'Unsupported command: ${command}.', label: 'blocked command guidance assertion' },
    { marker: 'assertInstalledTuiLaunches(bareSmokeEnv, tempRoot)', label: 'installed TUI launch smoke' },
    { marker: 'script', label: 'PTY launch command' },
    { marker: 'goodvibes-agent --no-alt-screen', label: 'installed TUI no-alt-screen launch' },
    { marker: 'expected timeout after staying alive', label: 'TUI stay-alive timeout assertion' },
    { marker: 'rmSync(tempRoot, { recursive: true, force: true })', label: 'install smoke cleanup' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`package install check script must keep install-smoke policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPublishCheckScriptPolicy(root: string): readonly string[] {
  const publishCheckPath = join(root, 'scripts', 'publish-check.ts');
  if (!existsSync(publishCheckPath)) return ['publish check script is missing: scripts/publish-check.ts.'];
  const issues: string[] = [];
  const source = readFileSync(publishCheckPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'verifyReleaseMetadata(root)', label: 'release metadata policy check' },
    { marker: 'verifyPackageFacingText(root)', label: 'package-facing text policy check' },
    { marker: 'bun run build:package-runtime', label: 'package runtime build before pack dry-run' },
    { marker: 'npm pack --json --dry-run', label: 'npm pack dry-run command' },
    { marker: "stdio: ['ignore', 'pipe', 'inherit']", label: 'pack dry-run stderr passthrough' },
    { marker: 'isForbiddenPackageTarballPath(filePath)', label: 'forbidden tarball path assertion' },
    { marker: 'requiredTarballPaths(root)', label: 'required tarball path assertion' },
    { marker: 'published tarball is missing required path', label: 'missing required tarball path failure' },
    { marker: 'published tarball is too large', label: 'tarball size cap failure' },
    { marker: '50 * 1024 * 1024', label: 'tarball size cap' },
    { marker: 'publish check passed', label: 'publish check success summary' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`publish check script must keep tarball dry-run policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPackageRuntimeBuildScriptPolicy(root: string): readonly string[] {
  const buildScriptPath = join(root, 'scripts', 'build-package-runtime.ts');
  if (!existsSync(buildScriptPath)) return ['package runtime build script is missing: scripts/build-package-runtime.ts.'];
  const issues: string[] = [];
  const source = readFileSync(buildScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: "const outDir = join(root, 'dist', 'package')", label: 'package runtime output directory' },
    { marker: "const entry = join(outDir, 'main.js')", label: 'package runtime entrypoint' },
    { marker: 'rmSync(outDir, { recursive: true, force: true })', label: 'clean runtime output before build' },
    { marker: 'patchBunCompileCompatibility(root)', label: 'Bun compile compatibility patch' },
    { marker: "execFileSync('bun', ['build', 'src/main.ts', '--target=bun', '--outdir', outDir]", label: 'Bun runtime build command' },
    { marker: "stdio: 'inherit'", label: 'runtime build passthrough output' },
    { marker: 'package runtime build did not create', label: 'missing runtime entrypoint failure' },
    { marker: 'forbiddenRuntimeFragments', label: 'runtime path-leak fragment list' },
    { marker: 'node_modules/jsdom/lib/jsdom/browser/default-stylesheet.css', label: 'jsdom stylesheet path-leak guard' },
    { marker: '../../../browser/default-stylesheet.css', label: 'relative browser stylesheet path-leak guard' },
    { marker: 'require.resolve("./xhr-sync-worker.js")', label: 'xhr worker path-leak guard' },
    { marker: 'package runtime build leaked a build-machine dependency path', label: 'runtime path-leak failure' },
    { marker: 'statSync(entry).size', label: 'runtime entrypoint size check' },
    { marker: 'size <= 0', label: 'empty runtime entrypoint guard' },
    { marker: 'package runtime build created an empty entrypoint', label: 'empty runtime entrypoint failure' },
    { marker: 'package runtime built', label: 'runtime build success summary' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`package runtime build script must keep runtime bundle policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyProductionBuildScriptPolicy(root: string): readonly string[] {
  const buildScriptPath = join(root, 'scripts', 'build.ts');
  if (!existsSync(buildScriptPath)) return ['production build script is missing: scripts/build.ts.'];
  const issues: string[] = [];
  const source = readFileSync(buildScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'patchBunCompileCompatibility(root)', label: 'Bun compile compatibility patch' },
    { marker: "execSync('bun run scripts/prebuild.ts'", label: 'project surface prebuild before compile' },
    { marker: 'TARGETS: Record<string', label: 'typed build target matrix' },
    { marker: "'linux-x64': { bunTarget: 'bun-linux-x64', outfile: 'goodvibes-agent-linux-x64'", label: 'linux x64 target' },
    { marker: "'linux-arm64': { bunTarget: 'bun-linux-arm64', outfile: 'goodvibes-agent-linux-arm64'", label: 'linux arm64 target' },
    { marker: "'darwin-x64': { bunTarget: 'bun-darwin-x64', outfile: 'goodvibes-agent-macos-x64'", label: 'macOS x64 target' },
    { marker: "'darwin-arm64': { bunTarget: 'bun-darwin-arm64', outfile: 'goodvibes-agent-macos-arm64'", label: 'macOS arm64 target' },
    { marker: 'SQLITE_VEC_NATIVE_FILENAMES', label: 'sqlite-vec native addon filename map' },
    { marker: "'sqlite-vec-linux-x64': 'vec0.so'", label: 'linux x64 sqlite-vec addon' },
    { marker: "'sqlite-vec-linux-arm64': 'vec0.so'", label: 'linux arm64 sqlite-vec addon' },
    { marker: "'sqlite-vec-darwin-x64': 'vec0.dylib'", label: 'macOS x64 sqlite-vec addon' },
    { marker: "'sqlite-vec-darwin-arm64': 'vec0.dylib'", label: 'macOS arm64 sqlite-vec addon' },
    { marker: "const buildAll = args.includes('--all')", label: 'all-target build flag' },
    { marker: "const targetIdx = args.indexOf('--target')", label: 'specific target build flag' },
    { marker: "spawnSync('bun', [", label: 'Bun compile spawn' },
    { marker: "'build', 'src/main.ts'", label: 'Agent source entry build' },
    { marker: "'--compile'", label: 'compiled binary build flag' },
    { marker: '`--target=${config.bunTarget}`', label: 'target-specific Bun compile flag' },
    { marker: "'--outfile', outPath", label: 'target-specific output path' },
    { marker: "'--external', config.sqliteVecPackage", label: 'native addon externalization' },
    { marker: "join(distDir, 'lib', config.sqliteVecPackage)", label: 'native addon dist library path' },
    { marker: 'copyFileSync(srcAddon, join(libDir, nativeFilename))', label: 'native addon copy' },
    { marker: 'Build failed: native addon not found', label: 'same-platform native addon hard failure' },
    { marker: '[WARN] Cross-target build: native addon', label: 'cross-target native addon warning' },
    { marker: "Unsupported platform '${platform}'", label: 'unsupported platform failure' },
    { marker: 'No built-in target for', label: 'unknown native target failure' },
    { marker: 'Unknown target', label: 'unknown requested target failure' },
    { marker: 'Build Summary', label: 'build summary output' },
    { marker: 'process.exit(1)', label: 'build failure exit' },
    { marker: 'Build complete', label: 'build success summary' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`production build script must keep compiled Agent build policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyBunCompileCompatibilityScriptPolicy(root: string): readonly string[] {
  const compatScriptPath = join(root, 'scripts', 'bun-compile-compat.ts');
  if (!existsSync(compatScriptPath)) return ['Bun compile compatibility script is missing: scripts/bun-compile-compat.ts.'];
  const issues: string[] = [];
  const source = readFileSync(compatScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'type SourcePatch', label: 'typed source patch entries' },
    { marker: 'export function patchBunCompileCompatibility(root: string): void', label: 'exported patch entrypoint' },
    { marker: "join(root, 'node_modules', 'jsdom', 'lib', 'jsdom', 'browser', 'default-stylesheet.css')", label: 'jsdom default stylesheet source path' },
    { marker: "join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js')", label: 'sql.js runtime source path' },
    { marker: "join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')", label: 'sql.js wasm source path' },
    { marker: "join(root, 'node_modules', 'css-tree', 'lib', 'data-patch.js')", label: 'css-tree patch data module' },
    { marker: "join(root, 'node_modules', 'css-tree', 'lib', 'data.js')", label: 'css-tree data module' },
    { marker: "join(root, 'node_modules', 'css-tree', 'lib', 'version.js')", label: 'css-tree version module' },
    { marker: 'createRequire(import.meta.url)', label: 'CommonJS require pattern being removed' },
    { marker: "import patch from '../data/patch.json';", label: 'css-tree patch JSON import replacement' },
    { marker: "import mdnAtrules from 'mdn-data/css/at-rules.json';", label: 'css-tree at-rules JSON import replacement' },
    { marker: "import mdnProperties from 'mdn-data/css/properties.json';", label: 'css-tree properties JSON import replacement' },
    { marker: "import mdnSyntaxes from 'mdn-data/css/syntaxes.json';", label: 'css-tree syntaxes JSON import replacement' },
    { marker: "import packageInfo from '../package.json';", label: 'css-tree package JSON import replacement' },
    { marker: "join(root, 'node_modules', 'jsdom', 'lib', 'jsdom', 'living', 'xhr', 'XMLHttpRequest-impl.js')", label: 'jsdom XHR source path' },
    { marker: 'const syncWorkerFile = require.resolve("./xhr-sync-worker.js");', label: 'jsdom sync worker path-leak source' },
    { marker: 'const syncWorkerFile = null;', label: 'jsdom sync worker path-leak replacement' },
    { marker: 'Synchronous XMLHttpRequest is not supported in Bun-compiled GoodVibes binaries.', label: 'sync XHR unsupported failure' },
    { marker: 'path.resolve(__dirname, "../../../browser/default-stylesheet.css")', label: 'jsdom stylesheet path-leak source' },
    { marker: 'const defaultStyleSheet = ${defaultStyleSheet};', label: 'inlined jsdom default stylesheet replacement' },
    { marker: "readFileSync(sqlWasmBinary).toString('base64')", label: 'sql.js wasm base64 read' },
    { marker: 'Buffer.from("${sqlWasmBase64}","base64")', label: 'sql.js wasm inline replacement' },
    { marker: 'if (source.includes(patch.to))', label: 'idempotent patch skip' },
    { marker: 'if (!source.includes(patch.from))', label: 'unexpected source shape check' },
    { marker: 'prebuild: skipped Bun compile compatibility patch for unexpected file shape', label: 'unexpected shape warning' },
    { marker: 'writeFileSync(patch.file, source.replace(patch.from, patch.to))', label: 'source patch write' },
    { marker: 'prebuild: patched Bun compile compatibility', label: 'successful patch diagnostic' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`Bun compile compatibility script must keep runtime bundling policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPostBuildSmokeScriptPolicy(root: string): readonly string[] {
  const smokeScriptPath = join(root, 'scripts', 'post-build-smoke.ts');
  if (!existsSync(smokeScriptPath)) return ['post-build smoke script is missing: scripts/post-build-smoke.ts.'];
  const issues: string[] = [];
  const source = readFileSync(smokeScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: "const binaryIndex = args.indexOf('--binary')", label: 'binary override argument' },
    { marker: "join(root, 'dist', 'goodvibes-agent')", label: 'default compiled Agent binary path' },
    { marker: 'existsSync(binary)', label: 'compiled binary existence check' },
    { marker: 'Binary not found', label: 'missing binary failure' },
    { marker: 'tmpdir()', label: 'isolated smoke temp parent' },
    { marker: 'goodvibes-agent-smoke-${process.pid}', label: 'isolated smoke temp directory' },
    { marker: 'rmSync(cwd, { recursive: true, force: true })', label: 'smoke temp cleanup' },
    { marker: 'mkdirSync(cwd, { recursive: true })', label: 'smoke temp setup' },
    { marker: "spawnSync(binary, ['--version']", label: 'compiled binary version smoke' },
    { marker: 'encoding: \'utf8\'', label: 'captured text output' },
    { marker: "stdio: ['ignore', 'pipe', 'pipe']", label: 'captured stdout/stderr' },
    { marker: 'result.status !== 0', label: 'failed version command detection' },
    { marker: '--version failed with status', label: 'failed version command diagnostic' },
    { marker: "output.includes('sqlite-vec')", label: 'sqlite-vec module-resolution leak guard' },
    { marker: "output.includes('$bunfs/root')", label: '$bunfs module-resolution leak guard' },
    { marker: 'compiled Agent emitted a sqlite-vec or $bunfs module-resolution error', label: 'module-resolution leak failure' },
    { marker: "result.stdout.trim().startsWith('goodvibes-agent ')", label: 'Agent version prefix assertion' },
    { marker: 'unexpected --version output', label: 'unexpected version output failure' },
    { marker: '[agent-smoke] PASS', label: 'smoke success summary' },
    { marker: '} finally {', label: 'smoke cleanup finally block' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`post-build smoke script must keep compiled binary smoke policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyRunTestsScriptPolicy(root: string): readonly string[] {
  const testScriptPath = join(root, 'scripts', 'run-tests.ts');
  if (!existsSync(testScriptPath)) return ['test runner script is missing: scripts/run-tests.ts.'];
  const issues: string[] = [];
  const source = readFileSync(testScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: "const SEARCH_ROOT = join(ROOT, 'src')", label: 'src test discovery root' },
    { marker: '\\.(test|spec)\\.(ts|tsx)$', label: 'test/spec file matcher' },
    { marker: "const TEST_TMP_ROOT = join(ROOT, '.test-tmp', 'suite')", label: 'isolated suite temp root' },
    { marker: 'function collectTests', label: 'recursive test discovery' },
    { marker: 'readdirSync(dir, { withFileTypes: true })', label: 'directory entry traversal' },
    { marker: 'entry.isDirectory()', label: 'recursive directory descent' },
    { marker: 'collectTests(fullPath, acc)', label: 'nested test collection' },
    { marker: 'entry.isFile() && TEST_FILE_RE.test(entry.name)', label: 'test file selection' },
    { marker: 'testFiles.sort((a, b) => a.localeCompare(b))', label: 'stable test order' },
    { marker: 'rmSync(TEST_TMP_ROOT, { recursive: true, force: true })', label: 'suite temp cleanup' },
    { marker: 'mkdirSync(TEST_TMP_ROOT, { recursive: true })', label: 'suite temp setup' },
    { marker: 'No test files found under src/', label: 'empty suite failure' },
    { marker: "Bun.spawnSync(['bun', 'test', '--max-concurrency=1', ...testFiles]", label: 'single serialized Bun test invocation over discovered suite' },
    { marker: 'TMPDIR: TEST_TMP_ROOT', label: 'TMPDIR isolation' },
    { marker: 'TMP: TEST_TMP_ROOT', label: 'TMP isolation' },
    { marker: 'TEMP: TEST_TMP_ROOT', label: 'TEMP isolation' },
    { marker: "stdio: ['inherit', 'inherit', 'inherit']", label: 'test output passthrough' },
    { marker: 'process.exit(result.exitCode ?? 1)', label: 'test exit code propagation' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`test runner script must keep branch-CI suite policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPrebuildScriptPolicy(root: string): readonly string[] {
  const prebuildScriptPath = join(root, 'scripts', 'prebuild.ts');
  if (!existsSync(prebuildScriptPath)) return ['prebuild script is missing: scripts/prebuild.ts.'];
  const issues: string[] = [];
  const source = readFileSync(prebuildScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'withWorkspaceLock', label: 'workspace lock import' },
    { marker: "withWorkspaceLock('sync project surfaces'", label: 'workspace-locked project surface sync' },
    { marker: 'patchBunCompileCompatibility(process.cwd())', label: 'Bun compile compatibility patch' },
    { marker: 'syncProjectSurfaces(process.cwd())', label: 'project surface sync call' },
    { marker: 'prebuild: failed', label: 'prebuild failure diagnostic' },
    { marker: 'process.exit(1)', label: 'prebuild failure exit' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`prebuild script must keep version-surface policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyProjectSurfacesScriptPolicy(root: string): readonly string[] {
  const projectSurfacesScriptPath = join(root, 'scripts', 'project-surfaces.ts');
  if (!existsSync(projectSurfacesScriptPath)) return ['project surfaces script is missing: scripts/project-surfaces.ts.'];
  const issues: string[] = [];
  const source = readFileSync(projectSurfacesScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'isExactSemver', label: 'exact semver verifier import' },
    { marker: 'readRequiredExactSemver', label: 'exact semver reader' },
    { marker: 'package.json version', label: 'package version source' },
    { marker: "readRequiredExactSemver(pkg.version, 'package.json version')", label: 'exact package version semver read' },
    { marker: "join(root, 'src', 'version.ts')", label: 'version fallback source path' },
    { marker: "let _version = '[^']*'", label: 'Agent version fallback pattern' },
    { marker: 'src/version.ts is missing the _version fallback literal', label: 'missing Agent fallback failure' },
    { marker: "versionTs.replace(versionFallbackPattern, `let _version = '${version}'`)", label: 'Agent version fallback write' },
    { marker: 'version-[0-9]+\\.[0-9]+\\.[0-9]+-blue\\.svg', label: 'README version badge pattern' },
    { marker: 'prebuild: done', label: 'project surface sync success summary' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`project surfaces script must keep version-surface policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyArchitectureCheckScriptPolicy(root: string): readonly string[] {
  const architectureScriptPath = join(root, 'scripts', 'check-architecture.ts');
  if (!existsSync(architectureScriptPath)) return ['architecture check script is missing: scripts/check-architecture.ts.'];
  const issues: string[] = [];
  const source = readFileSync(architectureScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'MAX_SOURCE_LINES = 800', label: 'source file size ceiling' },
    { marker: 'explicit any is forbidden', label: 'explicit any ban' },
    { marker: 'mock.module() is forbidden', label: 'process-global test mock ban' },
    { marker: 'no-goodvibes-tui-runtime-imports', label: 'GoodVibes TUI runtime import boundary rule' },
    { marker: 'Agent may copy/adapt TUI source, but runtime imports from goodvibes-tui/src are forbidden', label: 'GoodVibes TUI runtime import failure' },
    { marker: 'no-main-git-worktree-header-posture', label: 'coding-TUI header posture boundary rule' },
    { marker: 'Agent main shell must not surface coding-TUI git/worktree header posture', label: 'coding-TUI header posture failure' },
    { marker: 'no-default-browser-knowledge-client', label: 'default knowledge client boundary rule' },
    { marker: 'Agent client code must use the isolated browser/agent Knowledge client route', label: 'Agent Knowledge client route failure' },
    { marker: 'future-foundation-surfaces-no-server-or-shell-imports', label: 'foundation surface shell/server import rule' },
    { marker: 'future-server-surfaces-no-shell-imports', label: 'server surface shell import rule' },
    { marker: 'runtime knowledgeService compatibility alias must point at isolated Agent Knowledge', label: 'runtime Agent Knowledge alias requirement' },
    { marker: 'slash-command Knowledge API must be backed by isolated Agent Knowledge', label: 'slash command Agent Knowledge requirement' },
    { marker: 'CLI Knowledge commands must use the isolated browser/agent client route', label: 'CLI Agent Knowledge client requirement' },
    { marker: 'CLI Knowledge commands must validate Agent Knowledge response scope', label: 'CLI Agent Knowledge response scope validation requirement' },
    { marker: 'CLI Knowledge commands must reject non-Agent scope contamination', label: 'CLI Agent Knowledge scope contamination rejection requirement' },
    { marker: 'scope_contamination', label: 'CLI Agent Knowledge scope contamination failure kind' },
    { marker: '@pellux/goodvibes-sdk/browser/agent', label: 'Agent browser client entrypoint snippet' },
    { marker: 'CLI Knowledge commands must target the Agent-specific status route', label: 'CLI Agent Knowledge status route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific ask route', label: 'CLI Agent Knowledge ask route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific search route', label: 'CLI Agent Knowledge search route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific sources route', label: 'CLI Agent Knowledge sources route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific nodes route', label: 'CLI Agent Knowledge nodes route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific issues route', label: 'CLI Agent Knowledge issues route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific item route', label: 'CLI Agent Knowledge item route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific map route', label: 'CLI Agent Knowledge map route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific connector routes', label: 'CLI Agent Knowledge connector route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific connector detail route', label: 'CLI Agent Knowledge connector detail route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific connector doctor route', label: 'CLI Agent Knowledge connector doctor route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific URL ingest route', label: 'CLI Agent Knowledge URL ingest route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific artifact ingest route', label: 'CLI Agent Knowledge artifact ingest route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific URL-list ingest route', label: 'CLI Agent Knowledge URL-list ingest route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific bookmarks ingest route', label: 'CLI Agent Knowledge bookmarks ingest route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific browser-history ingest route', label: 'CLI Agent Knowledge browser-history ingest route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific connector ingest route', label: 'CLI Agent Knowledge connector ingest route requirement' },
    { marker: 'CLI Knowledge commands must target the Agent-specific reindex route', label: 'CLI Agent Knowledge reindex route requirement' },
    { marker: '/api/goodvibes-agent/knowledge/status', label: 'Agent Knowledge status route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ask', label: 'Agent Knowledge ask route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/search', label: 'Agent Knowledge search route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/sources', label: 'Agent Knowledge sources route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/nodes', label: 'Agent Knowledge nodes route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/issues', label: 'Agent Knowledge issues route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/items/{id}', label: 'Agent Knowledge item route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/map', label: 'Agent Knowledge map route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/connectors', label: 'Agent Knowledge connector route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/connectors/{id}', label: 'Agent Knowledge connector detail route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/connectors/{id}/doctor', label: 'Agent Knowledge connector doctor route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ingest/url', label: 'Agent Knowledge URL ingest route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ingest/artifact', label: 'Agent Knowledge artifact ingest route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ingest/urls', label: 'Agent Knowledge URL-list ingest route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ingest/bookmarks', label: 'Agent Knowledge bookmarks ingest route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ingest/browser-history', label: 'Agent Knowledge browser-history ingest route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/ingest/connector', label: 'Agent Knowledge connector ingest route snippet' },
    { marker: '/api/goodvibes-agent/knowledge/reindex', label: 'Agent Knowledge reindex route snippet' },
    { marker: 'GatewayMethodCatalog', label: 'operator contract catalog import' },
    { marker: "'control.contract'", label: 'control contract catalog requirement' },
    { marker: "'remote.node_host.contract'", label: 'remote node host contract catalog requirement' },
    { marker: 'isGenericObjectSchema(method.inputSchema)', label: 'generic input schema rejection' },
    { marker: 'isGenericObjectSchema(method.outputSchema)', label: 'generic output schema rejection' },
    { marker: 'Architecture check failed', label: 'architecture failure diagnostic' },
    { marker: 'process.exit(1)', label: 'architecture failure exit' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`architecture check script must keep Agent boundary policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyPerfCheckScriptPolicy(root: string): readonly string[] {
  const perfScriptPath = join(root, 'scripts', 'perf-check.ts');
  if (!existsSync(perfScriptPath)) return ['performance check script is missing: scripts/perf-check.ts.'];
  const issues: string[] = [];
  const source = readFileSync(perfScriptPath, 'utf-8');
  const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'PerfMonitor', label: 'performance monitor evaluation' },
    { marker: 'formatReport', label: 'formatted budget report output' },
    { marker: 'DEFAULT_BUDGETS', label: 'budget threshold source' },
    { marker: 'exitCode', label: 'budget failure exit policy' },
    { marker: 'createInitialSurfacePerfState', label: 'surface performance state defaults' },
    { marker: 'PerfSnapshot', label: 'typed performance snapshot' },
    { marker: 'buildCiSnapshot', label: 'CI performance snapshot builder' },
    { marker: 'RECORDED_PERF_SNAPSHOT_RELATIVE_PATH', label: 'recorded performance fixture path constant' },
    { marker: 'release/performance-snapshot.json', label: 'release performance fixture path' },
    { marker: 'readCiPerfSnapshot', label: 'recorded performance fixture reader' },
    { marker: 'parseRenderCycles', label: 'render sample parser' },
    { marker: 'parseExtraMetrics', label: 'extra metric parser' },
    { marker: 'LOWER_BOUND_METRIC_NAMES', label: 'lower-bound metric registry' },
    { marker: 'applyAgentPerfBudgetPolicy', label: 'Agent directional budget policy' },
    { marker: 'formatAgentPerfReport', label: 'Agent threshold-aware budget report formatter' },
    { marker: 'extraMetrics: Record<string, number>', label: 'extra metrics map' },
    { marker: "'event.queue.depth'", label: 'event queue depth metric' },
    { marker: "'tool.executor.overhead.p95'", label: 'tool executor overhead metric' },
    { marker: "'compaction.latency.p95'", label: 'compaction latency metric' },
    { marker: "'slo.turn_start.p95'", label: 'turn start SLO metric' },
    { marker: "'slo.cancel.p95'", label: 'cancel SLO metric' },
    { marker: "'slo.reconnect_recovery.p95'", label: 'reconnect recovery SLO metric' },
    { marker: "'slo.permission_decision.p95'", label: 'permission decision SLO metric' },
    { marker: "'slo.integration.delivery_success_rate'", label: 'integration delivery success metric' },
    { marker: "'slo.integration.dlq_depth'", label: 'integration DLQ depth metric' },
    { marker: 'return { surfacePerf, extraMetrics }', label: 'complete performance snapshot return' },
    { marker: 'monitor.evaluate(snapshot)', label: 'budget evaluation call' },
    { marker: 'const agentReport = applyAgentPerfBudgetPolicy(report)', label: 'Agent directional budget policy application' },
    { marker: 'process.stdout.write(formatAgentPerfReport(agentReport))', label: 'budget report stdout output' },
    { marker: 'process.exit(exitCode(agentReport))', label: 'budget gate exit code' },
    { marker: 'if (import.meta.main)', label: 'import-safe script entrypoint guard' },
    { marker: 'main();', label: 'script entrypoint execution' },
  ];
  for (const { marker, label } of requiredMarkers) {
    if (!source.includes(marker)) {
      issues.push(`performance check script must keep budget policy marker: ${label}.`);
    }
  }
  return issues;
}

function verifyVerificationLedgerPolicy(root: string): readonly string[] {
  const ledgerScriptPath = join(root, 'scripts', 'verification-ledger.ts');
  const ledgerSourcePath = join(root, 'src', 'verification', 'verification-ledger.ts');
  const ledgerSurfacesPath = join(root, 'src', 'verification', 'verification-ledger-surfaces.ts');
  const issues: string[] = [];
  if (!existsSync(ledgerScriptPath)) {
    issues.push('verification ledger script is missing: scripts/verification-ledger.ts.');
  } else {
    const source = readFileSync(ledgerScriptPath, 'utf-8');
    const requiredScriptMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'buildVerificationLedger', label: 'ledger builder import' },
      { marker: 'renderVerificationLedgerMarkdown', label: 'ledger Markdown renderer import' },
      { marker: 'readArgValue(args, \'--out\')', label: 'ledger output directory argument' },
      { marker: "args.includes('--json')", label: 'ledger JSON output mode' },
      { marker: "join(outputDir, 'verification-ledger.json')", label: 'ledger JSON artifact path' },
      { marker: "join(outputDir, 'verification-ledger.md')", label: 'ledger Markdown artifact path' },
      { marker: 'JSON.stringify(ledger, null, 2)', label: 'pretty JSON ledger output' },
      { marker: 'renderVerificationLedgerMarkdown(ledger)', label: 'Markdown ledger output' },
      { marker: "resolve(join(import.meta.dir, '..'))", label: 'repository-root ledger inventory' },
      { marker: 'Usage: bun run scripts/verification-ledger.ts [options]', label: 'ledger CLI help' },
    ];
    for (const { marker, label } of requiredScriptMarkers) {
      if (!source.includes(marker)) {
        issues.push(`verification ledger script must keep release evidence policy marker: ${label}.`);
      }
    }
  }
  if (!existsSync(ledgerSourcePath)) {
    issues.push('verification ledger source is missing: src/verification/verification-ledger.ts.');
  }
  if (!existsSync(ledgerSurfacesPath)) {
    issues.push('verification ledger surface inventory source is missing: src/verification/verification-ledger-surfaces.ts.');
  }
  if (existsSync(ledgerSourcePath) && existsSync(ledgerSurfacesPath)) {
    const source = [
      readFileSync(ledgerSourcePath, 'utf-8'),
      readFileSync(ledgerSurfacesPath, 'utf-8'),
    ].join('\n');
    const requiredSourceMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'CONFIG_SCHEMA', label: 'settings schema inventory source' },
      { marker: 'FEATURE_FLAG_MAP', label: 'feature flag inventory source' },
      { marker: 'CommandRegistry', label: 'slash command registry inventory source' },
      { marker: 'registerBuiltinCommands', label: 'builtin slash command registration source' },
      { marker: 'countBuiltinPanels(root)', label: 'builtin panel inventory source' },
      { marker: 'listCliCommands(root)', label: 'top-level CLI command inventory source' },
      { marker: 'GoodVibesCliCommand', label: 'CLI command type inventory source' },
      { marker: 'EXTERNAL_SLASH_COMMANDS', label: 'external slash command accounting' },
      { marker: 'EXTERNAL_CLI_COMMANDS', label: 'external CLI command accounting' },
      { marker: 'ONBOARDING_CAPABILITIES', label: 'onboarding capability inventory' },
      { marker: 'EXTERNAL_SURFACES', label: 'external surface inventory' },
      { marker: 'RELEASE_EVIDENCE_PATHS', label: 'release evidence artifact inventory' },
      { marker: 'HARNESS_RELEASE_EVIDENCE_MODES', label: 'release evidence harness mode inventory' },
      { marker: 'HARNESS_SERVICE_POSTURE_MODES', label: 'service posture harness mode inventory' },
      { marker: 'HARNESS_CHANNEL_READINESS_MODES', label: 'channel readiness harness mode inventory' },
      { marker: 'HARNESS_NOTIFICATION_TARGET_MODES', label: 'notification target harness mode inventory' },
      { marker: 'HARNESS_PROVIDER_ACCOUNT_MODES', label: 'provider account harness mode inventory' },
      { marker: 'HARNESS_MCP_SERVER_MODES', label: 'MCP server harness mode inventory' },
      { marker: 'HARNESS_SETUP_POSTURE_MODES', label: 'setup/onboarding harness mode inventory' },
      { marker: 'HARNESS_MODEL_ROUTING_MODES', label: 'model routing harness mode inventory' },
      { marker: 'HARNESS_PAIRING_POSTURE_MODES', label: 'pairing harness mode inventory' },
      { marker: 'HARNESS_DELEGATION_POSTURE_MODES', label: 'delegation harness mode inventory' },
      { marker: 'HARNESS_SECURITY_SUPPORT_MODES', label: 'security/support harness mode inventory' },
      { marker: 'HARNESS_MEDIA_POSTURE_MODES', label: 'voice/media posture harness mode inventory' },
      { marker: 'HARNESS_SESSION_MODES', label: 'session/bookmark harness mode inventory' },
      { marker: 'HARNESS_OPERATOR_METHOD_MODES', label: 'operator method harness mode inventory' },
      { marker: 'HARNESS_MODE_CATALOG_MODES', label: 'harness mode catalog inventory' },
      { marker: 'HARNESS_MODE_CATALOG_MARKERS', label: 'harness mode catalog behavior markers' },
      { marker: 'QUALITY_DIMENSIONS', label: 'release quality readiness dimensions inventory' },
      { marker: "'release/live-verification/live-verification.md'", label: 'live verification Markdown evidence artifact' },
      { marker: "'release_evidence_artifact'", label: 'single release evidence artifact mode' },
      { marker: "'service_endpoint'", label: 'single service endpoint mode' },
      { marker: "'channel'", label: 'single channel readiness mode' },
      { marker: "'notification_target'", label: 'single notification target mode' },
      { marker: "'provider_account'", label: 'single provider account mode' },
      { marker: "'mcp_server'", label: 'single MCP server mode' },
      { marker: "'setup_item'", label: 'single setup item mode' },
      { marker: "'model_route'", label: 'single model route mode' },
      { marker: "'pairing_route'", label: 'single pairing route mode' },
      { marker: "'delegation_route'", label: 'single delegation route mode' },
      { marker: "'security_finding'", label: 'single security finding mode' },
      { marker: "'support_bundle'", label: 'single support bundle mode' },
      { marker: "'media_provider'", label: 'single voice/media provider mode' },
      { marker: "'session'", label: 'single saved session mode' },
      { marker: "'operator_method'", label: 'single operator method mode' },
      { marker: "'modes'", label: 'harness mode catalog discovery mode' },
      { marker: "'mode'", label: 'single harness mode inspection mode' },
      { marker: "join('release', 'release-readiness.json')", label: 'release readiness inventory ledger source' },
      { marker: 'countReleaseEvidenceSurface(root)', label: 'model-visible release evidence ledger source' },
      { marker: 'countServicePostureSurface(root)', label: 'model-visible service posture ledger source' },
      { marker: 'countChannelReadinessSurface(root)', label: 'model-visible channel readiness ledger source' },
      { marker: 'countNotificationTargetSurface(root)', label: 'model-visible notification target ledger source' },
      { marker: 'countProviderAccountSurface(root)', label: 'model-visible provider account ledger source' },
      { marker: 'countMcpServerSurface(root)', label: 'model-visible MCP server ledger source' },
      { marker: 'countSetupPostureSurface(root)', label: 'model-visible setup/onboarding ledger source' },
      { marker: 'countModelRoutingSurface(root)', label: 'model-visible model routing ledger source' },
      { marker: 'countPairingPostureSurface(root)', label: 'model-visible pairing ledger source' },
      { marker: 'countDelegationPostureSurface(root)', label: 'model-visible delegation ledger source' },
      { marker: 'countSecuritySupportSurface(root)', label: 'model-visible security/support ledger source' },
      { marker: 'countMediaPostureSurface(root)', label: 'model-visible voice/media posture ledger source' },
      { marker: 'countSessionSurface(root)', label: 'model-visible session/bookmark ledger source' },
      { marker: 'countOperatorMethodSurface(root)', label: 'model-visible operator method catalog ledger source' },
      { marker: 'countHarnessModeCatalogSurface(root)', label: 'model-visible harness mode catalog ledger source' },
      { marker: 'countQualityReadinessDimensions(root)', label: 'release quality readiness ledger source' },
      { marker: 'Settings schema and persistence', label: 'settings ledger area' },
      { marker: 'Feature flags', label: 'feature flag ledger area' },
      { marker: 'Slash commands', label: 'slash command ledger area' },
      { marker: 'Built-in panels', label: 'panel ledger area' },
      { marker: 'Top-level CLI commands', label: 'CLI ledger area' },
      { marker: 'External surfaces', label: 'external surface ledger area' },
      { marker: 'Onboarding capability bundles', label: 'onboarding ledger area' },
      { marker: 'Model-visible release evidence bundle', label: 'model-visible release evidence ledger area' },
      { marker: 'Model-visible service posture', label: 'model-visible service posture ledger area' },
      { marker: 'Model-visible channel readiness', label: 'model-visible channel readiness ledger area' },
      { marker: 'Model-visible notification targets', label: 'model-visible notification target ledger area' },
      { marker: 'Model-visible provider accounts', label: 'model-visible provider account ledger area' },
      { marker: 'Model-visible MCP servers', label: 'model-visible MCP server ledger area' },
      { marker: 'Model-visible setup and onboarding posture', label: 'model-visible setup/onboarding ledger area' },
      { marker: 'Model-visible model routing posture', label: 'model-visible model routing ledger area' },
      { marker: 'Model-visible pairing posture', label: 'model-visible pairing ledger area' },
      { marker: 'Model-visible delegation posture', label: 'model-visible delegation ledger area' },
      { marker: 'Model-visible security and support bundles', label: 'model-visible security/support ledger area' },
      { marker: 'Model-visible voice and media posture', label: 'model-visible voice/media posture ledger area' },
      { marker: 'Model-visible sessions and bookmarks', label: 'model-visible session/bookmark ledger area' },
      { marker: 'Model-visible operator method catalog', label: 'model-visible operator method catalog ledger area' },
      { marker: 'Model-visible harness mode catalog', label: 'model-visible harness mode catalog ledger area' },
      { marker: 'Release quality readiness dimensions', label: 'release quality readiness ledger area' },
      { marker: 'localSignalVerified', label: 'local signal count' },
      { marker: 'localBehaviorVerified', label: 'local behavior count' },
      { marker: 'externalOutcomeRequired', label: 'external outcome count' },
      { marker: 'localSignalPercent: percent(localSignalVerified, total)', label: 'local signal percentage' },
      { marker: 'localBehaviorPercent: percent(localBehaviorVerified, total)', label: 'local behavior percentage' },
      { marker: '# GoodVibes Verification Ledger', label: 'ledger Markdown title' },
      { marker: '| Area | Total | Local verification signal | Local behavior | External outcome required | Notes |', label: 'ledger Markdown table columns' },
      { marker: 'Local verification signal means', label: 'ledger local signal definition' },
      { marker: 'Local behavior verified means', label: 'ledger local behavior definition' },
    ];
    for (const { marker, label } of requiredSourceMarkers) {
      if (!source.includes(marker)) {
        issues.push(`verification ledger source must keep release evidence policy marker: ${label}.`);
      }
    }
  }
  return issues;
}

function verifyLiveVerificationPolicy(root: string): readonly string[] {
  const liveScriptPath = join(root, 'scripts', 'verify-live.ts');
  const liveSourcePath = join(root, 'src', 'verification', 'live-verifier.ts');
  const issues: string[] = [];
  if (!existsSync(liveScriptPath)) {
    issues.push('live verification script is missing: scripts/verify-live.ts.');
  } else {
    const source = readFileSync(liveScriptPath, 'utf-8');
    const requiredScriptMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'buildLiveVerificationReport', label: 'live report builder import' },
      { marker: 'renderLiveVerificationReportMarkdown', label: 'live Markdown renderer import' },
      { marker: 'writeLiveVerificationReportFiles', label: 'live report file writer import' },
      { marker: "readArgValue(args, '--home')", label: 'home directory argument' },
      { marker: "readArgValue(args, '--binary')", label: 'compiled binary argument' },
      { marker: "readArgValue(args, '--connected-host-url')", label: 'connected-host URL argument' },
      { marker: "readArgValue(args, '--runtime-url')", label: 'runtime URL compatibility alias' },
      { marker: "readArgValue(args, '--daemon-url')", label: 'daemon URL compatibility alias' },
      { marker: "process.env.GOODVIBES_HOME", label: 'GoodVibes home environment fallback' },
      { marker: "join(resolve(join(import.meta.dir, '..')), 'dist', 'goodvibes-agent')", label: 'default compiled Agent binary path' },
      { marker: "args.includes('--strict')", label: 'strict mode argument' },
      { marker: "readArgValue(args, '--out')", label: 'live report output directory argument' },
      { marker: "args.includes('--json')", label: 'live JSON output mode' },
      { marker: 'JSON.stringify(report, null, 2)', label: 'pretty JSON live report output' },
      { marker: 'renderLiveVerificationReportMarkdown(report)', label: 'Markdown live report output' },
      { marker: 'process.exit(report.ok ? 0 : 1)', label: 'live verification exit status' },
      { marker: 'Usage: bun run scripts/verify-live.ts [options]', label: 'live verifier CLI help' },
    ];
    for (const { marker, label } of requiredScriptMarkers) {
      if (!source.includes(marker)) {
        issues.push(`live verification script must keep external-outcome policy marker: ${label}.`);
      }
    }
  }
  if (!existsSync(liveSourcePath)) {
    issues.push('live verification source is missing: src/verification/live-verifier.ts.');
  } else {
    const source = readFileSync(liveSourcePath, 'utf-8');
    const requiredSourceMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'AGENT_KNOWLEDGE_FORBIDDEN_RESPONSE_MARKERS', label: 'Agent Knowledge contamination markers' },
      { marker: 'AGENT_KNOWLEDGE_FORBIDDEN_RESPONSE_PATTERNS', label: 'Agent Knowledge structured contamination patterns' },
      { marker: 'findAgentKnowledgeResponseContamination', label: 'Agent Knowledge response contamination helper' },
      { marker: 'findAgentKnowledgeScopeContamination', label: 'Agent Knowledge shared scope contamination helper' },
      { marker: 'spaceId', label: 'Agent Knowledge default scope id rejection marker' },
      { marker: 'knowledgeSpaceId', label: 'Agent Knowledge default knowledge scope id rejection marker' },
      { marker: 'readConnectedHostToken', label: 'connected-host token reader' },
      { marker: 'GOODVIBES_CONNECTED_HOST_TOKEN', label: 'connected-host token environment source' },
      { marker: 'GOODVIBES_DAEMON_TOKEN', label: 'daemon token compatibility source' },
      { marker: "join(homeDir, 'daemon', 'operator-tokens.json')", label: 'connected-host token file source' },
      { marker: 'redactForReleaseArtifact', label: 'release artifact redaction helper' },
      { marker: 'redactLocalPaths', label: 'local path redaction helper' },
      { marker: 'redactPrivateNetworkAddresses', label: 'private network address redaction helper' },
      { marker: 'sanitizeLiveVerificationReport', label: 'sanitized live verification report output' },
      { marker: "homeDir: '[goodvibes-home]'", label: 'sanitized GoodVibes home label' },
      { marker: "binaryPath: '[agent-binary]'", label: 'sanitized binary path label' },
      { marker: 'connectedHostBaseUrl: redactForReleaseArtifact(report.connectedHostBaseUrl, context)', label: 'sanitized connected-host URL' },
      { marker: 'resolveConnectedHostBaseUrl', label: 'connected-host URL resolver' },
      { marker: 'GOODVIBES_CONNECTED_HOST_URL', label: 'connected-host URL environment source' },
      { marker: 'GOODVIBES_AGENT_RUNTIME_URL', label: 'Agent runtime URL environment source' },
      { marker: 'GOODVIBES_DAEMON_URL', label: 'daemon URL compatibility source' },
      { marker: "join(homeDir, 'tui', 'settings.json')", label: 'connected-host port settings source' },
      { marker: 'function runCommand(', label: 'compiled CLI command runner' },
      { marker: "NO_COLOR: '1'", label: 'stable no-color command output' },
      { marker: 'options.timeoutMs ?? 15_000', label: 'compiled CLI command timeout' },
      { marker: "child.kill('SIGTERM')", label: 'timed-out command termination' },
      { marker: "child.kill('SIGKILL')", label: 'timed-out command kill fallback' },
      { marker: 'commandCheck', label: 'compiled CLI command check helper' },
      { marker: 'parseJson?: boolean', label: 'JSON command validation option' },
      { marker: 'warnOnNonZero?: boolean', label: 'warning-on-nonzero command option' },
      { marker: 'fetchCheck', label: 'connected-host fetch check helper' },
      { marker: 'fetchJsonCheck', label: 'connected-host JSON fetch check helper' },
      { marker: 'Authorization: `Bearer ${token}`', label: 'bearer token handoff' },
      { marker: 'AbortSignal.timeout(5000)', label: 'connected-host request timeout' },
      { marker: "'Content-Type': 'application/json'", label: 'JSON request content type' },
      { marker: 'buildVerificationLedger(projectRoot)', label: 'verification ledger live check' },
      { marker: 'localSignalPercent >= 90', label: 'minimum local verification signal threshold' },
      { marker: "'compiled-cli-present'", label: 'compiled binary presence check' },
      { marker: "'cli-version'", label: 'compiled CLI version check' },
      { marker: "'cli-status-json'", label: 'compiled CLI status JSON check' },
      { marker: 'Status JSON command completed; provider/model identifiers omitted from release artifact', label: 'status release artifact omission' },
      { marker: "'cli-compat-json'", label: 'compiled CLI compatibility JSON check' },
      { marker: "'cli-agent-knowledge-status'", label: 'compiled Agent Knowledge CLI status check' },
      { marker: "'cli-providers'", label: 'compiled providers command check' },
      { marker: 'provider names and credential posture omitted from release artifact', label: 'provider inventory release artifact omission' },
      { marker: "'cli-doctor'", label: 'compiled doctor command check' },
      { marker: 'Doctor command completed without findings; provider/model identifiers and credential posture omitted from release artifact', label: 'doctor release artifact omission' },
      { marker: "'connected-host-status'", label: 'connected-host status check' },
      { marker: '`${connectedHostBaseUrl}/status`', label: 'connected-host status route' },
      { marker: "'connected-host-health'", label: 'connected-host health check' },
      { marker: '`${connectedHostBaseUrl}/api/health`', label: 'connected-host health route' },
      { marker: "'openai-compatible-models'", label: 'OpenAI-compatible models check' },
      { marker: '`${connectedHostBaseUrl}/v1/models`', label: 'OpenAI-compatible models route' },
      { marker: 'model identifiers omitted from release artifact', label: 'model inventory release artifact omission' },
      { marker: 'findAgentKnowledgeResponseContamination', label: 'no fallback Agent Knowledge contamination policy' },
      { marker: '`${connectedHostBaseUrl}/api/goodvibes-agent/knowledge/status`', label: 'Agent Knowledge status route' },
      { marker: '`${connectedHostBaseUrl}/api/goodvibes-agent/knowledge/ask`', label: 'Agent Knowledge ask route' },
      { marker: '`${connectedHostBaseUrl}/api/goodvibes-agent/knowledge/search`', label: 'Agent Knowledge search route' },
      { marker: "route: '/api/goodvibes-agent/knowledge/sources'", label: 'Agent Knowledge sources route' },
      { marker: "route: '/api/goodvibes-agent/knowledge/nodes'", label: 'Agent Knowledge nodes route' },
      { marker: "route: '/api/goodvibes-agent/knowledge/issues'", label: 'Agent Knowledge issues route' },
      { marker: "route: '/api/goodvibes-agent/knowledge/map'", label: 'Agent Knowledge map route' },
      { marker: "route: '/api/goodvibes-agent/knowledge/connectors'", label: 'Agent Knowledge connectors route' },
      { marker: 'includeSources: true', label: 'Agent Knowledge ask sources option' },
      { marker: 'includeConfidence: true', label: 'Agent Knowledge ask confidence option' },
      { marker: 'includeLinkedObjects: true', label: 'Agent Knowledge ask linked objects option' },
      { marker: 'non-Agent knowledge contamination', label: 'Agent Knowledge contamination failure' },
      { marker: 'counts.fail === 0 && (!options.strict || counts.warn === 0)', label: 'strict live verification result policy' },
      { marker: '# GoodVibes Agent Live Verification', label: 'live Markdown title' },
      { marker: 'Result: PASS', label: 'live Markdown pass result' },
      { marker: 'Result: FAIL', label: 'live Markdown fail result' },
      { marker: "join(outputDir, 'live-verification.json')", label: 'live JSON artifact path' },
      { marker: "join(outputDir, 'live-verification.md')", label: 'live Markdown artifact path' },
    ];
    for (const { marker, label } of requiredSourceMarkers) {
      if (!source.includes(marker)) {
        issues.push(`live verification source must keep external-outcome policy marker: ${label}.`);
      }
    }
  }
  return issues;
}

function readPackageFacingVersionPins(root: string): { readonly pins: PackageFacingVersionPins | null; readonly failures: readonly string[] } {
  if (!existsSync(join(root, 'package.json'))) return { pins: null, failures: [] };
  const failures: string[] = [];
  const pkg = readPackageJson(root);
  const packageVersion = typeof pkg.version === 'string' ? pkg.version : '';
  const bunVersion = readPackageManagerBunVersion(pkg);
  if (packageVersion.length === 0 || !isExactSemver(packageVersion)) {
    failures.push('package-facing text policy could not read an exact package.json version.');
  }
  if (bunVersion.length === 0 || !isExactSemver(bunVersion)) {
    failures.push('package-facing text policy could not read an exact packageManager Bun version.');
  }
  if (failures.length > 0) return { pins: null, failures };
  return { pins: { packageVersion, bunVersion }, failures };
}

function readVersionFallbacks(root: string): { readonly version: string | null } | null {
  const versionPath = join(root, 'src', 'version.ts');
  if (!existsSync(versionPath)) return null;
  const source = readFileSync(versionPath, 'utf-8');
  return {
    version: /let _version = '([^']*)'/.exec(source)?.[1] ?? null,
  };
}

function listFilesUnder(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  const entries = readdirSync(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesUnder(childPath));
      continue;
    }
    if (entry.isFile()) files.push(childPath);
  }
  return files;
}

export function verifySourcePackageBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  const exampleFiles = listFilesUnder(join(root, 'examples'));
  if (exampleFiles.length > 0) {
    issues.push(`repo-facing copied foundation examples are not part of GoodVibes Agent:\n${exampleFiles.join('\n')}`);
  }

  const tsconfigPath = join(root, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    issues.push('tsconfig.json is missing from the Agent source tree.');
  } else {
    const tsconfigText = readFileSync(tsconfigPath, 'utf-8');
    if (tsconfigText.includes('examples')) {
      issues.push('tsconfig.json must not include copied foundation examples in the Agent typecheck surface.');
    }
  }

  return issues;
}

function relativeSourcePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function modelToolDescriptionSourcePaths(root: string): readonly string[] {
  return listFilesUnder(join(root, 'src', 'tools'))
    .filter((path) => (
      path.endsWith('-tool.ts')
      || path.endsWith('agent-harness-tool-schema.ts')
      || path.endsWith('agent-tool-policy-guard.ts')
    ))
    .sort();
}

function harnessCatalogRouteSourcePaths(root: string): readonly string[] {
  return [
    ...listFilesUnder(join(root, 'src', 'tools'))
      .filter((path) => path.includes('/agent-harness-') && path.endsWith('.ts')),
    join(root, 'src', 'agent', 'harness-control.ts'),
    join(root, 'src', 'input', 'agent-workspace-categories.ts'),
  ].filter((path) => existsSync(path)).sort();
}

function extractJoinedDescriptionText(block: string): string {
  return [...block.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)]
    .map((match) => (match[2] ?? '').replace(/\\(['"`\\])/g, '$1'))
    .join(' ');
}

function verifyModelToolDescriptionPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  for (const path of modelToolDescriptionSourcePaths(root)) {
    const source = readFileSync(path, 'utf-8');
    const relativePath = relativeSourcePath(root, path);
    for (const match of source.matchAll(/description:\s*\[([\s\S]*?)\]\.join\(' '\)/g)) {
      const text = extractJoinedDescriptionText(match[1] ?? '');
      if (text.length > MODEL_TOOL_DESCRIPTION_MAX_LENGTH) {
        issues.push(`model tool ${relativePath}:${lineNumberForIndex(source, match.index ?? 0)} registration description is ${text.length} characters; keep it at or below ${MODEL_TOOL_DESCRIPTION_MAX_LENGTH}.`);
      }
    }
    for (const match of source.matchAll(/description:\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      const text = (match[2] ?? '').replace(/\\(['"`\\])/g, '$1');
      if (text.length > MODEL_TOOL_SCHEMA_DESCRIPTION_MAX_LENGTH) {
        issues.push(`model tool ${relativePath}:${lineNumberForIndex(source, match.index ?? 0)} schema description is ${text.length} characters; keep it at or below ${MODEL_TOOL_SCHEMA_DESCRIPTION_MAX_LENGTH}.`);
      }
    }
  }
  return issues;
}

function verifyHarnessModeRouteReferences(root: string): readonly string[] {
  const issues: string[] = [];
  for (const path of harnessCatalogRouteSourcePaths(root)) {
    const source = readFileSync(path, 'utf-8');
    const relativePath = relativeSourcePath(root, path);
    for (const match of source.matchAll(/mode:\\?["']([a-z_]+)\\?["']/g)) {
      const mode = match[1] ?? '';
      if (!AGENT_HARNESS_MODE_SET.has(mode)) {
        issues.push(`harness catalog ${relativePath}:${lineNumberForIndex(source, match.index ?? 0)} references unknown agent_harness mode:"${mode}".`);
      }
    }
    for (const call of source.matchAll(/\bagentHarnessModes\(([^)]*)\)/g)) {
      const callSource = call[1] ?? '';
      for (const modeMatch of callSource.matchAll(/['"]([a-z_]+)['"]/g)) {
        const mode = modeMatch[1] ?? '';
        if (!AGENT_HARNESS_MODE_SET.has(mode)) {
          issues.push(`harness catalog ${relativePath}:${lineNumberForIndex(source, call.index ?? 0)} references unknown agent_harness mode:"${mode}".`);
        }
      }
    }
  }
  return issues;
}

function verifyHarnessModeCatalogDescriptionPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  const relativePaths = [
    'src/tools/agent-harness-mode-catalog.ts',
    'src/tools/agent-harness-command-catalog.ts',
    'src/tools/agent-harness-model-tool-catalog.ts',
    'src/tools/agent-harness-panel-metadata.ts',
    'src/tools/agent-harness-ui-surface-metadata.ts',
    'src/tools/agent-harness-workspace-actions.ts',
    'src/input/agent-workspace-categories.ts',
    'src/agent/harness-control.ts',
  ] as const;
  for (const relativePath of relativePaths) {
    const path = join(root, relativePath);
    if (!existsSync(path)) {
      issues.push(`harness catalog source is missing: ${relativePath}.`);
      continue;
    }
    const source = readFileSync(path, 'utf-8');
    if (relativePath === 'src/tools/agent-harness-mode-catalog.ts') {
      if (!source.includes('modelRoute: `agent_harness mode:"${descriptor.id}"`')) {
        issues.push('release harness mode catalog must expose a compact modelRoute for every mode descriptor.');
      }
      const descriptorModeCounts = new Map<string, number>();
      for (const match of source.matchAll(/\bid:\s*(['"])([a-z_]+)\1/g)) {
        const mode = match[2] ?? '';
        descriptorModeCounts.set(mode, (descriptorModeCounts.get(mode) ?? 0) + 1);
      }
      for (const mode of AGENT_HARNESS_MODES) {
        if (!descriptorModeCounts.has(mode)) {
          issues.push(`release harness mode catalog must describe agent_harness mode:"${mode}".`);
        }
      }
      for (const [mode, count] of descriptorModeCounts) {
        if (!AGENT_HARNESS_MODE_SET.has(mode)) {
          issues.push(`release harness mode catalog references unknown agent_harness mode:"${mode}".`);
        }
        if (count > 1) {
          issues.push(`release harness mode catalog duplicates agent_harness mode:"${mode}".`);
        }
      }
    }
    for (const match of source.matchAll(/\b(summary|next):\s*(['"])((?:\\.|(?!\2).)*)\2/g)) {
      const property = match[1] ?? 'text';
      const text = (match[3] ?? '').replace(/\\(['"`\\])/g, '$1');
      if (text.length > MODEL_TOOL_DESCRIPTION_MAX_LENGTH) {
        issues.push(`harness mode catalog ${relativePath}:${lineNumberForIndex(source, match.index ?? 0)} ${property} is ${text.length} characters; keep it at or below ${MODEL_TOOL_DESCRIPTION_MAX_LENGTH}.`);
      }
    }
    for (const match of source.matchAll(/function previewText\([^)]*maxLength\s*=\s*(\d+)/g)) {
      const limit = Number(match[1] ?? 0);
      if (limit > MODEL_TOOL_DESCRIPTION_MAX_LENGTH) {
        issues.push(`harness catalog ${relativePath}:${lineNumberForIndex(source, match.index ?? 0)} previewText default is ${limit}; keep it at or below ${MODEL_TOOL_DESCRIPTION_MAX_LENGTH}.`);
      }
    }
  }
  issues.push(...verifyHarnessModeRouteReferences(root));
  return issues;
}

function verifyHarnessModeRuntimePolicy(root: string): readonly string[] {
  const relativePath = 'src/tools/agent-harness-tool.ts';
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    return [`harness runtime source is missing: ${relativePath}.`];
  }

  const source = readFileSync(path, 'utf-8');
  const requiredRuntimeMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'function compactHarnessModeGuide()', label: 'compact summary guide' },
    { marker: 'function harnessModeIdsByKind', label: 'descriptor-derived mode guide groups' },
    { marker: "start: ['summary', 'modes', 'mode']", label: 'summary/mode start guide' },
    { marker: "discover: harnessModeIdsByKind('discover')", label: 'discover guide from descriptors' },
    { marker: "inspect: harnessModeIdsByKind('inspect')", label: 'inspect guide from descriptors' },
    { marker: "effects: harnessModeIdsByKind('effect')", label: 'effect guide from descriptors' },
    { marker: "aliases: harnessModeIdsByKind('alias')", label: 'alias guide from descriptors' },
  ];
  const issues: string[] = [];
  for (const { marker, label } of requiredRuntimeMarkers) {
    if (!source.includes(marker)) {
      issues.push(`release agent_harness runtime must keep ${label}.`);
    }
  }
  const handledModeCounts = new Map<string, number>();
  for (const match of source.matchAll(/\bargs\.mode\s*===\s*(['"])([a-z_]+)\1/g)) {
    const mode = match[2] ?? '';
    handledModeCounts.set(mode, (handledModeCounts.get(mode) ?? 0) + 1);
  }

  for (const mode of AGENT_HARNESS_MODES) {
    if (!handledModeCounts.has(mode)) {
      issues.push(`release agent_harness dispatcher must handle mode:"${mode}".`);
    }
  }
  for (const [mode, count] of handledModeCounts) {
    if (!AGENT_HARNESS_MODE_SET.has(mode)) {
      issues.push(`release agent_harness dispatcher references unknown mode:"${mode}".`);
    }
    if (count > 1) {
      issues.push(`release agent_harness dispatcher duplicates mode:"${mode}".`);
    }
  }
  return issues;
}

function verifyCommandModelAccessPolicy(): readonly string[] {
  const issues: string[] = [];
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);

  for (const command of registry.list()) {
    const policy = describeCommandPolicy(command.name);
    if (policy.effect === 'unknown') {
      issues.push(`release slash command /${command.name} must have concrete model policy effect.`);
    }
    if (!policy.preferredModelTool) {
      issues.push(`release slash command /${command.name} must expose a preferred model route.`);
    }
    if (/agent_harness (?!mode:")/.test(policy.preferredModelTool ?? '')) {
      issues.push(`release slash command /${command.name} uses stale agent_harness route syntax.`);
    }
  }

  for (const command of listGoodVibesCliCommands().filter((entry) => entry !== 'unknown')) {
    const policy = describeCliCommandPolicy(command);
    if (policy.effect === 'unknown') {
      issues.push(`release CLI command ${command} must have concrete model policy effect.`);
    }
    if (!policy.preferredModelTool) {
      issues.push(`release CLI command ${command} must expose a preferred model route or explicit current-conversation route.`);
    }
    if (/agent_harness (?!mode:")/.test(policy.preferredModelTool ?? '')) {
      issues.push(`release CLI command ${command} uses stale agent_harness route syntax.`);
    }
  }

  return issues;
}

function verifyHarnessSettingsModelAccessPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  const harnessControlPath = join(root, 'src', 'agent', 'harness-control.ts');
  const harnessToolPath = join(root, 'src', 'tools', 'agent-harness-tool.ts');
  const harnessMetadataPath = join(root, 'src', 'tools', 'agent-harness-metadata.ts');

  if (!existsSync(harnessControlPath)) {
    issues.push('harness settings source is missing: src/agent/harness-control.ts.');
  } else {
    const source = readFileSync(harnessControlPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'function settingModelRoute', label: 'setting model route builder' },
      { marker: 'isExternalHostOwnedSettingKey(setting.key)', label: 'connected-host-owned setting read-only check' },
      { marker: 'agent_harness mode:"get_setting" only', label: 'read-only setting model route' },
      { marker: 'agent_harness mode:"set_setting" or mode:"reset_setting"', label: 'writable setting model route' },
      { marker: 'redactHarnessSettingValue', label: 'setting value redaction' },
      { marker: 'persistSecretBackedConfigValue', label: 'secret-backed setting persistence' },
      { marker: 'Cannot store raw secret value', label: 'secret manager availability guard' },
      { marker: 'Cannot reset ${setting.key}: secrets manager is unavailable', label: 'secret reset availability guard' },
      { marker: 'AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON', label: 'host-owned setting lock reason' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness settings source must keep ${label}.`);
      }
    }
  }

  if (!existsSync(harnessToolPath)) {
    issues.push('harness tool source is missing: src/tools/agent-harness-tool.ts.');
  } else {
    const source = readFileSync(harnessToolPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: "if (args.mode === 'settings')", label: 'settings discovery mode' },
      { marker: 'settingsPolicySummary()', label: 'settings policy summary in catalog output' },
      { marker: "if (args.mode === 'get_setting')", label: 'single setting inspection mode' },
      { marker: "if (args.mode === 'set_setting')", label: 'setting mutation mode' },
      { marker: "requireConfirmedAction(args, 'Setting mutation')", label: 'setting mutation confirmation gate' },
      { marker: 'set_setting requires value', label: 'setting mutation value requirement' },
      { marker: "if (args.mode === 'reset_setting')", label: 'setting reset mode' },
      { marker: "requireConfirmedAction(args, 'Setting reset')", label: 'setting reset confirmation gate' },
      { marker: 'Ambiguous setting', label: 'ambiguous setting lookup refusal' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness settings runtime must keep ${label}.`);
      }
    }
  }

  if (!existsSync(harnessMetadataPath)) {
    issues.push('harness metadata source is missing: src/tools/agent-harness-metadata.ts.');
  } else {
    const source = readFileSync(harnessMetadataPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'settingsPolicySummary', label: 'settings policy summary export' },
      { marker: 'secretHandling', label: 'settings secret handling policy' },
      { marker: 'readOnlyHostOwnedPrefixes', label: 'host-owned read-only prefix policy' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness settings metadata must keep ${label}.`);
      }
    }
  }

  return issues;
}

function markerCount(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function verifyHarnessVisibleSurfaceModelAccessPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  const workspaceActionsPath = join(root, 'src', 'tools', 'agent-harness-workspace-actions.ts');
  const panelMetadataPath = join(root, 'src', 'tools', 'agent-harness-panel-metadata.ts');
  const uiSurfaceMetadataPath = join(root, 'src', 'tools', 'agent-harness-ui-surface-metadata.ts');

  if (!existsSync(workspaceActionsPath)) {
    issues.push('harness workspace actions source is missing: src/tools/agent-harness-workspace-actions.ts.');
  } else {
    const source = readFileSync(workspaceActionsPath, 'utf-8');
    const modelRouteMarker = 'modelRoute: previewText(workspaceActionRouteHint(action))';
    if (markerCount(source, modelRouteMarker) < 2) {
      issues.push('harness workspace actions must expose modelRoute on both compact and detailed action descriptions.');
    }
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'function workspaceActionRouteHint', label: 'workspace action model route builder' },
      { marker: 'describeWorkspaceEditorModelExecution', label: 'editor action model execution descriptor' },
      { marker: 'describeLocalWorkspaceModelExecution', label: 'local action model execution descriptor' },
      { marker: 'resolveWorkspaceActionDetail', label: 'single workspace action inspection resolver' },
      { marker: "status: 'ambiguous'", label: 'ambiguous workspace action refusal' },
      { marker: 'agent_harness mode:"open_ui_surface"', label: 'visible navigation route hint' },
      { marker: 'agent_harness mode:"run_workspace_action"', label: 'workspace action execution route hint' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness workspace actions must keep ${label}.`);
      }
    }
  }

  if (!existsSync(panelMetadataPath)) {
    issues.push('harness panel metadata source is missing: src/tools/agent-harness-panel-metadata.ts.');
  } else {
    const source = readFileSync(panelMetadataPath, 'utf-8');
    if (markerCount(source, 'modelRoute: panelModelRoute()') < 2) {
      issues.push('harness panel metadata must expose modelRoute on both panel candidates and detailed panel descriptions.');
    }
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'function panelModelRoute()', label: 'panel model route builder' },
      { marker: 'workspaceRoute:', label: 'panel workspace route hint' },
      { marker: 'openHarnessPanel', label: 'confirmed panel opener' },
      { marker: 'confirmation: \'agent_harness mode:"open_panel" requires confirm:true and explicitUserRequest.\'', label: 'panel opener confirmation policy' },
      { marker: "status: 'ambiguous'", label: 'ambiguous panel refusal' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness panel metadata must keep ${label}.`);
      }
    }
  }

  if (!existsSync(uiSurfaceMetadataPath)) {
    issues.push('harness UI surface metadata source is missing: src/tools/agent-harness-ui-surface-metadata.ts.');
  } else {
    const source = readFileSync(uiSurfaceMetadataPath, 'utf-8');
    if (markerCount(source, 'modelRoute: uiSurfaceModelRoute(surface)') < 2) {
      issues.push('harness UI surface metadata must expose modelRoute on both surface candidates and detailed surface descriptions.');
    }
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'preferredModelRoute', label: 'surface-specific preferred model route' },
      { marker: 'function uiSurfaceModelRoute', label: 'UI surface model route builder' },
      { marker: 'openHarnessUiSurface', label: 'confirmed UI surface opener' },
      { marker: 'confirmation: \'agent_harness mode:"open_ui_surface" requires confirm:true and explicitUserRequest.\'', label: 'UI surface opener confirmation policy' },
      { marker: "status: 'ambiguous'", label: 'ambiguous UI surface refusal' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness UI surface metadata must keep ${label}.`);
      }
    }
  }

  return issues;
}

function verifyHarnessOperatorAuditModelAccessPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  const releaseEvidencePath = join(root, 'src', 'tools', 'agent-harness-release-evidence.ts');
  const releaseReadinessPath = join(root, 'src', 'tools', 'agent-harness-release-readiness.ts');

  if (!existsSync(releaseEvidencePath)) {
    issues.push('harness release evidence source is missing: src/tools/agent-harness-release-evidence.ts.');
  } else {
    const source = readFileSync(releaseEvidencePath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'function releaseEvidenceModelRoute', label: 'release evidence model route builder' },
      { marker: 'modelRoute: releaseEvidenceModelRoute', label: 'release evidence model route output' },
      { marker: 'function releaseEvidencePolicy', label: 'release evidence operator/audit policy' },
      { marker: "effect: 'operator-audit-read-only'", label: 'release evidence read-only audit effect' },
      { marker: 'release operators and maintainers', label: 'release evidence operator audience' },
      { marker: 'agent_harness mode:"release_evidence_artifact"', label: 'single release evidence artifact route' },
      { marker: 'modelAccess', label: 'release evidence detailed model access' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness release evidence must keep ${label}.`);
      }
    }
  }

  if (!existsSync(releaseReadinessPath)) {
    issues.push('harness release readiness source is missing: src/tools/agent-harness-release-readiness.ts.');
  } else {
    const source = readFileSync(releaseReadinessPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'function releaseReadinessModelRoute', label: 'release readiness model route builder' },
      { marker: 'modelRoute: releaseReadinessModelRoute', label: 'release readiness model route output' },
      { marker: 'function releaseReadinessPolicy', label: 'release readiness operator/audit policy' },
      { marker: "effect: 'operator-audit-read-only'", label: 'release readiness read-only audit effect' },
      { marker: 'release operators and maintainers', label: 'release readiness operator audience' },
      { marker: 'agent_harness mode:"release_readiness_item"', label: 'single release readiness item route' },
      { marker: 'operatorAuditPolicy', label: 'release readiness summary audit policy' },
      { marker: 'modelAccess', label: 'release readiness detailed model access' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness release readiness must keep ${label}.`);
      }
    }
  }

  return issues;
}

function verifyHarnessConnectedHostModelAccessPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  const metadataPath = join(root, 'src', 'tools', 'agent-harness-metadata.ts');
  const statusPath = join(root, 'src', 'tools', 'agent-harness-connected-host-status.ts');
  const modeCatalogPath = join(root, 'src', 'tools', 'agent-harness-mode-catalog.ts');

  if (!existsSync(metadataPath)) {
    issues.push('harness connected-host metadata source is missing: src/tools/agent-harness-metadata.ts.');
  } else {
    const source = readFileSync(metadataPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'function connectedHostCapabilityModelRoute', label: 'connected-host capability model route builder' },
      { marker: 'function blockedConnectedHostModelRoute', label: 'blocked connected-host model route builder' },
      { marker: 'harnessRoute: \'agent_harness mode:"connected_host_capability"\'', label: 'capability harness inspection route' },
      { marker: 'connectedHostSummary', label: 'connected-host summary export' },
      { marker: 'daemonAliases', label: 'daemon alias route summary' },
      { marker: 'lifecycleBlocked', label: 'blocked lifecycle model-access boundary' },
      { marker: 'operate: connectedHostCapabilityModelRoute(capability)', label: 'allowed capability operation route' },
      { marker: "operate: 'not exposed'", label: 'blocked capability operation denial' },
      { marker: 'agent_harness mode:"daemon"', label: 'daemon inventory alias' },
      { marker: 'agent_harness mode:"daemon_status"', label: 'daemon status alias' },
      { marker: 'blockedConnectedHostCapabilities', label: 'blocked connected-host capability inventory' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness connected-host metadata must keep ${label}.`);
      }
    }
  }

  if (!existsSync(statusPath)) {
    issues.push('harness connected-host status source is missing: src/tools/agent-harness-connected-host-status.ts.');
  } else {
    const source = readFileSync(statusPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: 'modelRoute: \'agent_harness mode:"connected_host_status" or mode:"service_posture"\'', label: 'connected-host status model route' },
      { marker: 'daemonAliases', label: 'connected-host status daemon aliases' },
      { marker: 'lifecycleBlocked', label: 'connected-host status lifecycle boundary' },
      { marker: 'connectedHostFindings', label: 'connected-host status findings' },
      { marker: 'capabilitySummary', label: 'connected-host status capability summary' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness connected-host status must keep ${label}.`);
      }
    }
  }

  if (!existsSync(modeCatalogPath)) {
    issues.push('harness mode catalog source is missing: src/tools/agent-harness-mode-catalog.ts.');
  } else {
    const source = readFileSync(modeCatalogPath, 'utf-8');
    const requiredMarkers: readonly { readonly marker: string; readonly label: string }[] = [
      { marker: "{ id: 'connected_host'", label: 'connected_host mode descriptor' },
      { marker: "{ id: 'connected_host_status'", label: 'connected_host_status mode descriptor' },
      { marker: "{ id: 'connected_host_capability'", label: 'connected_host_capability mode descriptor' },
      { marker: "{ id: 'daemon'", label: 'daemon alias descriptor' },
      { marker: "{ id: 'daemon_status'", label: 'daemon_status alias descriptor' },
      { marker: "aliases: ['connected_host']", label: 'daemon inventory alias target' },
      { marker: "aliases: ['connected_host_status']", label: 'daemon status alias target' },
    ];
    for (const { marker, label } of requiredMarkers) {
      if (!source.includes(marker)) {
        issues.push(`harness connected-host mode catalog must keep ${label}.`);
      }
    }
  }

  return issues;
}

function verifyModelToolRuntimeCompactionPolicy(root: string): readonly string[] {
  const issues: string[] = [];
  const compactionPath = join(root, 'src', 'tools', 'tool-definition-compaction.ts');
  if (!existsSync(compactionPath)) {
    return ['model tool runtime compaction source is missing: src/tools/tool-definition-compaction.ts.'];
  }
  const compactionSource = readFileSync(compactionPath, 'utf-8');
  const requiredCompactionMarkers: readonly { readonly marker: string; readonly label: string }[] = [
    { marker: 'DEFAULT_TOOL_DESCRIPTION_LIMIT = 56', label: '56-character registered tool fallback description cap' },
    { marker: 'TOOL_DESCRIPTION_OVERRIDES', label: 'Agent-specific tool description overrides' },
    { marker: 'agent_harness', label: 'agent_harness compact override' },
    { marker: 'goodvibes_context', label: 'platform tool compact override' },
    { marker: 'function stripSchemaDescriptions', label: 'nested schema description stripper' },
    { marker: "if (key === 'description') continue", label: 'schema description removal guard' },
    { marker: 'definition.parameters = stripSchemaDescriptions(definition.parameters)', label: 'registered parameter schema compaction' },
    { marker: 'compactRegisteredToolDefinitions', label: 'registered tool compaction entrypoint' },
  ];
  for (const { marker, label } of requiredCompactionMarkers) {
    if (!compactionSource.includes(marker)) {
      issues.push(`model tool runtime compaction must keep policy marker: ${label}.`);
    }
  }

  for (const relativePath of ['src/runtime/bootstrap-core.ts', 'src/runtime/bootstrap.ts']) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      issues.push(`model tool runtime compaction bootstrap file is missing: ${relativePath}.`);
      continue;
    }
    const source = readFileSync(absolutePath, 'utf-8');
    if (!source.includes('compactRegisteredToolDefinitions')) {
      issues.push(`${relativePath} must import and run compactRegisteredToolDefinitions after registering Agent tools.`);
    }
    if (!source.includes('compactRegisteredToolDefinitions(toolRegistry);')) {
      issues.push(`${relativePath} must compact registered tool definitions for the runtime toolRegistry.`);
    }
  }
  return issues;
}

function verifyPackageBinIssues(root: string, pkg: Record<string, unknown>): readonly string[] {
  const issues: string[] = [];
  const bin = readStringRecord(pkg.bin);
  for (const command of REQUIRED_BIN_COMMANDS) {
    const item = verifyBin(root, command, bin[command]);
    if (!item.target) issues.push(`package.json bin is missing ${item.command}.`);
    if (!item.exists) issues.push(`bin target does not exist: ${item.command} -> ${item.target}`);
    if (!item.executable) issues.push(`bin target is not executable: ${item.command} -> ${item.target}`);
    if (!item.usesBunShebang) issues.push(`bin target does not use Bun shebang: ${item.command} -> ${item.target}`);
    if (!item.hasSourceEntrypoint) issues.push(`bin target does not load the packaged Agent runtime: ${item.command}`);
  }
  return issues;
}

function commandSourcePaths(root: string): readonly string[] {
  const commandsRoot = join(root, 'src', 'input', 'commands');
  return [
    join(root, 'src', 'input', 'commands.ts'),
    ...listFilesUnder(commandsRoot).filter((path) => path.endsWith('.ts')),
  ].filter((path) => existsSync(path)).sort();
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index + 2);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }
    if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readCommandStringProperty(block: string, property: string): string | null {
  const pattern = new RegExp(`\\b${property}:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`, 's');
  const match = pattern.exec(block);
  const value = match?.[2];
  return value ? value.replace(/\\(['"`\\])/g, '$1') : null;
}

function commandDefinitionFromBlock(block: string): { readonly name: string; readonly aliases: readonly string[] } | null {
  const name = readCommandStringProperty(block, 'name');
  if (!name || !COMMAND_NAME_PATTERN.test(name)) return null;
  const aliases: string[] = [];
  const aliasesMatch = /\baliases:\s*\[([^\]]*)\]/.exec(block);
  if (aliasesMatch) {
    for (const aliasMatch of aliasesMatch[1]!.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const alias = aliasMatch[2]?.replace(/\\(['"`\\])/g, '$1');
      if (alias && COMMAND_NAME_PATTERN.test(alias)) aliases.push(alias);
    }
  }
  return { name, aliases };
}

function commandTextSourceFromBlock(block: string, definition: { readonly name: string; readonly aliases: readonly string[] }): PackageFacingTextSource {
  const lines = [
    `/${definition.name}`,
    ...definition.aliases.map((alias) => `/${alias}`),
    readCommandStringProperty(block, 'description'),
    readCommandStringProperty(block, 'usage'),
    readCommandStringProperty(block, 'argsHint'),
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
  return {
    path: `tui:slash-command:${definition.name}`,
    content: lines.join('\n'),
  };
}

function extractRegisteredCommandBlocks(source: string): readonly string[] {
  const blocks: string[] = [];
  const registerPattern = /registry\.register\(\s*\{/g;
  for (let match = registerPattern.exec(source); match !== null; match = registerPattern.exec(source)) {
    const openIndex = source.indexOf('{', match.index);
    const closeIndex = openIndex === -1 ? -1 : findMatchingBrace(source, openIndex);
    if (openIndex !== -1 && closeIndex !== -1) {
      blocks.push(source.slice(openIndex, closeIndex + 1));
      registerPattern.lastIndex = closeIndex + 1;
    }
  }
  return blocks;
}

function extractExportedCommandBlocks(source: string): ReadonlyMap<string, string> {
  const blocks = new Map<string, string>();
  const exportedCommandPattern = /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*SlashCommand\s*=\s*\{/g;
  for (let match = exportedCommandPattern.exec(source); match !== null; match = exportedCommandPattern.exec(source)) {
    const name = match[1];
    const openIndex = source.indexOf('{', match.index);
    const closeIndex = openIndex === -1 ? -1 : findMatchingBrace(source, openIndex);
    if (name && openIndex !== -1 && closeIndex !== -1) {
      blocks.set(name, source.slice(openIndex, closeIndex + 1));
      exportedCommandPattern.lastIndex = closeIndex + 1;
    }
  }
  return blocks;
}

function collectRegisteredCommandReferences(source: string): readonly string[] {
  const references: string[] = [];
  const referencePattern = /registry\.register\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;
  for (let match = referencePattern.exec(source); match !== null; match = referencePattern.exec(source)) {
    if (match[1]) references.push(match[1]);
  }
  return references;
}

function collectUnregisteredCommandNames(source: string): readonly string[] {
  const names: string[] = [];
  const unregisterPattern = /registry\.unregister\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/g;
  for (let match = unregisterPattern.exec(source); match !== null; match = unregisterPattern.exec(source)) {
    const name = match[2]?.replace(/\\(['"`\\])/g, '$1');
    if (name && COMMAND_NAME_PATTERN.test(name)) names.push(name);
  }
  return names;
}

function buildPackageFacingSlashCommandCatalog(root: string): PackageFacingSlashCommandCatalog {
  const names = new Set<string>();
  const failures: string[] = [];
  const textSourcesByName = new Map<string, PackageFacingTextSource>();
  const commandConstants = new Map<string, string>();
  const definitionsByName = new Map<string, readonly string[]>();
  const registeredReferences: string[] = [];
  const unregisteredNames: string[] = [];
  const sources = commandSourcePaths(root);
  const addDefinition = (definition: { readonly name: string; readonly aliases: readonly string[] }, block: string): void => {
    definitionsByName.set(definition.name, definition.aliases);
    names.add(definition.name);
    for (const alias of definition.aliases) names.add(alias);
    textSourcesByName.set(definition.name, commandTextSourceFromBlock(block, definition));
  };
  for (const path of sources) {
    const source = readFileSync(path, 'utf-8');
    for (const block of extractRegisteredCommandBlocks(source)) {
      const definition = commandDefinitionFromBlock(block);
      if (!definition) continue;
      addDefinition(definition, block);
    }
    for (const [constantName, block] of extractExportedCommandBlocks(source)) {
      commandConstants.set(constantName, block);
    }
    registeredReferences.push(...collectRegisteredCommandReferences(source));
    unregisteredNames.push(...collectUnregisteredCommandNames(source));
  }
  for (const reference of registeredReferences) {
    const block = commandConstants.get(reference);
    if (!block) {
      failures.push(`package-facing command lint could not resolve registered command source: ${reference}`);
      continue;
    }
    const definition = commandDefinitionFromBlock(block);
    if (!definition) continue;
    addDefinition(definition, block);
  }
  for (const name of unregisteredNames) {
    names.delete(name);
    textSourcesByName.delete(name);
    for (const alias of definitionsByName.get(name) ?? []) names.delete(alias);
  }
  if (names.size === 0) {
    failures.push('package-facing command lint could not discover any Agent slash commands from source.');
  }
  return {
    names,
    textSources: [...textSourcesByName.values()].sort((a, b) => a.path.localeCompare(b.path)),
    failures,
  };
}

function verifyReleaseReleaseNotesPolicy(root: string): readonly string[] {
  const notesPath = join(root, RELEASE_NOTES_RELATIVE_PATH);
  if (!existsSync(notesPath)) {
    return [`release notes are missing: ${RELEASE_NOTES_RELATIVE_PATH}.`];
  }

  const issues: string[] = [];
  const content = readFileSync(notesPath, 'utf-8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bulletLines = lines.filter((line) => line.startsWith('- '));
  if (bulletLines.length < 5) {
    issues.push('release notes must include at least five product-facing bullet points.');
  }
  for (const line of bulletLines) {
    if (/^- [0-9a-f]{7,40}\s/i.test(line)) {
      issues.push('release notes must describe product changes, not raw commit hashes.');
      break;
    }
  }
  const requiredThemes = [
    'fullscreen Agent workspace',
    'Agent-local behavior',
    'Agent Knowledge',
    'connected-host operator integration',
    'side-effect boundaries',
    'release hardening',
  ] as const;
  for (const theme of requiredThemes) {
    if (!content.includes(theme)) {
      issues.push(`release notes must mention ${theme}.`);
    }
  }
  return issues;
}

export function verifyReleaseMetadata(root: string): readonly string[] {
  const issues: string[] = [];
  const pkg = readPackageJson(root);
  if (pkg.name !== '@pellux/goodvibes-agent') {
    issues.push('package.json name must be @pellux/goodvibes-agent.');
  }
  if (pkg.private !== false) {
    issues.push('package.json private must be false for the public Agent package.');
  }
  if (pkg.type !== 'module') {
    issues.push('package.json type must be module.');
  }
  if (pkg.main !== 'dist/package/main.js') {
    issues.push('package.json main must be dist/package/main.js.');
  }
  const packageManager = readStringValue(pkg.packageManager);
  const packageManagerBunVersion = readPackageManagerBunVersion(pkg);
  if (packageManager !== 'bun@1.3.10') {
    issues.push('package.json packageManager must be bun@1.3.10.');
  }
  const githubSetupBunVersion = readGithubSetupBunVersion(root);
  if (githubSetupBunVersion !== null) {
    if (!isExactSemver(githubSetupBunVersion)) {
      issues.push(`GitHub setup action bun-version must be an exact semver like 1.2.3: ${githubSetupBunVersion}.`);
    } else if (packageManagerBunVersion.length > 0 && githubSetupBunVersion !== packageManagerBunVersion) {
      issues.push(`GitHub setup action bun-version ${githubSetupBunVersion} does not match package.json packageManager ${packageManager}.`);
    }
  }
  issues.push(...verifyGithubReleaseWorkflowPolicy(root));
  issues.push(...verifyGithubCiWorkflowPolicy(root));
  issues.push(...verifyReleaseScriptPolicy(root));
  issues.push(...verifyPublishPackageScriptPolicy(root));
  issues.push(...verifyPackageInstallCheckScriptPolicy(root));
  issues.push(...verifyPublishCheckScriptPolicy(root));
  issues.push(...verifyPackageRuntimeBuildScriptPolicy(root));
  issues.push(...verifyProductionBuildScriptPolicy(root));
  issues.push(...verifyBunCompileCompatibilityScriptPolicy(root));
  issues.push(...verifyPostBuildSmokeScriptPolicy(root));
  issues.push(...verifyRunTestsScriptPolicy(root));
  issues.push(...verifyPrebuildScriptPolicy(root));
  issues.push(...verifyProjectSurfacesScriptPolicy(root));
  issues.push(...verifyArchitectureCheckScriptPolicy(root));
  issues.push(...verifyPerfCheckScriptPolicy(root));
  issues.push(...verifyVerificationLedgerPolicy(root));
  issues.push(...verifyLiveVerificationPolicy(root));
  issues.push(...verifyModelToolRuntimeCompactionPolicy(root));
  issues.push(...verifyHarnessModeCatalogDescriptionPolicy(root));
  issues.push(...verifyHarnessModeRuntimePolicy(root));
  issues.push(...verifyCommandModelAccessPolicy());
  issues.push(...verifyHarnessSettingsModelAccessPolicy(root));
  issues.push(...verifyHarnessVisibleSurfaceModelAccessPolicy(root));
  issues.push(...verifyHarnessOperatorAuditModelAccessPolicy(root));
  issues.push(...verifyHarnessConnectedHostModelAccessPolicy(root));
  if (readStringValue(pkg.description).trim().length === 0) {
    issues.push('package.json is missing a public package description.');
  }
  if (readStringValue(pkg.license) !== 'MIT') {
    issues.push('package.json license must be MIT.');
  }
  const repository = isRecord(pkg.repository) ? pkg.repository : {};
  if (repository.type !== 'git' || readStringValue(repository.url).trim().length === 0) {
    issues.push('package.json repository must include git repository metadata.');
  }
  if (readStringValue(pkg.homepage).trim().length === 0) {
    issues.push('package.json is missing a public package homepage.');
  }
  const publishConfig = isRecord(pkg.publishConfig) ? pkg.publishConfig : {};
  if (publishConfig.access !== 'public') {
    issues.push('package.json publishConfig.access must be public.');
  }
  const engines = isRecord(pkg.engines) ? pkg.engines : {};
  if (readStringValue(engines.bun) !== '>=1.3.10') {
    issues.push('package.json engines.bun must be >=1.3.10.');
  }
  const bin = readStringRecord(pkg.bin);
  if (bin['goodvibes-agent'] !== 'bin/goodvibes-agent.ts') {
    issues.push('package.json bin.goodvibes-agent must be bin/goodvibes-agent.ts.');
  }
  issues.push(...verifyPackageBinIssues(root, pkg));
  const files = readStringArray(pkg.files);
  issues.push(...verifyPackageFilesManifest(root, files));
  issues.push(...verifyPackageScripts(readStringRecord(pkg.scripts)));
  const packageVersion = typeof pkg.version === 'string' ? pkg.version : '';
  if (packageVersion.length === 0) {
    issues.push('package.json is missing a string version.');
  } else if (!isExactSemver(packageVersion)) {
    issues.push(`package.json version must be an exact semver like 1.2.3: ${packageVersion}.`);
  }
  issues.push(...verifyReleaseReleaseNotesPolicy(root));
  issues.push(...verifyReleasePerformanceSnapshotPolicy(root));
  issues.push(...verifyReleaseReadinessPolicy(root, packageVersion));
  const changelogRelease = readTopChangelogRelease(root);
  if (changelogRelease === null) {
    issues.push('CHANGELOG.md is missing a top release heading like "## x.y.z - YYYY-MM-DD".');
  } else {
    if (packageVersion.length > 0 && changelogRelease.version !== packageVersion) {
      issues.push(`CHANGELOG.md top release ${changelogRelease.version} does not match package.json version ${packageVersion}.`);
    }
    const date = new Date(`${changelogRelease.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== changelogRelease.date) {
      issues.push(`CHANGELOG.md top release date must be a real YYYY-MM-DD date: ${changelogRelease.date}.`);
    }
  }

  const versionFallbacks = readVersionFallbacks(root);
  if (versionFallbacks === null) {
    issues.push('src/version.ts is missing release fallback metadata.');
  } else {
    if (versionFallbacks.version === null) {
      issues.push('src/version.ts is missing the _version fallback literal.');
    } else if (packageVersion.length > 0 && versionFallbacks.version !== packageVersion) {
      issues.push(`src/version.ts _version fallback ${versionFallbacks.version} does not match package.json version ${packageVersion}.`);
    } else if (!isExactSemver(versionFallbacks.version)) {
      issues.push(`src/version.ts _version fallback must be an exact semver like 1.2.3: ${versionFallbacks.version}.`);
    }
  }

  issues.push(...verifySourcePackageBoundary(root));
  issues.push(...verifyModelToolDescriptionPolicy(root));

  return issues;
}

function verifyPackageFacingSlashCommands(path: string, content: string, registeredCommands: ReadonlySet<string>): readonly string[] {
  const failures: string[] = [];
  const commandPattern = /(^|[\s`([])\/([a-z][a-z0-9_-]*)(?=$|[\s`.,;:)\]])/g;
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    commandPattern.lastIndex = 0;
    for (let match = commandPattern.exec(line); match !== null; match = commandPattern.exec(line)) {
      const root = match[2] ?? '';
      const slashIndex = match.index + (match[1]?.length ?? 0);
      const prefix = line.slice(0, slashIndex).trimEnd();
      if (HTTP_ROUTE_VERBS.some((verb) => prefix.endsWith(verb))) continue;
      if (NON_COMMAND_ROUTE_ROOTS.has(root)) continue;
      if (registeredCommands.has(root)) continue;
      failures.push(`package-facing text ${path}:${lineIndex + 1} references unknown Agent slash command: /${root}`);
    }
  }
  return failures;
}

function verifyPackageFacingInstallAndPackageNames(path: string, content: string): readonly string[] {
  const failures: string[] = [];
  const lines = content.split(/\r?\n/);
  const packageNamePattern = /@pellux\/goodvibes-[a-z0-9-]+/g;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (NON_BUN_INSTALL_COMMAND_PATTERN.test(line)) {
      failures.push(`package-facing text ${path}:${lineIndex + 1} contains non-Bun Agent install/run instruction.`);
    }
    packageNamePattern.lastIndex = 0;
    for (let match = packageNamePattern.exec(line); match !== null; match = packageNamePattern.exec(line)) {
      const packageName = match[0] ?? '';
      if (!ALLOWED_PACKAGE_FACING_PACKAGE_NAMES.has(packageName)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} references non-Agent GoodVibes package: ${packageName}`);
      }
    }
  }
  return failures;
}

function verifyPackageFacingVersionMentions(path: string, content: string, pins: PackageFacingVersionPins | null): readonly string[] {
  if (pins === null) return [];
  const failures: string[] = [];
  const versionMentionPattern = /@pellux\/goodvibes-(agent|sdk)@([^\s`),;]+)/g;
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    versionMentionPattern.lastIndex = 0;
    for (let match = versionMentionPattern.exec(line); match !== null; match = versionMentionPattern.exec(line)) {
      const product = match[1] ?? '';
      const rawVersion = match[2] ?? '';
      if (product === 'sdk') {
        failures.push(`package-facing text ${path}:${lineIndex + 1} references a versioned connected-host package; describe connected-host compatibility through public Agent routes instead.`);
        continue;
      }
      const version = rawVersion.replace(/[.!?:]+$/, '');
      const expectedVersion = pins.packageVersion;
      if (!isExactSemver(version)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} references @pellux/goodvibes-${product} with non-exact version: ${rawVersion}`);
        continue;
      }
      if (version !== expectedVersion) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} references @pellux/goodvibes-${product}@${version}, expected ${expectedVersion}.`);
      }
    }
  }
  return failures;
}

export function packageFacingBoundaryLanguageIssues(path: string, content: string): readonly string[] {
  const failures: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    for (const pattern of RELEASE_EVIDENCE_USER_SURFACE_PATTERNS) {
      if (pattern.test(line)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} classifies release evidence as a user-facing surface; describe it as operator/audit material.`);
        break;
      }
    }
    for (const pattern of HARNESS_USER_SURFACE_UMBRELLA_PATTERNS) {
      if (pattern.test(line)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} classifies all agent_harness routes as user-facing; include visible-surface and operator/audit boundaries.`);
        break;
      }
    }
  }
  return failures;
}

function verifyPackageFacingBaselineRequirements(path: string, content: string, pins: PackageFacingVersionPins | null): readonly string[] {
  if (pins === null) return [];
  const requirements: Record<string, readonly string[]> = {
    'docs/README.md': [`Bun \`${pins.bunVersion}\` or newer`],
    'docs/getting-started.md': [`Bun \`${pins.bunVersion}\` or newer`],
    'docs/release-and-publishing.md': [`Bun \`${pins.bunVersion}\` or newer`],
  };
  const failures: string[] = [];
  for (const required of requirements[path] ?? []) {
    if (!content.includes(required)) {
      failures.push(`package-facing text ${path} is missing required dynamic version baseline: ${required}`);
    }
  }
  return failures;
}

function resolveMarkdownDocLinkPath(sourcePath: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  if (target.startsWith('#')) return null;
  const withoutAnchor = target.split('#')[0] ?? '';
  const withoutQuery = withoutAnchor.split('?')[0] ?? '';
  if (!withoutQuery.endsWith('.md')) return null;
  const sourceDirectory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
  const rawResolved = withoutQuery.startsWith('/')
    ? withoutQuery.slice(1)
    : sourceDirectory.length > 0
      ? `${sourceDirectory}/${withoutQuery}`
      : withoutQuery;
  const resolved = normalize(rawResolved).replace(/\\/g, '/');
  if (resolved.startsWith('../') || resolved === '..') return resolved;
  return resolved;
}

function verifyPackageFacingMarkdownLinks(root: string, path: string, content: string): readonly string[] {
  const failures: string[] = [];
  const lines = content.split(/\r?\n/);
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+\.md(?:[#?][^)]*)?)\)/g;
  const packagedMarkdownPaths = new Set(packageFacingTextPaths(root));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    linkPattern.lastIndex = 0;
    for (let match = linkPattern.exec(line); match !== null; match = linkPattern.exec(line)) {
      const target = match[1] ?? '';
      const resolved = resolveMarkdownDocLinkPath(path, target);
      if (resolved === null) continue;
      if (resolved.startsWith('../') || resolved === '..') {
        failures.push(`package-facing text ${path}:${lineIndex + 1} links outside the package docs surface: ${target}`);
        continue;
      }
      if (!existsSync(join(root, resolved))) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} links missing Markdown file: ${target} -> ${resolved}`);
        continue;
      }
      if (!packagedMarkdownPaths.has(resolved)) {
        failures.push(`package-facing text ${path}:${lineIndex + 1} links Markdown outside the packaged docs surface: ${target} -> ${resolved}`);
      }
    }
  }
  return failures;
}

function verifyPackageDocsIndexCoverage(root: string, indexPath: string, linkPrefix: string): readonly string[] {
  const failures: string[] = [];
  const absolutePath = join(root, indexPath);
  if (!existsSync(absolutePath)) return [`package docs index is missing: ${indexPath}`];
  const content = readFileSync(absolutePath, 'utf-8');
  for (const docPath of packageDocPaths(root)) {
    if (docPath === 'docs/README.md') continue;
    const relativeTarget = docPath.slice('docs/'.length);
    const expectedTarget = `${linkPrefix}${relativeTarget}`;
    if (!content.includes(`](${expectedTarget})`)) {
      failures.push(`${indexPath} does not list package doc: ${expectedTarget}`);
    }
  }
  return failures;
}

function verifyDocsIndexCoverage(root: string): readonly string[] {
  return [
    ...verifyPackageDocsIndexCoverage(root, 'README.md', 'docs/'),
    ...verifyPackageDocsIndexCoverage(root, 'docs/README.md', ''),
  ];
}

function verifyPackageFacingTextSource(
  root: string,
  source: PackageFacingTextSource,
  registeredCommands: ReadonlySet<string>,
  cliCommands: PackageFacingCliCommandCatalog,
  pins: PackageFacingVersionPins | null,
): readonly string[] {
  const failures: string[] = [];
  const { path, content } = source;
  if (content.trim().length === 0) {
    failures.push(`package-facing text is empty: ${path}`);
    return failures;
  }
  if (path !== 'CHANGELOG.md') {
    failures.push(...verifyPackageFacingSlashCommands(path, content, registeredCommands));
  }
  failures.push(...verifyPackageFacingInstallAndPackageNames(path, content));
  failures.push(...verifyPackageFacingCliCommandMentions(path, content, cliCommands));
  failures.push(...verifyPackageFacingVersionMentions(path, content, pins));
  failures.push(...packageFacingBoundaryLanguageIssues(path, content));
  failures.push(...verifyPackageFacingBaselineRequirements(path, content, pins));
  failures.push(...verifyPackageFacingMarkdownLinks(root, path, content));
  for (const forbidden of PACKAGE_FACING_FORBIDDEN_TEXT) {
    if (content.includes(forbidden)) {
      failures.push(`package-facing text ${path} contains forbidden default/TUI route or policy: ${forbidden}`);
    }
  }
  const requirement = PACKAGE_FACING_REQUIRED_TEXT.find((entry) => entry.path === path);
  if (requirement) {
    for (const required of requirement.required) {
      if (!content.includes(required)) {
        failures.push(`package-facing text ${path} is missing required Agent route/policy text: ${required}`);
      }
    }
  }
  return failures;
}

function hasExecutableBit(path: string): boolean {
  return existsSync(path) && (statSync(path).mode & 0o111) !== 0;
}

function verifyBin(root: string, command: typeof REQUIRED_BIN_COMMANDS[number], target: string | undefined): PackageCliBinVerification {
  const binPath = target ? join(root, target) : '';
  const source = target && existsSync(binPath) ? readFileSync(binPath, 'utf-8') : '';
  return {
    command,
    target: target ?? '',
    exists: Boolean(target) && existsSync(binPath),
    executable: Boolean(target) && hasExecutableBit(binPath),
    usesBunShebang: source.startsWith('#!/usr/bin/env bun'),
    hasSourceEntrypoint: source.includes('dist') && source.includes('package') && source.includes('main.js'),
  };
}

function registryPackDryRun(root: string): { readonly files: readonly string[]; readonly entryCount: number; readonly unpackedSize: number } {
  execSync('bun run build:package-runtime', {
    cwd: root,
    stdio: 'inherit',
  });
  const raw = execSync('npm pack --json --dry-run', {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const [packResult] = JSON.parse(raw) as Array<{ files?: Array<{ path?: string }>; entryCount?: number; unpackedSize?: number }>;
  return {
    files: Array.isArray(packResult?.files) ? packResult.files.map((entry) => String(entry.path ?? '')) : [],
    entryCount: Number(packResult?.entryCount ?? 0),
    unpackedSize: Number(packResult?.unpackedSize ?? 0),
  };
}

export function verifyPackageFacingText(root: string): { readonly checkedPaths: readonly string[]; readonly failures: readonly string[] } {
  const failures: string[] = [];
  const slashCommands = buildPackageFacingSlashCommandCatalog(root);
  failures.push(...slashCommands.failures);
  const cliCommands = buildPackageFacingCliCommandCatalog(root);
  failures.push(...cliCommands.failures);
  const versionPins = readPackageFacingVersionPins(root);
  failures.push(...versionPins.failures);
  const packageFacingTextPathsToCheck = packageFacingTextPaths(root);
  for (const path of packageFacingTextPathsToCheck) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) {
      failures.push(`package-facing text is missing: ${path}`);
      continue;
    }
    const content = readFileSync(absolutePath, 'utf-8');
    failures.push(...verifyPackageFacingTextSource(root, { path, content }, slashCommands.names, cliCommands, versionPins.pins));
  }
  const cliHelpSources = packageFacingCliHelpTextSources();
  failures.push(...verifyPackageTextSourceCoverage(root, cliHelpSources));
  for (const source of [...slashCommands.textSources, ...cliHelpSources]) {
    failures.push(...verifyPackageFacingTextSource(root, source, slashCommands.names, cliCommands, versionPins.pins));
  }
  failures.push(...verifyDocsIndexCoverage(root));
  return {
    checkedPaths: [
      ...packageFacingTextPathsToCheck,
      ...slashCommands.textSources.map((source) => source.path),
      ...cliHelpSources.map((source) => source.path),
    ],
    failures,
  };
}

export function verifyPackageCliInstall(root: string): PackageCliVerificationReport {
  const pkg = readPackageJson(root);
  const bin = pkg.bin && typeof pkg.bin === 'object' ? pkg.bin as Record<string, string | undefined> : {};
  const bins = REQUIRED_BIN_COMMANDS.map((command) => verifyBin(root, command, bin[command]));
  const pack = registryPackDryRun(root);
  const requiredPaths = requiredTarballPaths(root);
  const requiredPathsPresent = requiredPaths.filter((path) => pack.files.includes(path));
  const forbiddenPaths = pack.files.filter(isForbiddenPackageTarballPath);
  const issues: string[] = [];
  const packageFacingText = verifyPackageFacingText(root);

  for (const path of requiredPaths) {
    if (!pack.files.includes(path)) issues.push(`registry tarball missing required path: ${path}`);
  }
  for (const path of forbiddenPaths) {
    issues.push(`registry tarball includes forbidden path: ${path}`);
  }
  for (const failure of packageFacingText.failures) {
    issues.push(failure);
  }
  for (const issue of verifyReleaseMetadata(root)) {
    issues.push(issue);
  }
  for (const issue of verifyModelToolDescriptionPolicy(root)) {
    issues.push(issue);
  }
  for (const issue of verifyModelToolRuntimeCompactionPolicy(root)) {
    issues.push(issue);
  }
  for (const issue of verifyHarnessModeCatalogDescriptionPolicy(root)) {
    issues.push(issue);
  }
  for (const issue of verifyHarnessModeRuntimePolicy(root)) {
    issues.push(issue);
  }

  return {
    packageName: String(pkg.name ?? ''),
    version: String(pkg.version ?? ''),
    bins,
    tarball: {
      entryCount: pack.entryCount,
      unpackedSize: pack.unpackedSize,
      requiredPathsPresent,
      forbiddenPaths,
    },
    packageFacingText,
    issues,
  };
}
