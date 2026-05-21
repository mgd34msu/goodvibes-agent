import { getRoute, type RouteId } from '../daemon/routes.js';
import { isAllowlistedOperatorMutationRoute } from './operator-mutations.js';

export type RiskLevel = 'safe' | 'elevated' | 'dangerous';
export type ActionPolicyCategory =
  | 'safe_read'
  | 'local_memory'
  | 'build_delegation'
  | 'workspace_write'
  | 'network_effect'
  | 'daemon_mutation'
  | 'delete'
  | 'secret'
  | 'service_change'
  | 'package_install'
  | 'external_side_effect';

export interface SafetyDecision {
  readonly risk: RiskLevel;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export interface ActionPolicyDecision extends SafetyDecision {
  readonly category: ActionPolicyCategory;
  readonly allowedAutomatically: boolean;
  readonly requiresExplicitCommand: boolean;
  readonly matched: readonly string[];
  readonly audit: readonly string[];
}

const LOCAL_MEMORY_TERMS = /\b(remember|store this|note that|my default|we use|our default|i prefer)\b/i;
const BUILD_TERMS = /\b(build|implement|fix|change code|edit code|patch|refactor|review|test|debug|ship|create app|create feature)\b/i;
const WRFC_TERMS = /\b(wrfc|review\/fix\/check|review fix check|quality gate|reviewer|fixer|verifier)\b/i;

export function classifyPrompt(text: string): SafetyDecision {
  const decision = evaluateActionPolicy(text);
  return {
    risk: decision.risk,
    requiresApproval: decision.requiresApproval,
    reason: decision.reason,
  };
}

export function evaluateActionPolicy(text: string): ActionPolicyDecision {
  const normalized = text.trim();
  const rules: readonly PolicyRule[] = [
    {
      category: 'secret',
      risk: 'dangerous',
      pattern: /\b(api[_ -]?key|token|password|secret|private key|ssh key|credential)\b/i,
      reason: 'Secret or credential handling requires explicit approval and must not be stored directly.',
      requiresExplicitCommand: true,
    },
    {
      category: 'local_memory',
      risk: 'safe',
      pattern: LOCAL_MEMORY_TERMS,
      reason: 'Local memory, skill, and persona lifecycle actions are allowed when non-secret and reviewable.',
      requiresExplicitCommand: false,
    },
    {
      category: 'package_install',
      risk: 'elevated',
      pattern: /\b(install package|bun add|npm install|pnpm add|yarn add|pip install|cargo install|brew install)\b/i,
      reason: 'Package installation changes the local environment and requires explicit approval.',
      requiresExplicitCommand: true,
    },
    {
      category: 'service_change',
      risk: 'dangerous',
      pattern: /\b(start service|stop service|restart service|disable service|enable service|systemctl|launchctl|service\s+\w+)\b/i,
      reason: 'Service lifecycle changes require explicit approval.',
      requiresExplicitCommand: true,
    },
    {
      category: 'external_side_effect',
      risk: 'elevated',
      pattern: /\b(send|publish|post|tweet|email|dm|message someone|charge|buy|purchase|provision|deploy public)\b/i,
      reason: 'Externally visible, costly, or provisioning actions require explicit approval.',
      requiresExplicitCommand: true,
    },
    {
      category: 'daemon_mutation',
      risk: 'elevated',
      pattern: /\b(approve|deny|cancel approval|create automation|delete automation|run automation|create schedule|delete schedule|run schedule|retry run|cancel run)\b/i,
      reason: 'Daemon mutation routes require an explicit user command and approval-aware handling.',
      requiresExplicitCommand: true,
    },
    {
      category: 'workspace_write',
      risk: 'elevated',
      pattern: /\b(write file|edit file|modify file|overwrite|workspace write|filesystem write)\b/i,
      reason: 'Workspace writes require explicit approval or delegation to the TUI build lane.',
      requiresExplicitCommand: true,
    },
    {
      category: 'delete',
      risk: 'dangerous',
      pattern: /\b(delete|remove|destroy|reset|wipe|revoke|rotate|drop|truncate|uninstall)\b/i,
      reason: 'Destructive or state-removing actions require explicit approval.',
      requiresExplicitCommand: true,
    },
    {
      category: 'network_effect',
      risk: 'elevated',
      pattern: /\b(call api|webhook|remote write|upload|download and run|open port|expose network)\b/i,
      reason: 'Network effects beyond read-only lookup require explicit approval.',
      requiresExplicitCommand: true,
    },
    {
      category: 'build_delegation',
      risk: 'safe',
      pattern: BUILD_TERMS,
      reason: 'Build, implementation, fix, review, and test work is routed to GoodVibes TUI delegation.',
      requiresExplicitCommand: false,
    },
  ];

  for (const rule of rules) {
    const matched = matchedTerms(normalized, rule.pattern);
    if (matched.length === 0) continue;
    const requiresApproval = rule.risk !== 'safe';
    return {
      risk: rule.risk,
      category: rule.category,
      requiresApproval,
      allowedAutomatically: !requiresApproval,
      requiresExplicitCommand: rule.requiresExplicitCommand,
      reason: rule.reason,
      matched,
      audit: [
        `category:${rule.category}`,
        `risk:${rule.risk}`,
        `approval:${requiresApproval ? 'required' : 'not-required'}`,
      ],
    };
  }

  return {
    risk: 'safe',
    category: 'safe_read',
    requiresApproval: false,
    allowedAutomatically: true,
    requiresExplicitCommand: false,
    reason: 'Safe read, format, summarize, chat, and local non-secret actions can proceed.',
    matched: [],
    audit: ['category:safe_read', 'risk:safe', 'approval:not-required'],
  };
}

export function routeRequiresApproval(routeId: RouteId): boolean {
  const route = getRoute(routeId);
  return route.dangerous === true || route.admin === true || isAllowlistedOperatorMutationRoute(routeId);
}

export function isBuildLikeRequest(text: string): boolean {
  return BUILD_TERMS.test(text);
}

export function explicitlyRequestsWrfc(text: string): boolean {
  return WRFC_TERMS.test(text);
}

export function wrfcEligible(text: string): boolean {
  return isBuildLikeRequest(text);
}

interface PolicyRule {
  readonly category: ActionPolicyCategory;
  readonly risk: RiskLevel;
  readonly pattern: RegExp;
  readonly reason: string;
  readonly requiresExplicitCommand: boolean;
}

function matchedTerms(text: string, pattern: RegExp): readonly string[] {
  const match = text.match(pattern);
  return match?.[0] ? [match[0]] : [];
}
