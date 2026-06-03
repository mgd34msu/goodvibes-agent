import type {
  ParsedRoutineSchedulePromotionArgs,
  RoutineScheduleDeliverySurfaceKind,
  RoutineScheduleDeliveryTargetSpec,
} from './routine-schedule-promotion.ts';

const DELIVERY_SURFACE_KINDS: readonly RoutineScheduleDeliverySurfaceKind[] = [
  'tui',
  'web',
  'slack',
  'discord',
  'ntfy',
  'webhook',
  'telegram',
  'google-chat',
  'signal',
  'whatsapp',
  'telephony',
  'imessage',
  'msteams',
  'bluebubbles',
  'mattermost',
  'matrix',
  'service',
];

function optionValue(args: readonly string[], index: number, inlineValue: string | undefined): {
  readonly value: string | undefined;
  readonly nextIndex: number;
} {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  const next = args[index + 1];
  if (next === undefined || next.startsWith('--')) return { value: undefined, nextIndex: index };
  return { value: next, nextIndex: index + 1 };
}

export function isRoutineScheduleDeliverySurfaceKind(value: string): value is RoutineScheduleDeliverySurfaceKind {
  return DELIVERY_SURFACE_KINDS.includes(value as RoutineScheduleDeliverySurfaceKind);
}

function parseChannelDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const [surfaceKind = '', routeId, label] = raw.split(':');
  if (!isRoutineScheduleDeliverySurfaceKind(surfaceKind)) {
    return `Unsupported delivery channel "${surfaceKind}".`;
  }
  return {
    kind: 'surface',
    surfaceKind,
    routeId: routeId?.trim() || undefined,
    label: label?.trim() || undefined,
  };
}

function parseRouteDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const [routeId = '', label] = raw.split(':');
  const normalizedRouteId = routeId.trim();
  if (!normalizedRouteId) return '--delivery-route requires a route id.';
  return {
    kind: 'surface',
    routeId: normalizedRouteId,
    label: label?.trim() || undefined,
  };
}

function parseWebhookDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const normalized = raw.trim();
  if (!normalized) return '--delivery-webhook requires a URL.';
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '--delivery-webhook must be an http(s) URL.';
  } catch {
    return '--delivery-webhook must be a valid URL.';
  }
  return {
    kind: 'webhook',
    address: normalized,
  };
}

function parseLinkDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const normalized = raw.trim();
  if (!normalized) return '--delivery-link requires a URL or label.';
  return {
    kind: 'link',
    address: normalized,
  };
}

function validateDeliveryTargets(targets: readonly RoutineScheduleDeliveryTargetSpec[]): string | null {
  const kinds = new Set(targets.map((target) => target.kind));
  return kinds.size > 1 ? 'Use one delivery target kind per routine promotion command.' : null;
}

export function parseRoutineSchedulePromotionArgs(args: readonly string[]): ParsedRoutineSchedulePromotionArgs {
  let routineId: string | null = null;
  let schedule: ParsedRoutineSchedulePromotionArgs['schedule'] = null;
  const deliveryTargets: RoutineScheduleDeliveryTargetSpec[] = [];
  let name: string | undefined;
  let timezone: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let enabled = true;
  let yes = false;
  const errors: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? '';
    const equals = raw.indexOf('=');
    const optionName = equals >= 0 ? raw.slice(0, equals) : raw;
    const inlineValue = equals >= 0 ? raw.slice(equals + 1) : undefined;

    if (raw === '--yes') {
      yes = true;
      continue;
    }
    if (raw === '--disabled') {
      enabled = false;
      continue;
    }
    if (optionName === '--name' || optionName === '--timezone' || optionName === '--provider' || optionName === '--model') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      if (optionName === '--name') name = value;
      if (optionName === '--timezone') timezone = value;
      if (optionName === '--provider') provider = value;
      if (optionName === '--model') model = value;
      continue;
    }
    if (optionName === '--cron' || optionName === '--every' || optionName === '--at') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      if (schedule) {
        errors.push('Choose exactly one schedule selector: --cron, --every, or --at.');
        continue;
      }
      schedule = {
        kind: optionName === '--cron' ? 'cron' : optionName === '--every' ? 'every' : 'at',
        value,
      };
      continue;
    }
    if (
      optionName === '--delivery-channel'
      || optionName === '--deliver-channel'
    ) {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseChannelDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (optionName === '--delivery-route' || optionName === '--deliver-route') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseRouteDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (optionName === '--delivery-webhook' || optionName === '--deliver-webhook') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseWebhookDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (optionName === '--delivery-link' || optionName === '--deliver-link') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseLinkDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (raw.startsWith('--')) {
      errors.push(`Unknown option ${raw}`);
      continue;
    }
    if (!routineId) {
      routineId = raw;
      continue;
    }
    errors.push(`Unexpected argument: ${raw}`);
  }

  if (!routineId) errors.push('Routine id or name is required.');
  if (!schedule) errors.push('Schedule is required: use --cron <expr>, --every <interval>, or --at <iso-time>.');
  const deliveryError = validateDeliveryTargets(deliveryTargets);
  if (deliveryError) errors.push(deliveryError);
  return { routineId, schedule, deliveryTargets, name, timezone, provider, model, enabled, yes, errors };
}
