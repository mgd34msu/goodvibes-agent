/**
 * Pure formatting, label, and color helpers for renderSettingsModal.
 * Extracted from settings-modal.ts to keep the renderer under the 800-line
 * architecture cap. No layout logic lives here.
 */

import type { SettingEntry, McpEntry, SubscriptionEntry } from '../input/settings-modal.ts';
import { SETTINGS_CATEGORIES } from '../input/settings-modal.ts';
import { isSecretConfigKey, isSecretReferenceValue } from '../config/secret-config.ts';

function maskSecretValue(value: string): string {
  if (value.length === 0) return '(empty)';
  if (isSecretReferenceValue(value)) return value;
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-4)}`;
}

export function formatValue(entry: SettingEntry): string {
  const val = entry.currentValue;
  if (val === null || val === undefined) return '(unset)';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string' && isSecretConfigKey(entry.setting.key)) return maskSecretValue(val);
  if (typeof val === 'string' && val === '') return '(empty)';
  return String(val);
}

export function valueColor(entry: SettingEntry): string {
  if (!entry.isDefault) return '#00ffcc'; // cyan-green = modified
  return '244';                            // dim = default
}

export function flagStateColor(state: string, killed: boolean): string {
  if (killed) return '#ef4444'; // red
  if (state === 'enabled') return '#00ffcc'; // cyan-green
  return '244'; // dim
}

export function mcpTrustColor(mode: McpEntry['trustMode']): string {
  switch (mode) {
    case 'allow-all':
      return '#ef4444';
    case 'ask-on-risk':
      return '#eab308';
    case 'constrained':
      return '#00ffcc';
    case 'blocked':
      return '244';
    default:
      return '244';
  }
}

export function subscriptionStateColor(state: SubscriptionEntry['state']): string {
  switch (state) {
    case 'active':
      return '#00ffcc';
    case 'pending':
      return '#eab308';
    case 'available':
      return '#38bdf8';
    default:
      return '244';
  }
}

export function inferSubscriptionRouteReason(entry: SubscriptionEntry): string | undefined {
  if (entry.routeReason?.trim()) return entry.routeReason;
  if (entry.state === 'active' && entry.oauthConfigured) {
    return 'ambient key override enabled for this provider.';
  }
  if (entry.state === 'pending' && entry.oauthConfigured) {
    return 'oauth configuration present; ambient key override will apply after activation.';
  }
  return undefined;
}

export const CATEGORY_LABELS: Record<(typeof SETTINGS_CATEGORIES)[number], string> = {
  display: 'Display',
  ui: 'UI',
  provider: 'Provider',
  subscriptions: 'Subscriptions',
  behavior: 'Behavior',
  storage: 'Storage',
  permissions: 'Permissions',
  diagnostics: 'Diagnostics',
  helper: 'Helper',
  tts: 'TTS',
  automation: 'Automation',
  checkin: 'Check-in',
  service: 'Service',
  controlPlane: 'Control Plane',
  httpListener: 'HTTP Listener',
  web: 'Web',
  watchers: 'Watchers',
  network: 'Network',
  orchestration: 'Orchestration',
  planner: 'Planner',
  daemon: 'Daemon',
  runtime: 'Runtime',
  sandbox: 'Sandbox',
  batch: 'Batch',
  cloudflare: 'Cloudflare',
  wrfc: 'WRFC',
  telemetry: 'Telemetry',
  cache: 'Cache',
  mcp: 'MCP',
  surfaces: 'Channels',
  release: 'Update Channel',
  tools: 'Tools',
  flags: 'Feature Controls',
  atRest: 'At-Rest Protection',
  learning: 'Memory Consolidation',
};

export const SETTING_LABELS: Partial<Record<string, string>> = {
  'ui.systemMessages': 'System Message Target',
  'ui.operationalMessages': 'Operational Message Target',
  'ui.voiceEnabled': 'Voice Interaction',
  'behavior.autoCompactThreshold': 'Auto-Compact %',
  'behavior.staleContextWarnings': 'Context Warnings',
  'behavior.returnContextMode': 'Return Context',
  'behavior.guidanceMode': 'Guidance Mode',
  'storage.secretPolicy': 'Secret Policy',
  'tools.llmProvider': 'Tool LLM Provider',
  'tools.llmModel': 'Tool LLM Model',
  'tools.autoHeal': 'Auto-Heal',
  'tools.defaultTokenBudget': 'Default Token Budget',
  'tools.hooksFile': 'Hooks File',
  'helper.enabled': 'Helper Enabled',
  'helper.globalProvider': 'Helper Provider',
  'helper.globalModel': 'Helper Model',
  'surfaces.ntfy.enabled': 'ntfy Enabled',
  'surfaces.ntfy.baseUrl': 'ntfy Base URL',
  'surfaces.ntfy.topic': 'ntfy Default Delivery Topic',
  'surfaces.ntfy.chatTopic': 'ntfy Chat Topic',
  'surfaces.ntfy.agentTopic': 'ntfy Agent Topic',
  'surfaces.ntfy.remoteTopic': 'ntfy Runtime-Only Remote Topic',
  'surfaces.ntfy.token': 'ntfy Token',
  'surfaces.ntfy.defaultPriority': 'ntfy Default Priority',
};

export function getSettingLabel(entry: SettingEntry): string {
  return SETTING_LABELS[entry.setting.key] ?? entry.setting.key.replace(/^[^.]+\./, '');
}

export function describeUiRouting(value: string): string {
  switch (value) {
    case 'panel':
      return 'render in panels only';
    case 'conversation':
      return 'render inline in conversation';
    case 'both':
      return 'render in both conversation and panels';
    default:
      return value;
  }
}
