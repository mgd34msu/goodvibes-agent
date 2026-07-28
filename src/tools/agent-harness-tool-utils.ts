import type { AgentHarnessToolArgs } from './agent-harness-tool-types.ts';

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function settingLookupArgs(args: AgentHarnessToolArgs) {
  return {
    key: readString(args.key) || undefined,
    target: readString(args.target) || undefined,
    query: readString(args.query) || undefined,
    category: readString(args.category) || undefined,
    prefix: readString(args.prefix) || undefined,
    includeHidden: args.includeHidden === true,
  };
}

/**
 * Reads a caller-supplied page size, bounded by a ceiling.
 *
 * `max` defaults to 500 because that suits the small catalogs, but a surface
 * whose catalog can outgrow it must pass its own — a ceiling below the catalog
 * silently drops the tail. Whatever ceiling applies, the caller of this
 * function still owes the response a `returned`/`total` pair (see
 * {@link catalogEnvelope}); clamping quietly is the failure this parameter
 * exists to make impossible to reach by accident.
 */
export function readLimit(value: unknown, fallback: number, max = 500): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return Math.max(1, Math.min(max, fallback));
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

export function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

/** Filter arguments a catalog query applied, by argument name. */
export type CatalogFilters = Readonly<Record<string, string | undefined>>;

/**
 * Builds the `{ <key>: [...], returned, total }` envelope every catalog mode
 * returns, and makes an empty page explain itself.
 *
 * A catalog used to answer `{"actions": [], "returned": 0, "total": 463}` — it
 * reported that hundreds of entries exist and named none of them, and it never
 * echoed the filter that had excluded them. A caller who passed, say,
 * `category:"actions"` (matching no category) could not tell its own argument
 * was the cause, so the only way forward was to guess repeatedly. The envelope
 * now always echoes the filters it applied, and when a page comes back empty it
 * says why and what to send instead.
 *
 * @param key      - Field name holding the page (e.g. 'actions', 'tools').
 * @param items    - The page itself.
 * @param total    - How many entries exist in the whole catalog.
 * @param filters  - Filter arguments that were applied, by argument name.
 * @param discovery - Route that lists everything, quoted in the guidance.
 */
/**
 * Collects the named filter arguments a catalog query received, dropping the
 * ones that were not supplied, ready for {@link catalogEnvelope}.
 */
export function catalogFilters(
  args: object,
  names: readonly string[],
): CatalogFilters {
  const source = args as Readonly<Record<string, unknown>>;
  const filters: Record<string, string> = {};
  for (const name of names) {
    const value = readString(source[name]);
    if (value) filters[name] = value;
  }
  return filters;
}

export function catalogEnvelope(
  key: string,
  items: readonly unknown[],
  total: number,
  filters: CatalogFilters = {},
  discovery?: string,
): Record<string, unknown> {
  const applied = Object.entries(filters)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0);

  const envelope: Record<string, unknown> = {
    [key]: items,
    returned: items.length,
    total,
    ...(applied.length > 0 ? { appliedFilters: Object.fromEntries(applied) } : {}),
  };

  if (total === 0) return envelope;

  // A SHORTENED page discloses that it is short.
  //
  // This envelope used to say nothing whenever it returned any rows at all, on
  // the reasoning that a populated page speaks for itself. It does not: "here
  // are 20 of 300" read as a complete answer is the same failure as an empty
  // page read as "no such capability", just in slower motion. `returned` and
  // `total` were always both present, but a number two fields away is easy to
  // miss in a way a sentence is not.
  if (items.length > 0) {
    if (items.length >= total) return envelope;
    const shownFilters = applied.map(([name, value]) => `${name}="${value}"`).join(', ');
    envelope.note = `Showing ${items.length} of ${total} ${key}. `
      + (shownFilters
        ? `This is a filtered view (${shownFilters}), not the full catalog`
        : 'This is a partial view, not the full catalog')
      + `${discovery ? `; re-send as ${discovery} to see everything` : ''}.`;
    return envelope;
  }

  const shown = applied.map(([name, value]) => `${name}="${value}"`).join(', ');
  envelope.note = applied.length > 0
    ? `No ${key} matched ${shown}. ${total} ${key} exist in this catalog`
      + `${discovery ? `; re-send as ${discovery} to list them all` : '; re-send without that filter to list them all'}`
      + ', or supply a different value.'
    : `This catalog reports ${total} ${key} but returned none for these arguments`
      + `${discovery ? `; ${discovery} lists them all` : ''}.`;
  return envelope;
}

export function output(value: unknown): { readonly success: true; readonly output: string } {
  return {
    success: true,
    output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  };
}

export function error(message: string): { readonly success: false; readonly error: string } { return { success: false, error: message }; }

export function requireConfirmedAction(args: AgentHarnessToolArgs, action: string): string | null {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) return `${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`;
  if (args.confirm !== true) return `${action} requires confirm:true after an explicit user request.`;
  return null;
}
