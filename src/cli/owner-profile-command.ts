/**
 * owner-profile-command.ts — `goodvibes-agent owner-profile` over the daemon's
 * `profile.*` control-plane verbs (docs/owner-profile.md §11.1).
 *
 * Named `owner-profile`, not `profile`: `profile` is already an alias for
 * `profiles`, the isolated Agent profile homes, and quietly re-pointing it at a
 * different subject would break a command that works today. The platform
 * runtime's own module makes the same distinction (§3, naming note) — nothing
 * about the owner profile is called `profile` unqualified.
 *
 * Honesty rules, same as every other connected-host command here:
 * - Every write verb answers `ok`. `ok: false` covers a refusal AND a `forget`
 *   for a field that was not there; both exit non-zero with the daemon's own
 *   reason printed, and neither is ever reported as done (§9.2).
 * - No retry with a different authority.
 * - Values that come back are printed for HIM, at his own terminal. Nothing in
 *   this file logs a value, and `status` prints counts and field names only.
 */

import {
  createProfileGatewayInvoke,
  type ProfileGatewayInvoke,
} from '../agent/owner-profile-gateway.ts';
import {
  narrowProfileProvenance,
  narrowProfileRead,
  narrowProfileStatus,
  narrowProfileWrite,
  PROFILE_METHOD_IDS,
  PROFILE_RECORDING_SURFACE,
  PROFILE_RESPONSE_UNREADABLE,
} from '../tools/agent-profile-types.ts';
import { operatorFlagValue, parseOperatorCommandArgs } from './operator-command-args.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';

const READ_USAGE = 'Usage: goodvibes-agent owner-profile read';
const PROVENANCE_USAGE = 'Usage: goodvibes-agent owner-profile provenance <fieldId>';
const SET_USAGE = 'Usage: goodvibes-agent owner-profile set <fieldId> <value> [--said "<your words>"] --yes';
const FORGET_USAGE = 'Usage: goodvibes-agent owner-profile forget <fieldId> --yes';
const STATUS_USAGE = 'Usage: goodvibes-agent owner-profile status';
const OWNER_PROFILE_USAGE = [
  'Usage: goodvibes-agent owner-profile [read|provenance <fieldId>|set <fieldId> <value> --yes|forget <fieldId> --yes|status]',
  READ_USAGE,
  PROVENANCE_USAGE,
  SET_USAGE,
  FORGET_USAGE,
  STATUS_USAGE,
].join('\n');

/**
 * A command-line edit is him editing his own file, so it carries owner-direct
 * authority — the only one the daemon accepts — and, when he does not quote
 * himself with --said, the same kind of stand-in a settings-UI edit uses (§7
 * layer 3, §9.3). It is a truthful record of where the line came from: he typed
 * it here, not in conversation.
 */
const CLI_EDIT_SAID = '(edited from the command line)';

function jsonOrText(runtime: CliCommandRuntime, value: unknown, text: string): string {
  return runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(value, null, 2) : text;
}

function usageFailure(runtime: CliCommandRuntime, error: string): CliCommandOutput {
  return {
    output: jsonOrText(runtime, { ok: false, kind: 'invalid_owner_profile_command', error }, error),
    exitCode: 2,
  };
}

function gatewayFor(runtime: CliCommandRuntime): ProfileGatewayInvoke {
  // The CLI process composes no gateway catalog of its own, so every call goes
  // to the connected host that owns the file.
  return createProfileGatewayInvoke({
    configManager: runtime.configManager,
    homeDirectory: runtime.homeDirectory,
  });
}

