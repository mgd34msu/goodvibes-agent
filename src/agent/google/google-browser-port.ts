/**
 * Adapts the general-purpose `BrowserEngine` onto the small `GoogleBrowserPort`
 * surface the Google setup flows are written against.
 *
 * Two things live here:
 *
 *  1. `createGoogleBrowserPort` — a thin wrapper that hides session/page
 *     targeting from callers. The flows call `navigate`/`snapshot`/`click`/
 *     `type`/`readText`/`currentUrl` and never see a session id; the adapter
 *     remembers the session and page the first navigate opened and reuses it
 *     for every later call.
 *
 *  2. An element-finding helper (`findElement`/`requireElement`). Google's own
 *     pages carry no stable test ids, so every flow matches controls by
 *     accessible role and name. This is the single most brittle part of the
 *     whole integration, so a miss is designed to fail loudly and specifically
 *     — "looked for a button named X, the page showed these N controls
 *     instead" — rather than silently clicking the wrong thing.
 *
 * One honest limitation: `BrowserEngine.snapshot()` (the public surface this
 * adapter is allowed to call) does not return the DOM tag name of each
 * element — only its own internal, unexported snapshot store keeps that. So
 * `tag` on a `GoogleBrowserElement` produced by this adapter is a best-effort
 * guess derived from the accessible role (see `deriveTagFromRole`), not a
 * read of the real tag. Every flow matches by role and name; `tag` in
 * `findElement` queries is an optional extra filter, never load-bearing.
 */

import type { BrowserEngine, BrowserTarget } from '../../browser/browser-engine.ts';
import type { BrowserLaunchOptions } from '../../browser/browser-sessions.ts';
import type { GoogleBrowserElement, GoogleBrowserPort } from './google-setup-types.ts';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface GoogleBrowserPortOptions {
  /** Passed through to the engine's first navigate, when no session exists yet. */
  readonly launch?: BrowserLaunchOptions;
}

/** Best-effort DOM tag guessed from an accessible role. See module header. */
const ROLE_TAG_HINTS: Readonly<Record<string, string>> = {
  button: 'button',
  link: 'a',
  textbox: 'input',
  searchbox: 'input',
  combobox: 'select',
  checkbox: 'input',
  radio: 'input',
  switch: 'input',
  option: 'option',
  heading: 'h2',
  label: 'label',
  tab: 'div',
  menuitem: 'div',
};

function deriveTagFromRole(role: string): string {
  return ROLE_TAG_HINTS[role.toLowerCase()] ?? 'div';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(
      `google-browser-port: expected the browser engine to return a string field "${field}", got ${typeof value}.`,
    );
  }
  return value;
}

function toGoogleElement(raw: unknown): GoogleBrowserElement {
  if (!isRecord(raw)) {
    throw new Error('google-browser-port: expected a snapshot element to be an object.');
  }
  const ref = requireStringField(raw, 'ref');
  const role = requireStringField(raw, 'role');
  const name = requireStringField(raw, 'name');
  const value = typeof raw.value === 'string' ? raw.value : undefined;
  return { ref, role, name, tag: deriveTagFromRole(role), value };
}

function toGoogleElements(rawElements: unknown): readonly GoogleBrowserElement[] {
  if (!Array.isArray(rawElements)) {
    throw new Error('google-browser-port: expected the browser engine snapshot to return an "elements" array.');
  }
  return rawElements.map((entry: unknown) => toGoogleElement(entry));
}

/**
 * Builds a `GoogleBrowserPort` over a live `BrowserEngine`.
 *
 * The returned port owns exactly one implicit session/page pair: the first
 * `navigate()` call lets the engine open (or reuse) a session, and every call
 * after that targets the same session and page. Callers never pass or see a
 * session id.
 */
export function createGoogleBrowserPort(
  engine: BrowserEngine,
  options: GoogleBrowserPortOptions = {},
): GoogleBrowserPort {
  let sessionId: string | undefined;
  let pageId: string | undefined;

  function target(): BrowserTarget {
    return { sessionId, pageId };
  }

  function adopt(result: Record<string, unknown>): void {
    sessionId = requireStringField(result, 'sessionId');
    pageId = requireStringField(result, 'pageId');
  }

  return {
    async navigate(url) {
      const result = await engine.navigate(target(), { url, launch: options.launch });
      adopt(result);
      return { url: requireStringField(result, 'url'), title: requireStringField(result, 'title') };
    },

    async currentUrl() {
      // No dedicated "where am I" call exists on the engine; readText carries
      // the current url as a side field, so a minimal read doubles as one.
      const result = await engine.readText(target(), { maxChars: 1 });
      adopt(result);
      return requireStringField(result, 'url');
    },

    async snapshot() {
      const result = await engine.snapshot(target());
      adopt(result);
      return toGoogleElements(result.elements);
    },

    async click(ref) {
      const result = await engine.click(target(), { ref });
      adopt(result);
    },

    async type(ref, text, typeOptions) {
      const result = await engine.type(target(), { ref, text, submit: typeOptions?.submit });
      adopt(result);
    },

    async readText(readOptions) {
      const result = await engine.readText(target(), { maxChars: readOptions?.maxChars });
      adopt(result);
      return requireStringField(result, 'text');
    },
  };
}

