import type { PowerState } from '@pellux/goodvibes-sdk/platform/power';

/**
 * The footer power note (see UIFactory.createFooter's
 * composeSafetyNoticeSegments — it renders alongside dangerMode's
 * "auto-approve is on" notice, COMPOSED together rather than sharing one
 * suppressible slot, since both are safety-relevant and must stay visible at
 * once). Priority order for WHICH power note text to show: the owner
 * keep-awake toggle first (an ALWAYS-ON override the user set explicitly, and
 * per the SDK's own PowerManager doc comment the chip — not a timer — is the
 * safety mechanism while it's on), then the automatic work-hold ("held
 * because X") — real state names, never invented. Returns null when neither
 * applies (nothing to show).
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
