import { existsSync, readFileSync } from 'node:fs';
import { AgentCalendarRegistry } from '../../agent/calendar-registry.ts';
import { parseIcs } from '../../agent/ics-calendar.ts';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { parseAgentLocalLibraryArgs } from './agent-local-library-args.ts';
import { requireShellPaths } from './runtime-services.ts';

const CALENDAR_VALUE_FLAGS = ['title', 'start', 'end', 'location', 'notes', 'dest', 'path', 'days'] as const;

function parseCalendarArgs(args: readonly string[]) {
  return parseAgentLocalLibraryArgs(args, { valueFlags: CALENDAR_VALUE_FLAGS });
}

function registryFromContext(ctx: CommandContext): AgentCalendarRegistry {
  return AgentCalendarRegistry.fromShellPaths(requireShellPaths(ctx));
}

function printError(ctx: CommandContext, error: unknown): void {
  ctx.print([
    'Error',
    `  message ${error instanceof Error ? error.message : String(error)}`,
  ].join('\n'));
}

function formatEventLine(e: { readonly id: string; readonly title: string; readonly start: string; readonly end?: string; readonly allDay: boolean; readonly location?: string }): string {
  const when = e.allDay ? e.start : e.start.slice(0, 16).replace('T', ' ');
  const loc = e.location ? `  at ${e.location}` : '';
  return `  ${e.id}  ${when}  ${e.title}${loc}`;
}

function renderEventList(events: readonly Parameters<typeof formatEventLine>[0][], path: string): string {
  if (events.length === 0) {
    return [
      'Local calendar events',
      `  store ${path}`,
      '  No events yet. Add one with /calendar add --title <title> --start <ISO> --yes',
    ].join('\n');
  }
  return [
    `Local calendar events (${events.length})`,
    `  store ${path}`,
    ...events.map(formatEventLine),
  ].join('\n');
}