// ---------------------------------------------------------------------------
// Element-finding
// ---------------------------------------------------------------------------

export interface GoogleElementQuery {
  readonly role?: string;
  readonly nameIncludes?: string;
  readonly namePattern?: RegExp;
  readonly tag?: string;
}

/** Case-insensitive, whitespace-normalized name for matching purposes. */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The first element in `elements` matching every part of `query`, or null. */
export function findElement(
  elements: readonly GoogleBrowserElement[],
  query: GoogleElementQuery,
): GoogleBrowserElement | null {
  const wantRole = query.role ? query.role.toLowerCase() : null;
  const wantTag = query.tag ? query.tag.toLowerCase() : null;
  const wantIncludes = query.nameIncludes ? normalizeName(query.nameIncludes) : null;
  for (const element of elements) {
    if (wantRole && element.role.toLowerCase() !== wantRole) continue;
    if (wantTag && element.tag.toLowerCase() !== wantTag) continue;
    if (wantIncludes && !normalizeName(element.name).includes(wantIncludes)) continue;
    if (query.namePattern && !query.namePattern.test(element.name)) continue;
    return element;
  }
  return null;
}

/** Describes what a query was looking for, in plain language. */
function describeQuery(query: GoogleElementQuery): string {
  const parts: string[] = [];
  if (query.role) parts.push(`role "${query.role}"`);
  if (query.tag) parts.push(`tag "${query.tag}"`);
  if (query.nameIncludes) parts.push(`a name containing "${query.nameIncludes}"`);
  if (query.namePattern) parts.push(`a name matching ${query.namePattern.toString()}`);
  return parts.length > 0 ? `an element with ${parts.join(' and ')}` : 'an element matching an empty query';
}

const DEFAULT_CANDIDATE_LIMIT = 10;

/** A short, human-readable listing of elements actually present, for diagnostics. */
export function describeElements(elements: readonly GoogleBrowserElement[], limit: number = DEFAULT_CANDIDATE_LIMIT): string {
  if (elements.length === 0) return 'no interactive elements were found in the snapshot';
  const sample = elements.slice(0, limit);
  const described = sample.map((element) => `${element.role} "${element.name}"`).join(', ');
  const remaining = elements.length - sample.length;
  return remaining > 0 ? `${described}, and ${String(remaining)} more` : described;
}

export interface GoogleElementFound {
  readonly found: true;
  readonly element: GoogleBrowserElement;
}

export interface GoogleElementNotFound {
  readonly found: false;
  readonly query: GoogleElementQuery;
  readonly candidateCount: number;
  /** Plain-language failure statement: what was looked for, what was there instead. */
  readonly message: string;
}

export type GoogleElementLookup = GoogleElementFound | GoogleElementNotFound;

/**
 * Like `findElement`, but the miss carries a typed, descriptive result instead
 * of `null` — the failure mode this module exists to make impossible to get
 * wrong silently.
 */
export function requireElement(
  elements: readonly GoogleBrowserElement[],
  query: GoogleElementQuery,
): GoogleElementLookup {
  const element = findElement(elements, query);
  if (element) return { found: true, element };
  const message = `Looked for ${describeQuery(query)}, but the page showed ${String(elements.length)} control${
    elements.length === 1 ? '' : 's'
  } instead: ${describeElements(elements)}.`;
  return { found: false, query, candidateCount: elements.length, message };
}

/**
 * True when the page looks like Google's sign-in flow rather than the page
 * the flow expected: either the url landed on accounts.google.com's sign-in
 * route, or the snapshot shows an actual password input (the redirect
 * sometimes keeps the original url briefly, so the url check alone is not
 * sufficient).
 *
 * The password-field check is deliberately scoped to `role: 'textbox'`
 * (a real input) rather than matching "password" anywhere in any element's
 * name — Google's own pages routinely use the word in headings and buttons
 * ("App passwords", "Create app password"), and matching those would
 * misreport a normal page as a sign-in redirect.
 */
export function looksLikeGoogleSignIn(url: string, elements: readonly GoogleBrowserElement[]): boolean {
  if (/accounts\.google\.com\/.*signin/i.test(url)) return true;
  return findElement(elements, { role: 'textbox', nameIncludes: 'password' }) !== null;
}
