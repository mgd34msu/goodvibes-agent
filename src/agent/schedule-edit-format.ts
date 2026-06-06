import { formatEveryInterval } from '@pellux/goodvibes-sdk/platform/automation';
import type {
  ScheduleEditFailure,
  ScheduleEditPreview,
  ScheduleEditSuccess,
} from './schedule-edit.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function scheduleValue(schedule: unknown): string {
  if (!isRecord(schedule)) return 'unchanged';
  if (schedule.kind === 'cron') {
    return [
      readString(schedule, 'expression') ?? '',
      readString(schedule, 'timezone') ? `[${readString(schedule, 'timezone')}]` : '',
      typeof schedule.staggerMs === 'number' ? `[stagger ${schedule.staggerMs}ms]` : '',
    ].filter(Boolean).join(' ');
  }
  if (schedule.kind === 'every' && typeof schedule.intervalMs === 'number') return formatEveryInterval(schedule.intervalMs);
  if (schedule.kind === 'at' && typeof schedule.at === 'number') return new Date(schedule.at).toISOString();
  return String(schedule.kind ?? 'unknown');
}

function patchScheduleValue(preview: ScheduleEditPreview): string {
  return scheduleValue(preview.payload.schedule);
}

function responseRecord(result: ScheduleEditSuccess): Record<string, unknown> {
  return isRecord(result.schedule) ? result.schedule : {};
}

function formatScheduleEditFailureKind(kind: ScheduleEditFailure['kind']): string {
  if (kind === 'confirmation_required') return 'confirmation required';
  if (kind === 'auth_required') return 'authorization required';
  if (kind === 'connected_host_unavailable') return 'connected host unavailable';
  if (kind === 'connected_host_incompatible') return 'connected host incompatible';
  if (kind === 'connected_host_route_unavailable') return 'connected host route unavailable';
  return 'connected host error';
}

export function formatScheduleEditPreview(preview: ScheduleEditPreview): string {
  return [
    'GoodVibes schedule edit preview',
    `  method ${preview.method}`,
    `  route PATCH ${preview.route.replace('{jobId}', preview.scheduleId)}`,
    `  schedule ${preview.scheduleId}`,
    `  changes ${preview.changes.join(', ')}`,
    preview.payload.name ? `  name ${preview.payload.name}` : '',
    preview.payload.schedule ? `  schedule ${patchScheduleValue(preview)}` : '',
    preview.payload.prompt ? '  prompt replacement prepared' : '',
    `  requested by ${preview.explicitUserRequest}`,
    '',
    'Confirmation required: rerun with --yes or call the model tool with confirm:true only when the user explicitly asked for this exact schedule edit.',
  ].filter((line) => line !== '').join('\n');
}

export function formatScheduleEditSuccess(result: ScheduleEditSuccess): string {
  const record = responseRecord(result);
  const id = readString(record, 'id') ?? result.scheduleId;
  const status = readString(record, 'status') ?? (record.enabled === false ? 'paused' : record.enabled === true ? 'enabled' : 'ok');
  return [
    'Updated GoodVibes schedule',
    `  schedule ${id}`,
    `  method ${result.kind}`,
    `  route PATCH ${result.route.replace('{jobId}', result.scheduleId)}`,
    `  status ${status}`,
    isRecord(record.schedule) ? `  schedule ${scheduleValue(record.schedule)}` : '',
    '  next inspect with /schedule list or agent_harness mode:"autonomy_queue_item" queueItemId:"connected-schedules"',
  ].filter((line) => line !== '').join('\n');
}

export function formatScheduleEditFailure(failure: ScheduleEditFailure): string {
  return [
    `GoodVibes schedule edit error ${formatScheduleEditFailureKind(failure.kind)}`,
    `  route PATCH ${failure.route}`,
    failure.baseUrl ? `  connected host ${failure.baseUrl}` : '',
    `  error ${failure.error}`,
    failure.kind === 'auth_required'
      ? '  next pair or start the connected GoodVibes host so an operator token is available.'
      : '',
    failure.kind === 'connected_host_incompatible'
      ? '  next update the connected GoodVibes host so automation.jobs.patch is available.'
      : '',
  ].filter((line) => line !== '').join('\n');
}
