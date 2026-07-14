import type { PowerState } from '@pellux/goodvibes-sdk/platform/power';

/**
 * The single-slot footer power note (see UIFactory.createFooter's rightNotice
 * chain, same slot the "copied" and "auto-approve is on" notices already
 * use). Priority order: the owner keep-awake toggle first (an ALWAYS-ON
 * override the user set explicitly, and per the SDK's own PowerManager
 * doc comment the chip — not a timer — is the safety mechanism while it's
 * on), then the automatic work-hold ("held because X") — real state names,
 * never invented. Returns null when neither applies (nothing to show).
 */
export function describePowerStatus(state: Pick<PowerState, 'work' | 'keepAwake'>): string | null {
  if (state.keepAwake.enabled) {
    const base = 'sleep disabled';
    return state.keepAwake.note ? `${base} — ${state.keepAwake.note}` : `${base} (keep-awake)`;
  }
  if (state.work.held && state.work.reasons.length > 0) {
    return `held: ${state.work.reasons.join('; ')}`;
  }
  return null;
}