export function runCalendarRuntimeCommand(args: readonly string[], ctx: CommandContext): void {
  const sub = (args[0] ?? 'list').toLowerCase();
  const registry = registryFromContext(ctx);

  try {
    // list / upcoming
    if (sub === 'list' || sub === 'all') {
      const snap = registry.snapshot();
      ctx.print(renderEventList([...snap.events], snap.path));
      return;
    }

    if (sub === 'upcoming') {
      const parsed = parseCalendarArgs(args.slice(1));
      const days = parsed.flags.has('days') ? Math.max(1, parseInt(parsed.flags.get('days') ?? '7', 10) || 7) : 7;
      const snap = registry.snapshot();
      const events = registry.upcoming(days);
      ctx.print(renderEventList([...events], snap.path));
      return;
    }

    // import <path> [--yes]
    if (sub === 'import') {
      const parsed = parseCalendarArgs(args.slice(1));
      const filePath = parsed.rest[0] ?? parsed.flags.get('path');
      if (!filePath) {
        ctx.print('Usage: /calendar import <path-to-ics> [--yes]');
        return;
      }
      if (!existsSync(filePath)) {
        ctx.print(`File not found: ${filePath}`);
        return;
      }
      const content = readFileSync(filePath, 'utf-8');
      if (!parsed.yes) {
        const preview = parseIcs(content);
        ctx.print([
          'Calendar import preview',
          `  file ${filePath}`,
          `  events found ${preview.length}`,
          ...preview.slice(0, 5).map((e) => `  - ${e.summary} (${e.dtstart})`),
          preview.length > 5 ? `  ... and ${preview.length - 5} more` : '',
          '  rerun with --yes to import',
        ].filter(Boolean).join('\n'));
        return;
      }
      const { imported, skipped, secretSkipped } = registry.importIcs(content);
      ctx.print([
        `Imported ${imported.length} event${imported.length === 1 ? '' : 's'} from ${filePath}`,
        ...imported.slice(0, 10).map((e) => `  ${e.id}  ${e.start}  ${e.title}`),
        imported.length > 10 ? `  ... and ${imported.length - 10} more` : '',
        skipped > 0 ? `Skipped ${skipped} event${skipped === 1 ? '' : 's'} that already exist.` : '',
        secretSkipped > 0 ? `Skipped ${secretSkipped} event${secretSkipped === 1 ? '' : 's'} for safety.` : '',
      ].filter(Boolean).join('\n'));
      return;
    }

    // export [--dest <path>] [--yes]
    if (sub === 'export') {
      const parsed = parseCalendarArgs(args.slice(1));
      const dest = parsed.flags.get('dest') ?? parsed.rest[0];
      if (!parsed.yes) {
        const events = registry.list();
        ctx.print([
          'Calendar export preview',
          `  events ${events.length}`,
          dest ? `  dest ${dest}` : '  output to stdout (no --dest given)',
          '  rerun with --yes to export',
        ].join('\n'));
        return;
      }
      const ics = registry.exportIcs(undefined, dest);
      if (!dest) {
        ctx.print(ics);
      } else {
        ctx.print(`Exported calendar to ${dest}`);
      }
      return;
    }

    // add --title <title> --start <ISO> [--end <ISO>] [--location <loc>] [--notes <notes>] --yes
    if (sub === 'add' || sub === 'create') {
      const parsed = parseCalendarArgs(args.slice(1));
      const title = parsed.flags.get('title')?.trim() ?? parsed.rest.join(' ').trim();
      const start = parsed.flags.get('start')?.trim();
      if (!title || !start) {
        ctx.print('Usage: /calendar add --title <title> --start <ISO-date-or-datetime> [--end <ISO>] [--location <loc>] [--notes <notes>] --yes');
        return;
      }
      if (!parsed.yes) {
        ctx.print([
          'Calendar event preview',
          `  title ${title}`,
          `  start ${start}`,
          parsed.flags.get('end') ? `  end   ${parsed.flags.get('end')}` : '',
          parsed.flags.get('location') ? `  location ${parsed.flags.get('location')}` : '',
          parsed.flags.get('notes') ? `  notes ${parsed.flags.get('notes')}` : '',
          '  rerun with --yes to save',
        ].filter(Boolean).join('\n'));
        return;
      }
      const event = registry.create({
        title,
        start,
        end: parsed.flags.get('end')?.trim(),
        location: parsed.flags.get('location')?.trim(),
        notes: parsed.flags.get('notes')?.trim(),
      });
      ctx.print([
        `Added calendar event ${event.id}`,
        `  id    ${event.id}`,
        `  title ${event.title}`,
        `  start ${event.start}`,
        event.end ? `  end   ${event.end}` : '',
      ].filter(Boolean).join('\n'));
      return;
    }

    // delete <id> --yes
    if (sub === 'delete' || sub === 'remove') {
      const parsed = parseCalendarArgs(args.slice(1));
      const id = parsed.rest[0];
      if (!id) {
        ctx.print('Usage: /calendar delete <id> --yes');
        return;
      }
      if (!parsed.yes) {
        const event = registry.get(id);
        if (!event) {
          ctx.print(`Unknown calendar event ${id}`);
          return;
        }
        ctx.print([
          `Delete calendar event preview`,
          `  id    ${event.id}`,
          `  title ${event.title}`,
          `  start ${event.start}`,
          '  rerun with --yes to delete',
        ].join('\n'));
        return;
      }
      const removed = registry.delete(id);
      ctx.print(`Deleted calendar event ${removed.id}  ${removed.title}`);
      return;
    }

    ctx.print('Usage: /calendar [list|upcoming [--days N]|import <path> [--yes]|export [--dest <path>] [--yes]|add --title <title> --start <ISO> --yes|delete <id> --yes]');
  } catch (error) {
    printError(ctx, error);
  }
}

export function registerCalendarRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'calendar',
    aliases: ['cal'],
    description: 'Manage local calendar events',
    hidden: true,
    usage: '[list|upcoming [--days N]|import <path> [--yes]|export [--dest <path>] [--yes]|add --title <title> --start <ISO> [--end <ISO>] [--location <loc>] [--notes <notes>] --yes|delete <id> --yes]',
    handler: async (args: readonly string[], ctx: CommandContext) => {
      runCalendarRuntimeCommand(args, ctx);
    },
  });
}
