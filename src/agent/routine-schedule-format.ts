import {
  ROUTINE_SCHEDULE_LIST_METHOD,
  ROUTINE_SCHEDULE_METHOD,
  type RoutineScheduleCorrelationResult,
  type RoutineSchedulePromotionFailure,
  type RoutineSchedulePromotionPreview,
  type RoutineSchedulePromotionSuccess,
  type RoutineScheduleReceipt,
  type RoutineScheduleReceiptSnapshot,
} from './routine-schedule-promotion.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function formatDeliveryTargetKind(target: { readonly kind?: string; readonly surfaceKind?: string }): string {
  if (target.kind === 'surface') return `channel${target.surfaceKind ? `/${target.surfaceKind}` : ''}`;
  return `${target.kind ?? 'unknown'}${target.surfaceKind ? `/${target.surfaceKind}` : ''}`;
}

export function formatRoutineSchedulePreview(preview: RoutineSchedulePromotionPreview): string {
  const schedule = preview.payload.kind === 'cron'
    ? `${preview.payload.cron}${preview.payload.timezone ? ` [${preview.payload.timezone}]` : ''}`
    : preview.payload.kind === 'every'
      ? String(preview.payload.every)
      : String(preview.payload.at);
  const delivery = preview.payload.delivery;
  const deliveryTargetCount = delivery?.targets.length ?? 0;
  return [
    'GoodVibes schedule preview for Agent routine',
    `  routine: ${preview.routineName} (${preview.routineId})`,
    `  route: ${preview.method} ${preview.route}`,
    `  name: ${String(preview.payload.name ?? '(runtime default)')}`,
    `  schedule: ${preview.payload.kind} ${schedule}`,
    `  enabled: ${preview.payload.enabled === false ? 'no' : 'yes'}`,
    `  delivery: ${delivery?.mode ?? 'none'}${deliveryTargetCount > 0 ? ` (${deliveryTargetCount} target${deliveryTargetCount === 1 ? '' : 's'})` : ''}`,
    '  target: GoodVibes runtime/main conversation route',
    '  policy: isolated Agent Knowledge only; no default wiki/non-Agent fallback; no WRFC unless explicitly delegated',
    '  next: rerun with --yes to create this external schedule',
  ].join('\n');
}

export function formatRoutineScheduleSuccess(result: RoutineSchedulePromotionSuccess): string {
  const record: Record<string, unknown> = isRecord(result.schedule) ? result.schedule : {};
  const id = readString(record, 'id') ?? '(unknown)';
  const status = readString(record, 'status') ?? (record.enabled === false ? 'paused' : 'enabled');
  return [
    'Created GoodVibes schedule for Agent routine',
    `  routine: ${result.routineName} (${result.routineId})`,
    `  schedule: ${id}`,
    `  status: ${status}`,
    `  route: ${result.kind} ${result.route}`,
    '  next: inspect with /schedule list or schedule observability',
  ].join('\n');
}