async function handleRead(runtime: CliCommandRuntime, invoke: ProfileGatewayInvoke): Promise<CliCommandOutput> {
  const result = await invoke(PROFILE_METHOD_IDS.read, {});
  if (!result.ok) return { output: jsonOrText(runtime, result, result.error ?? 'Profile read failed.'), exitCode: 1 };
  const response = narrowProfileRead(result.data);
  if (!response) return { output: jsonOrText(runtime, result, PROFILE_RESPONSE_UNREADABLE), exitCode: 1 };
  if (response.state.kind === 'unavailable') {
    const text = [
      `Your profile could not be read: ${response.state.reason ?? 'no reason given'}`,
      `  ${response.state.path}`,
    ].join('\n');
    return { output: jsonOrText(runtime, response, text), exitCode: 1 };
  }
  if (response.state.kind === 'disabled') {
    return {
      output: jsonOrText(runtime, response, `Your profile is turned off (${response.state.path}).`),
      exitCode: 1,
    };
  }
  const lines: string[] = [`Owner profile (${response.state.path})`];
  if (response.state.exists === false) lines.push('  The file does not exist yet; nothing has been recorded.');
  for (const section of response.sections) {
    lines.push(`  ## ${section.heading}`);
    if (section.fields.length === 0 && section.prose.length === 0) {
      lines.push('    (nothing recorded)');
      continue;
    }
    for (const field of section.fields) {
      const suffix = field.provenance
        ? ` — ${field.provenance.surface}, ${field.provenance.date}, "${field.provenance.said}"`
        : '';
      const invalid = field.valid ? '' : `  (did not parse: ${field.invalidReason ?? 'no reason given'})`;
      lines.push(`    ${field.label}: ${field.value}${suffix}${invalid}`);
    }
    for (const line of section.prose) {
      const suffix = line.provenance
        ? ` — ${line.provenance.surface}, ${line.provenance.date}, "${line.provenance.said}"`
        : '';
      lines.push(`    ${line.text}${suffix}`);
    }
  }
  return { output: jsonOrText(runtime, response, lines.join('\n')), exitCode: 0 };
}

async function handleProvenance(
  runtime: CliCommandRuntime,
  invoke: ProfileGatewayInvoke,
  args: readonly string[],
): Promise<CliCommandOutput> {
  const parsed = parseOperatorCommandArgs(args);
  const fieldId = parsed.positionals[0];
  if (!fieldId) return usageFailure(runtime, PROVENANCE_USAGE);
  const result = await invoke(PROFILE_METHOD_IDS.provenance, { fieldId });
  if (!result.ok) return { output: jsonOrText(runtime, result, result.error ?? 'Provenance read failed.'), exitCode: 1 };
  const response = narrowProfileProvenance(result.data);
  if (!response) return { output: jsonOrText(runtime, result, PROFILE_RESPONSE_UNREADABLE), exitCode: 1 };
  if (!response.present) {
    return {
      output: jsonOrText(runtime, response, `${response.fieldId} is not in your profile; there is nothing to trace.`),
      exitCode: 1,
    };
  }
  const lines = [`${response.fieldId}`];
  if (response.provenance) {
    lines.push(`  from ${response.provenance.surface} on ${response.provenance.date}, you said: "${response.provenance.said}"`);
  } else if (response.handEdited) {
    lines.push('  no provenance recorded; you edited this line by hand.');
  } else {
    lines.push('  no provenance recorded.');
  }
  for (const record of response.superseded) {
    const parts = [
      record.value,
      record.provenance ? `via ${record.provenance.surface}` : '',
      record.provenance ? `on ${record.provenance.date}` : '',
      record.provenance ? `you said: "${record.provenance.said}"` : '',
      `superseded ${record.supersededOn}`,
    ].filter(Boolean);
    lines.push(`  was: ${parts.join(', ')}`);
  }
  return { output: jsonOrText(runtime, response, lines.join('\n')), exitCode: 0 };
}

async function handleSet(
  runtime: CliCommandRuntime,
  invoke: ProfileGatewayInvoke,
  args: readonly string[],
): Promise<CliCommandOutput> {
  const parsed = parseOperatorCommandArgs(args, ['said']);
  const fieldId = parsed.positionals[0];
  const value = parsed.positionals.slice(1).join(' ').trim();
  if (!fieldId || !value) return usageFailure(runtime, SET_USAGE);
  if (!parsed.yes) {
    return { output: `Refusing to write ${fieldId} without --yes.`, exitCode: 2 };
  }
  const said = operatorFlagValue(parsed, 'said') ?? CLI_EDIT_SAID;
  const result = await invoke(PROFILE_METHOD_IDS.set, {
    fieldId,
    value,
    surface: PROFILE_RECORDING_SURFACE,
    said,
    authority: 'owner-direct',
  });
  if (!result.ok) return { output: jsonOrText(runtime, result, result.error ?? 'Profile write failed.'), exitCode: 1 };
  const response = narrowProfileWrite(result.data);
  if (!response) return { output: jsonOrText(runtime, result, PROFILE_RESPONSE_UNREADABLE), exitCode: 1 };
  if (!response.ok) {
    const text = [`Not done: ${fieldId} was not recorded.`, `  reason: ${response.reason ?? 'no reason given'}`].join('\n');
    return { output: jsonOrText(runtime, response, text), exitCode: 1 };
  }
  return {
    output: jsonOrText(runtime, response, response.disclosure || `Noted — saved ${fieldId} to your profile.`),
    exitCode: 0,
  };
}

