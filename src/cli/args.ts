export interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set(['json', 'wrfc', 'yes']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = 'tui', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(raw)) {
      flags.set(raw, true);
      continue;
    }
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(raw, next);
      index += 1;
    } else {
      flags.set(raw, true);
    }
  }
  return { command, positional, flags };
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function getFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function getText(args: ParsedArgs): string {
  return args.positional.join(' ').trim();
}
