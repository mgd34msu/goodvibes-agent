import { resolve } from 'node:path';

/**
 * Files this session wrote, and which tool wrote them.
 *
 * The agent can take a screenshot and then be unable to open it, because the
 * read policy refuses hidden directories and the platform's storage root is
 * `.goodvibes/…`. Writing screenshots into a visible folder in someone's
 * project to dodge that was a workaround, not an answer.
 *
 * The answer is provenance: a file the agent itself just created in this
 * session is not the kind of thing the hidden-path rule exists to protect. The
 * rule stays for everything else — this only ever widens to paths recorded
 * here, and never to anything secret-looking.
 */

export interface SessionWrite {
  readonly path: string;
  /** The tool that produced it, for the audit trail. */
  readonly tool: string;
  readonly at: string;
}

const writes = new Map<string, SessionWrite>();

export function recordSessionWrite(input: { readonly path: string; readonly tool: string; readonly now?: () => Date }): void {
  const absolute = resolve(input.path);
  writes.set(absolute, {
    path: absolute,
    tool: input.tool,
    at: (input.now?.() ?? new Date()).toISOString(),
  });
}

/** Whether this session authored the file at this path. */
export function wasWrittenThisSession(path: string): boolean {
  try {
    return writes.has(resolve(path));
  } catch {
    return false;
  }
}

export function sessionWrites(): readonly SessionWrite[] {
  return [...writes.values()];
}

export function resetSessionWriteProvenanceForTests(): void {
  writes.clear();
}