async function handleForget(
  runtime: CliCommandRuntime,
  invoke: ProfileGatewayInvoke,
  args: readonly string[],
): Promise<CliCommandOutput> {
  const parsed = parseOperatorCommandArgs(args);
  const fieldId = parsed.positionals[0];
  if (!fieldId) return usageFailure(runtime, FORGET_USAGE);
  if (!parsed.yes) {
    return { output: `Refusing to forget ${fieldId} without --yes.`, exitCode: 2 };
  }
  const result = await invoke(PROFILE_METHOD_IDS.forget, { fieldId, authority: 'owner-direct' });
  if (!result.ok) return { output: jsonOrText(runtime, result, result.error ?? 'Profile delete failed.'), exitCode: 1 };
  const response = narrowProfileWrite(result.data);
  if (!response) return { output: jsonOrText(runtime, result, PROFILE_RESPONSE_UNREADABLE), exitCode: 1 };
  if (!response.ok) {
    // Covers both "refused" and "there was nothing to forget". Neither is ok,
    // and the daemon's own reason says which — this never claims a deletion.
    const text = [`Not done: ${fieldId} was not deleted.`, `  reason: ${response.reason ?? 'no reason given'}`].join('\n');
    return { output: jsonOrText(runtime, response, text), exitCode: 1 };
  }
  return {
    output: jsonOrText(runtime, response, response.disclosure || `Deleted ${fieldId} from your profile.`),
    exitCode: 0,
  };
}

async function handleStatus(runtime: CliCommandRuntime, invoke: ProfileGatewayInvoke): Promise<CliCommandOutput> {
  const result = await invoke(PROFILE_METHOD_IDS.status, {});
  if (!result.ok) return { output: jsonOrText(runtime, result, result.error ?? 'Profile status failed.'), exitCode: 1 };
  const response = narrowProfileStatus(result.data);
  if (!response) return { output: jsonOrText(runtime, result, PROFILE_RESPONSE_UNREADABLE), exitCode: 1 };
  const lines = [`Owner profile: ${response.kind}`];
  if (response.reason) lines.push(`  ${response.reason}`);
  lines.push(`  path ${response.path}`);
  if (response.exists === false) lines.push('  the file does not exist yet');
  if (response.sections && response.sections.length > 0) lines.push(`  sections ${response.sections.join(', ')}`);
  if (response.lineCount !== undefined) lines.push(`  lines ${response.lineCount}`);
  if (response.fieldCount !== undefined) lines.push(`  fields ${response.fieldCount}`);
  if (response.proseLineCount !== undefined) lines.push(`  prose lines ${response.proseLineCount}`);
  const invalid = response.invalidFields ?? [];
  if (invalid.length === 0) {
    lines.push('  no invalid fields');
  } else {
    for (const entry of invalid) lines.push(`  invalid ${entry.fieldId}: ${entry.reason}`);
  }
  return { output: jsonOrText(runtime, response, lines.join('\n')), exitCode: response.kind === 'loaded' ? 0 : 1 };
}

/**
 * `invoke` defaults to the connected-host route and is injectable so the
 * command's own honesty rules — a refusal printed with its reason, a delete
 * that was a no-op reported as a no-op — are testable without a live daemon.
 */
export async function handleOwnerProfileCommand(
  runtime: CliCommandRuntime,
  invoke: ProfileGatewayInvoke = gatewayFor(runtime),
): Promise<CliCommandOutput> {
  const [sub = 'read', ...rest] = runtime.cli.commandArgs;
  switch (sub.toLowerCase()) {
    case 'read':
    case 'show':
    case 'list':
      return handleRead(runtime, invoke);
    case 'provenance':
    case 'source':
    case 'where':
      return handleProvenance(runtime, invoke, rest);
    case 'set':
      return handleSet(runtime, invoke, rest);
    case 'forget':
    case 'delete':
    case 'remove':
      return handleForget(runtime, invoke, rest);
    case 'status':
      return handleStatus(runtime, invoke);
    default:
      return usageFailure(runtime, OWNER_PROFILE_USAGE);
  }
}
