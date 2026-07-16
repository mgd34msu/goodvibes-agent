export const AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON = 'This raw daemon/listener danger toggle is protected. Use an explicit confirmed operator action or setup command for lifecycle changes.';

const AGENT_HIDDEN_SETTING_PREFIXES = [
  'danger.',
] as const;

const AGENT_HIDDEN_SETTING_KEYS = new Set<string>([
  'ui.wrfcMessages',
]);

const EXTERNAL_HOST_SETTING_PREFIXES = [
  // Outbound relay reachability is a daemon lifecycle concern (dial-out,
  // identity custody, WebAuthn step-up enforcement) owned by whichever
  // GoodVibes host Agent is connected to. Agent's own copy of these keys is
  // an imported/local snapshot (see README's "shared GoodVibes settings
  // import"), not a live-shared file — toggling relay.enabled here would not
  // actually start or stop the connected daemon's relay registration, so the
  // whole domain is locked exactly like danger.httpListener below.
  'relay.',
] as const;

const EXTERNAL_HOST_SETTING_KEYS = new Set<string>([
  'danger.httpListener',
]);

export function isExternalHostOwnedSettingKey(key: string): boolean {
  return EXTERNAL_HOST_SETTING_KEYS.has(key)
    || EXTERNAL_HOST_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export const AGENT_MEMORY_GOVERNANCE_INERT_LOCK_REASON = 'This Agent build has no memory-governance layer (the SDK\'s CacheRegistry/MemoryGovernor have no public export path yet), so no governor reads this value here. Editing it has no effect in this build.';

const MEMORY_GOVERNANCE_SETTING_PREFIXES = [
  // The SDK's memory-governance layer (CacheRegistry/PauseController/
  // MemoryGovernor) has no public export path on the pinned SDK build this
  // Agent composes against (see runtime/services.ts's composition-root note,
  // right before wireRuntimePower, for the full verified defect writeup), so
  // this Agent constructs no real governor to read these values. Distinct
  // from EXTERNAL_HOST_SETTING_PREFIXES above (an ownership decision): this is
  // an SDK export-surface gap, reported upstream, not an architectural
  // boundary — these keys stay visible (not hidden) but locked with an
  // honest reason so the settings UI never implies the toggle does something.
  'memory.',
] as const;

export function isMemoryGovernanceInertSettingKey(key: string): boolean {
  return MEMORY_GOVERNANCE_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isAgentHiddenSettingKey(key: string): boolean {
  return AGENT_HIDDEN_SETTING_KEYS.has(key)
    || AGENT_HIDDEN_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}