export function formatRoutineScheduleReceipts(snapshot: RoutineScheduleReceiptSnapshot, limit = 10): string {
  const receipts = snapshot.receipts.slice(0, Math.max(1, limit));
  if (snapshot.receipts.length === 0) {
    return [
      'Agent routine schedule receipts',
      `  store: ${snapshot.path}`,
      '  No routine schedule promotions have been recorded yet.',
      '  Create one with /schedule promote-routine <routine-id> --cron <expr> --yes.',
    ].join('\n');
  }
  return [
    `Agent routine schedule receipts (${snapshot.receipts.length})`,
    `  store: ${snapshot.path}`,
    ...receipts.map((receipt) => {
      const schedule = receipt.scheduleId ? ` schedule=${receipt.scheduleId}` : '';
      const failure = receipt.status === 'failed' && receipt.failureKind ? ` failure=${receipt.failureKind}` : '';
      return `  ${receipt.id}  ${receipt.status}  ${receipt.scheduleKind} ${receipt.scheduleValue}  routine=${receipt.routineId}${schedule}${failure}`;
    }),
    snapshot.receipts.length > receipts.length ? `  ...${snapshot.receipts.length - receipts.length} more` : '',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatRoutineScheduleReceipt(receipt: RoutineScheduleReceipt): string {
  return [
    `Agent routine schedule receipt ${receipt.id}`,
    `  created: ${receipt.createdAt}`,
    `  status: ${receipt.status}`,
    `  routine: ${receipt.routineName} (${receipt.routineId})`,
    `  route: ${receipt.method} ${receipt.route}`,
    `  runtime: ${receipt.daemonBaseUrl}`,
    `  schedule: ${receipt.scheduleName}${receipt.scheduleId ? ` (${receipt.scheduleId})` : ''}`,
    receipt.scheduleStatus ? `  schedule status: ${receipt.scheduleStatus}` : '',
    `  cadence: ${receipt.scheduleKind} ${receipt.scheduleValue}${receipt.timezone ? ` [${receipt.timezone}]` : ''}`,
    `  enabled: ${receipt.enabled ? 'yes' : 'no'}`,
    receipt.provider ? `  provider: ${receipt.provider}` : '',
    receipt.model ? `  model: ${receipt.model}` : '',
    `  target: ${formatDeliveryTargetKind(receipt.target)}`,
    receipt.deliveryMode ? `  delivery: ${receipt.deliveryMode}` : '',
    ...(receipt.deliveryTargets ?? []).map((target) => `  delivery target: ${formatDeliveryTargetKind(target)}${target.routeId ? ` route=${target.routeId}` : ''}${target.address ? ` address=${target.address}` : ''}${target.label ? ` label=${target.label}` : ''}`),
    receipt.failureKind ? `  failure: ${receipt.failureKind}` : '',
    receipt.failureError ? `  error: ${receipt.failureError}` : '',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatRoutineScheduleCorrelation(result: RoutineScheduleCorrelationResult, limit = 10): string {
  if (!result.ok) {
    return [
      `GoodVibes schedule reconciliation error: ${result.kind}`,
      `  ${result.error}`,
      result.baseUrl ? `  runtime: ${result.baseUrl}` : null,
      `  route: ${ROUTINE_SCHEDULE_LIST_METHOD} ${result.route}`,
      result.kind === 'auth_required'
        ? '  next: pair/authenticate with the external GoodVibes runtime, then retry.'
        : null,
      result.kind === 'daemon_unavailable'
        ? '  next: start/restart the GoodVibes runtime outside Agent, then retry.'
        : null,
      result.kind === 'version_mismatch' || result.kind === 'daemon_route_unavailable'
        ? '  next: update/restart the external GoodVibes runtime so public schedules.list is available.'
        : null,
    ].filter((line): line is string => Boolean(line)).join('\n');
  }
  const correlations = result.correlations.slice(0, Math.max(1, limit));
  if (result.receiptCount === 0) {
    return [
      'Agent routine schedule reconciliation',
      `  runtime: ${result.baseUrl}`,
      `  route: ${result.kind} ${result.route}`,
      `  live schedules: ${result.scheduleCount}`,
      '  No local routine promotion receipts exist yet.',
      '  Create one with /schedule promote-routine <routine-id> --cron <expr> --yes.',
    ].join('\n');
  }
  const matched = result.correlations.filter((entry) => entry.liveStatus === 'matched').length;
  const missing = result.correlations.filter((entry) => entry.liveStatus === 'missing').length;
  const failed = result.correlations.filter((entry) => entry.liveStatus === 'failed-receipt').length;
  return [
    'Agent routine schedule reconciliation',
    `  runtime: ${result.baseUrl}`,
    `  route: ${result.kind} ${result.route}`,
    `  receipts: ${result.receiptCount}; live schedules: ${result.scheduleCount}; matched: ${matched}; missing: ${missing}; failed receipts: ${failed}`,
    ...correlations.map((entry) => {
      const receipt = entry.receipt;
      const schedule = entry.schedule;
      const live = schedule
        ? ` live=${schedule.id} status=${schedule.status ?? (schedule.enabled === false ? 'paused' : 'enabled')}`
        : '';
      const runs = schedule && schedule.runCount !== undefined
        ? ` runs=${schedule.runCount}/${schedule.successCount ?? 0}/${schedule.failureCount ?? 0}`
        : '';
      const next = schedule?.nextRunAt ? ` next=${new Date(schedule.nextRunAt).toISOString()}` : '';
      return `  ${receipt.id}  ${entry.liveStatus}  reason=${entry.matchReason}  routine=${receipt.routineId}  receiptSchedule=${receipt.scheduleId ?? '(none)'}${live}${runs}${next}`;
    }),
    result.correlations.length > correlations.length ? `  ...${result.correlations.length - correlations.length} more` : '',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatRoutineScheduleFailure(failure: RoutineSchedulePromotionFailure): string {
  return [
    `GoodVibes schedule error: ${failure.kind}`,
    `  ${failure.error}`,
    failure.baseUrl ? `  runtime: ${failure.baseUrl}` : null,
    `  route: ${ROUTINE_SCHEDULE_METHOD} ${failure.route}`,
    failure.kind === 'version_mismatch' && failure.daemonVersion && failure.expectedSdkVersion
      ? `  versions: runtime=${failure.daemonVersion} expected=${failure.expectedSdkVersion}`
      : null,
    failure.kind === 'auth_required'
      ? '  next: pair/authenticate with the external GoodVibes runtime, then retry with --yes.'
      : null,
    failure.kind === 'daemon_unavailable'
        ? '  next: start/restart the GoodVibes runtime outside Agent, then retry.'
      : null,
    failure.kind === 'version_mismatch' || failure.kind === 'daemon_route_unavailable'
      ? '  next: update/restart the external GoodVibes runtime so public schedules.create is available.'
      : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}
