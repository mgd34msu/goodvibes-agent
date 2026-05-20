import { getRoute, type RouteId } from '../daemon/routes.js';

export type RiskLevel = 'safe' | 'elevated' | 'dangerous';

export interface SafetyDecision {
  readonly risk: RiskLevel;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

const DESTRUCTIVE_TERMS = /\b(delete|remove|destroy|reset|wipe|revoke|rotate|overwrite|drop|truncate|uninstall|disable service|stop service)\b/i;
const EXTERNAL_TERMS = /\b(send|publish|post|tweet|email|dm|message someone|charge|buy|purchase|provision|deploy public)\b/i;
const BUILD_TERMS = /\b(build|implement|fix|change code|edit code|patch|refactor|review|test|debug|ship|create app|create feature)\b/i;
const WRFC_TERMS = /\b(wrfc|review\/fix\/check|review fix check|quality gate|reviewer|fixer|verifier)\b/i;

export function classifyPrompt(text: string): SafetyDecision {
  if (DESTRUCTIVE_TERMS.test(text)) {
    return { risk: 'dangerous', requiresApproval: true, reason: 'The request appears destructive or state-removing.' };
  }
  if (EXTERNAL_TERMS.test(text)) {
    return { risk: 'elevated', requiresApproval: true, reason: 'The request may be externally visible, costly, or privacy-sensitive.' };
  }
  return { risk: 'safe', requiresApproval: false, reason: 'No destructive, costly, or externally visible action detected.' };
}

export function routeRequiresApproval(routeId: RouteId): boolean {
  const route = getRoute(routeId);
  return route.dangerous === true || route.admin === true;
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
