import type { Locator, Page } from 'playwright-core';
import type { BrowserElementRef, BrowserSnapshot } from './browser-types.ts';

/**
 * Snapshot-and-ref addressing.
 *
 * Every input action targets an element that came from a snapshot of a page
 * this tool controls, and the element's identity is re-checked immediately
 * before the action runs. There is no code path that types into "whatever has
 * focus": without a resolvable ref, an action fails instead of guessing.
 */

const MAX_ELEMENTS = 400;
const MAX_NAME_LENGTH = 160;

interface RawElement {
  readonly tag: string;
  readonly role: string;
  readonly name: string;
  readonly selector: string;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly checked: boolean | null;
  readonly depth: number;
}

/**
 * Runs inside the page. It must be entirely self-contained — it is serialized
 * and evaluated in the browser, so it cannot reference anything from module
 * scope. It reads the DOM and never mutates it: no injected attributes, no
 * markers left behind in the user's real, logged-in page.
 */
function collectElements(limit: number): RawElement[] {
  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[onclick]',
    'h1',
    'h2',
    'h3',
    'label',
  ].join(',');

  const isVisible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  const cssEscape = (value: string): string => {
    if (typeof window.CSS?.escape === 'function') return window.CSS.escape(value);
    return value.replace(/[^\w-]/g, (character) => `\\${character}`);
  };

  const selectorFor = (element: Element): string => {
    if (element.id && document.querySelectorAll(`#${cssEscape(element.id)}`).length === 1) {
      return `#${cssEscape(element.id)}`;
    }
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      if (!parent) break;
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${String(index)})` : tag);
      current = parent;
    }
    return parts.length > 0 ? `html > body ${parts.join(' > ')}`.replace('html > body body', 'html > body') : 'html';
  };

  const roleFor = (element: Element): string => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') return element.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'label') return 'label';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') return 'heading';
    if (tag === 'input') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    return 'generic';
  };

  const nameFor = (element: Element): string => {
    const labelled = element.getAttribute('aria-label')
      ?? element.getAttribute('alt')
      ?? element.getAttribute('placeholder')
      ?? element.getAttribute('title');
    if (labelled && labelled.trim()) return labelled.trim();
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const target = document.getElementById(labelledBy);
      if (target?.textContent?.trim()) return target.textContent.trim();
    }
    if (element.tagName === 'INPUT') {
      const input = element as HTMLInputElement;
      const type = (input.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') return input.value;
      const label = input.labels?.[0]?.textContent?.trim();
      if (label) return label;
      const name = input.getAttribute('name');
      if (name) return name;
      return '';
    }
    const text = (element as HTMLElement).innerText ?? element.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const depthOf = (element: Element): number => {
    let depth = 0;
    let current: Element | null = element.parentElement;
    while (current) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };

  const results: RawElement[] = [];
  const seen = new Set<Element>();
  for (const element of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
    if (results.length >= limit) break;
    if (seen.has(element)) continue;
    seen.add(element);
    if (!isVisible(element)) continue;
    const tag = element.tagName.toLowerCase();
    const input = element as HTMLInputElement;
    const isFormControl = tag === 'input' || tag === 'textarea' || tag === 'select';
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    results.push({
      tag,
      role: roleFor(element),
      name: nameFor(element).slice(0, 160),
      selector: selectorFor(element),
      value: isFormControl && type !== 'password' ? String(input.value ?? '') : null,
      disabled: isFormControl ? Boolean(input.disabled) : false,
      checked: type === 'checkbox' || type === 'radio' ? Boolean(input.checked) : null,
      depth: depthOf(element),
    });
  }
  return results;
}

/** Reads back one element's identity so a ref can be re-verified before use. */
function describeElement(element: Element): { readonly tag: string; readonly name: string } {
  const labelled = element.getAttribute('aria-label')
    ?? element.getAttribute('alt')
    ?? element.getAttribute('placeholder')
    ?? element.getAttribute('title');
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    const type = (input.getAttribute('type') ?? 'text').toLowerCase();
    const buttonName = type === 'submit' || type === 'button' || type === 'reset' ? input.value : '';
    return {
      tag: element.tagName.toLowerCase(),
      name: (labelled ?? buttonName ?? input.labels?.[0]?.textContent ?? input.getAttribute('name') ?? '').trim().slice(0, 160),
    };
  }
  if (labelled && labelled.trim()) {
    return { tag: element.tagName.toLowerCase(), name: labelled.trim().slice(0, 160) };
  }
  const text = (element as HTMLElement).innerText ?? element.textContent ?? '';
  return { tag: element.tagName.toLowerCase(), name: text.replace(/\s+/g, ' ').trim().slice(0, 160) };
}

let snapshotCounter = 0;

export class StaleElementError extends Error {
  constructor(message: string, readonly fix: string) {
    super(message);
    this.name = 'StaleElementError';
  }
}

/** Snapshots taken per page, so a ref can only be used against the page that produced it. */
export class SnapshotStore {
  private readonly snapshots = new Map<string, BrowserSnapshot>();

  set(snapshot: BrowserSnapshot): void {
    this.snapshots.set(`${snapshot.sessionId}:${snapshot.pageId}`, snapshot);
  }

  get(sessionId: string, pageId: string): BrowserSnapshot | null {
    return this.snapshots.get(`${sessionId}:${pageId}`) ?? null;
  }

  clear(sessionId: string, pageId: string): void {
    this.snapshots.delete(`${sessionId}:${pageId}`);
  }
}

export async function takeSnapshot(
  page: Page,
  sessionId: string,
  pageId: string,
  options: { readonly limit?: number } = {},
): Promise<BrowserSnapshot> {
  const limit = Math.max(1, Math.min(MAX_ELEMENTS, options.limit ?? MAX_ELEMENTS));
  const raw = await page.evaluate(collectElements, limit);
  snapshotCounter += 1;
  const elements: BrowserElementRef[] = raw.map((element, index) => ({
    ref: `e${String(index + 1)}`,
    role: element.role,
    name: element.name.slice(0, MAX_NAME_LENGTH),
    tag: element.tag,
    selector: element.selector,
    value: element.value ?? undefined,
    disabled: element.disabled || undefined,
    checked: element.checked ?? undefined,
    depth: element.depth,
  }));
  return {
    sessionId,
    pageId,
    url: page.url(),
    title: await page.title().catch(() => ''),
    snapshotId: `s${String(snapshotCounter)}`,
    elements,
    truncated: raw.length >= limit,
  };
}

function namesAgree(expected: string, actual: string): boolean {
  const left = expected.trim().toLowerCase();
  const right = actual.trim().toLowerCase();
  if (!left || !right) return true;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Turns a ref into a live locator, refusing when the page has moved on.
 *
 * A ref that no longer resolves — or resolves to a different element than the
 * snapshot recorded — fails with an instruction to re-snapshot. Acting on a
 * position alone is how automation clicks the wrong thing.
 */
export async function resolveRef(
  page: Page,
  snapshot: BrowserSnapshot | null,
  ref: string,
): Promise<{ readonly locator: Locator; readonly element: BrowserElementRef }> {
  if (!snapshot) {
    throw new StaleElementError(
      `No snapshot has been taken for this page, so ref ${ref} means nothing yet.`,
      'Call action:"snapshot" first, then use a ref from that snapshot.',
    );
  }
  const element = snapshot.elements.find((candidate) => candidate.ref === ref);
  if (!element) {
    throw new StaleElementError(
      `Ref ${ref} is not in the current snapshot of ${snapshot.url}.`,
      'Call action:"snapshot" to get current refs for this page.',
    );
  }
  if (page.url() !== snapshot.url) {
    throw new StaleElementError(
      `The page moved from ${snapshot.url} to ${page.url()} after the snapshot, so ref ${ref} no longer describes anything on it.`,
      'Call action:"snapshot" for the current page, then act on a ref from that snapshot.',
    );
  }
  const locator = page.locator(element.selector).first();
  const count = await page.locator(element.selector).count();
  if (count === 0) {
    throw new StaleElementError(
      `Ref ${ref} (${element.role} "${element.name}") is no longer present on ${page.url()}.`,
      'Call action:"snapshot" to get current refs, then retry.',
    );
  }
  const actual = await locator.evaluate(describeElement);
  if (actual.tag !== element.tag || !namesAgree(element.name, actual.name)) {
    throw new StaleElementError(
      `Ref ${ref} now points at a different element (snapshot recorded ${element.tag} "${element.name}", the page currently has ${actual.tag} "${actual.name}").`,
      'Call action:"snapshot" to get current refs, then retry.',
    );
  }
  return { locator, element };
}
