import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { BrowserSessionError, BrowserSessionManager, hasDisplay } from './browser-sessions.ts';
import type { BrowserAttachOptions, BrowserLaunchOptions } from './browser-sessions.ts';
import { resolveRef, SnapshotStore, StaleElementError, takeSnapshot } from './browser-snapshot.ts';
import type { BrowserProvisionReport, BrowserSnapshot } from './browser-types.ts';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
const DEFAULT_TEXT_LIMIT = 20_000;

/**
 * Schemes a page may be sent to.
 *
 * `javascript:` is refused outright. A javascript: URL is not navigation, it is
 * script injection into whatever is currently loaded, and it is exactly how a
 * bookmarklet ended up executing somewhere it was never meant to. Script that
 * needs to run in a page goes through action:"evaluate", which is scoped to a
 * page this engine controls and is reported as such.
 */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:']);

export interface BrowserTarget {
  readonly sessionId?: string | undefined;
  readonly pageId?: string | undefined;
}

export interface BrowserEngineOptions {
  /** Where screenshots are written. Must be a directory the agent's read path can open. */
  readonly screenshotDirectory: string;
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new BrowserSessionError('No url was given to navigate to.', 'Pass url:"https://example.com".');
  }
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BrowserSessionError(`"${rawUrl}" is not a usable URL.`, 'Pass a full URL such as https://example.com.');
  }
  if (parsed.protocol === 'javascript:') {
    throw new BrowserSessionError(
      'Navigating to a javascript: URL is not supported, because it runs script against whatever page is currently open instead of loading a page.',
      'Use action:"evaluate" to run script in a page this tool controls.',
    );
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new BrowserSessionError(
      `The ${parsed.protocol} scheme is not supported by the browser tool.`,
      'Use an http, https, file, or about URL.',
    );
  }
  return parsed.toString();
}

/**
 * The browser capability itself: provisioning, sessions, and every page
 * operation, with no Agent-surface types in sight.
 */
export class BrowserEngine {
  private readonly snapshots = new SnapshotStore();

  constructor(
    private readonly sessions: BrowserSessionManager,
    private readonly options: BrowserEngineOptions,
  ) {}

  sessionManager(): BrowserSessionManager {
    return this.sessions;
  }

  async provision(options: { readonly repair?: boolean; readonly allowDownload?: boolean } = {}): Promise<BrowserProvisionReport> {
    return this.sessions.provision(options);
  }

  async status(): Promise<Record<string, unknown>> {
    const report = this.sessions.provisionReport() ?? await this.sessions.provision({ allowDownload: false });
    return {
      browserAvailable: report.ok,
      binarySource: report.source,
      executablePath: report.executablePath,
      driverVersion: report.driverVersion,
      browsersPath: report.browsersPath,
      displayAvailable: hasDisplay(),
      defaultMode: hasDisplay() ? 'visible window' : 'headless (no display on this machine)',
      sessions: this.sessions.list(),
      ...(report.ok ? {} : { problem: report.problem, fix: report.fix }),
      provisionSteps: report.steps,
    };
  }

  async launch(options: BrowserLaunchOptions): Promise<Record<string, unknown>> {
    const session = await this.sessions.launch(options);
    return {
      session,
      note: session.headless
        ? 'Started headless. Pass headless:false to open a visible window for a sign-in.'
        : 'Started a visible window. Sign in once here and the profile keeps the login for later runs.',
    };
  }

  async attach(options: BrowserAttachOptions): Promise<Record<string, unknown>> {
    const session = await this.sessions.attach(options);
    const pages = await this.sessions.pageList(session.sessionId);
    return {
      session,
      pages,
      note: 'Attached to a browser this agent did not start. It will keep running; the agent cannot close it.',
    };
  }

  release(sessionId: string): Record<string, unknown> {
    const session = this.sessions.release(sessionId);
    return { released: session, note: 'Disconnected. The browser is still running.' };
  }

  async close(sessionId: string): Promise<Record<string, unknown>> {
    const session = await this.sessions.closeSession(sessionId);
    return { closed: session };
  }

  private resolveSessionId(target: BrowserTarget): string {
    const sessionId = target.sessionId ?? this.sessions.defaultSessionId();
    if (!sessionId) {
      throw new BrowserSessionError(
        'No browser session is open.',
        'Call action:"launch" to start one, or action:"attach" to connect to a browser you already have running.',
      );
    }
    return sessionId;
  }

  private async target(target: BrowserTarget): Promise<{ readonly sessionId: string; readonly pageId: string; readonly page: Page }> {
    const sessionId = this.resolveSessionId(target);
    const { pageId, page } = await this.sessions.page(sessionId, target.pageId);
    return { sessionId, pageId, page };
  }

  /**
   * Opens a browser only if nothing is open yet, so the first call a model
   * makes is a useful one instead of an error telling it to call launch first.
   */
  private async ensureSession(target: BrowserTarget, launchOptions: BrowserLaunchOptions = {}): Promise<string> {
    if (target.sessionId) return target.sessionId;
    const existing = this.sessions.defaultSessionId();
    if (existing) return existing;
    // An implicitly opened session honors the same launch arguments an
    // explicit launch would, so headless:true on the first call is respected
    // instead of silently opening a window on someone's screen.
    const session = await this.sessions.launch(launchOptions);
    return session.sessionId;
  }

  async navigate(
    target: BrowserTarget,
    args: {
      readonly url: string;
      readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      readonly timeoutMs?: number;
      readonly launch?: BrowserLaunchOptions;
    },
  ): Promise<Record<string, unknown>> {
    const url = normalizeUrl(args.url);
    const sessionId = await this.ensureSession(target, args.launch ?? {});
    const { pageId, page } = await this.sessions.page(sessionId, target.pageId);
    const response = await page.goto(url, {
      waitUntil: args.waitUntil ?? 'domcontentloaded',
      timeout: args.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
    });
    this.snapshots.clear(sessionId, pageId);
    return {
      sessionId,
      pageId,
      url: page.url(),
      title: await page.title().catch(() => ''),
      httpStatus: response?.status() ?? null,
      next: 'Call action:"snapshot" to get element refs for this page.',
    };
  }

  async snapshot(target: BrowserTarget, args: { readonly limit?: number } = {}): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const snapshot = await takeSnapshot(page, sessionId, pageId, args);
    this.snapshots.set(snapshot);
    return {
      sessionId,
      pageId,
      url: snapshot.url,
      title: snapshot.title,
      snapshotId: snapshot.snapshotId,
      elementCount: snapshot.elements.length,
      truncated: snapshot.truncated,
      elements: snapshot.elements.map((element) => ({
        ref: element.ref,
        role: element.role,
        name: element.name,
        ...(element.value === undefined ? {} : { value: element.value }),
        ...(element.disabled === undefined ? {} : { disabled: element.disabled }),
        ...(element.checked === undefined ? {} : { checked: element.checked }),
      })),
    };
  }

  private currentSnapshot(sessionId: string, pageId: string): BrowserSnapshot | null {
    return this.snapshots.get(sessionId, pageId);
  }

  async click(
    target: BrowserTarget,
    args: { readonly ref: string; readonly button?: 'left' | 'right' | 'middle'; readonly clickCount?: number; readonly timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const { locator, element } = await resolveRef(page, this.currentSnapshot(sessionId, pageId), args.ref);
    const urlBefore = page.url();
    await locator.click({
      button: args.button ?? 'left',
      clickCount: args.clickCount ?? 1,
      timeout: args.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
    });
    await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_ACTION_TIMEOUT_MS }).catch(() => undefined);
    this.snapshots.clear(sessionId, pageId);
    return {
      sessionId,
      pageId,
      clicked: { ref: args.ref, role: element.role, name: element.name },
      urlBefore,
      url: page.url(),
      navigated: page.url() !== urlBefore,
      next: 'Refs are cleared after a click. Call action:"snapshot" for current refs.',
    };
  }

  /**
   * Types into a resolved element. There is no variant that types into "the
   * focused window": the text goes to this element in this page or the call
   * fails.
   */
  async type(
    target: BrowserTarget,
    args: {
      readonly ref: string;
      readonly text: string;
      readonly submit?: boolean;
      readonly replace?: boolean;
      readonly timeoutMs?: number;
    },
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const { locator, element } = await resolveRef(page, this.currentSnapshot(sessionId, pageId), args.ref);
    const timeout = args.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    if (args.replace === false) {
      await locator.click({ timeout });
      await locator.pressSequentially(args.text, { timeout });
    } else {
      await locator.fill(args.text, { timeout });
    }
    let submitted = false;
    if (args.submit === true) {
      await locator.press('Enter', { timeout });
      await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
      submitted = true;
    }
    if (submitted) this.snapshots.clear(sessionId, pageId);
    return {
      sessionId,
      pageId,
      typedInto: { ref: args.ref, role: element.role, name: element.name },
      submitted,
      url: page.url(),
    };
  }

  async select(
    target: BrowserTarget,
    args: { readonly ref: string; readonly values: readonly string[]; readonly timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const { locator, element } = await resolveRef(page, this.currentSnapshot(sessionId, pageId), args.ref);
    const selected = await locator.selectOption([...args.values], { timeout: args.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS });
    return { sessionId, pageId, selectedIn: { ref: args.ref, role: element.role, name: element.name }, selected };
  }

  async press(
    target: BrowserTarget,
    args: { readonly ref: string; readonly key: string; readonly timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const { locator, element } = await resolveRef(page, this.currentSnapshot(sessionId, pageId), args.ref);
    await locator.press(args.key, { timeout: args.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS });
    this.snapshots.clear(sessionId, pageId);
    return { sessionId, pageId, pressed: args.key, on: { ref: args.ref, role: element.role, name: element.name }, url: page.url() };
  }

  async scroll(
    target: BrowserTarget,
    args: { readonly ref?: string; readonly direction?: 'up' | 'down'; readonly amount?: number },
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    if (args.ref) {
      const { locator, element } = await resolveRef(page, this.currentSnapshot(sessionId, pageId), args.ref);
      await locator.scrollIntoViewIfNeeded({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
      return { sessionId, pageId, scrolledTo: { ref: args.ref, role: element.role, name: element.name } };
    }
    const amount = args.amount ?? 600;
    const delta = args.direction === 'up' ? -amount : amount;
    await page.mouse.wheel(0, delta);
    const position = await page.evaluate(() => ({ scrollY: window.scrollY, scrollHeight: document.body.scrollHeight }));
    return { sessionId, pageId, scrolledBy: delta, ...position };
  }

  async waitFor(
    target: BrowserTarget,
    args: { readonly text?: string; readonly url?: string; readonly timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const timeout = args.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    if (args.text) {
      await page.getByText(args.text, { exact: false }).first().waitFor({ state: 'visible', timeout });
      this.snapshots.clear(sessionId, pageId);
      return { sessionId, pageId, waitedFor: { text: args.text }, url: page.url(), found: true };
    }
    if (args.url) {
      await page.waitForURL(args.url, { timeout });
      this.snapshots.clear(sessionId, pageId);
      return { sessionId, pageId, waitedFor: { url: args.url }, url: page.url(), found: true };
    }
    await page.waitForLoadState('networkidle', { timeout });
    return { sessionId, pageId, waitedFor: { state: 'networkidle' }, url: page.url(), found: true };
  }

  async readText(target: BrowserTarget, args: { readonly maxChars?: number } = {}): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const limit = Math.max(200, Math.min(200_000, args.maxChars ?? DEFAULT_TEXT_LIMIT));
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
    return {
      sessionId,
      pageId,
      url: page.url(),
      title: await page.title().catch(() => ''),
      truncated: normalized.length > limit,
      text: normalized.slice(0, limit),
    };
  }

  async screenshot(
    target: BrowserTarget,
    args: { readonly fullPage?: boolean; readonly path?: string } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    mkdirSync(this.options.screenshotDirectory, { recursive: true });
    const fileName = `${sessionId}-${pageId}-${String(Date.now())}.png`;
    const path = args.path ?? join(this.options.screenshotDirectory, fileName);
    const buffer = await page.screenshot({ path, fullPage: args.fullPage === true });
    return {
      sessionId,
      pageId,
      url: page.url(),
      path,
      bytes: buffer.byteLength,
      next: `Open it with read path:"${path}".`,
    };
  }

  async tabs(target: BrowserTarget): Promise<Record<string, unknown>> {
    const sessionId = this.resolveSessionId(target);
    return { sessionId, pages: await this.sessions.pageList(sessionId) };
  }

  async newTab(
    target: BrowserTarget,
    args: { readonly url?: string; readonly launch?: BrowserLaunchOptions } = {},
  ): Promise<Record<string, unknown>> {
    const sessionId = await this.ensureSession(target, args.launch ?? {});
    const { pageId, page } = await this.sessions.newPage(sessionId);
    if (args.url) {
      await page.goto(normalizeUrl(args.url), { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
    }
    return { sessionId, pageId, url: page.url(), pages: await this.sessions.pageList(sessionId) };
  }

  switchTab(target: BrowserTarget, args: { readonly pageId: string }): Record<string, unknown> {
    const sessionId = this.resolveSessionId(target);
    this.sessions.setActivePage(sessionId, args.pageId);
    return { sessionId, activePageId: args.pageId };
  }

  async closeTab(target: BrowserTarget, args: { readonly pageId: string }): Promise<Record<string, unknown>> {
    const sessionId = this.resolveSessionId(target);
    const { page } = await this.sessions.page(sessionId, args.pageId);
    await page.close();
    this.snapshots.clear(sessionId, args.pageId);
    return { sessionId, closedPageId: args.pageId, pages: await this.sessions.pageList(sessionId) };
  }

  async goBack(target: BrowserTarget): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const response = await page.goBack({ timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
    this.snapshots.clear(sessionId, pageId);
    return { sessionId, pageId, url: page.url(), moved: response !== null };
  }

  async goForward(target: BrowserTarget): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const response = await page.goForward({ timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
    this.snapshots.clear(sessionId, pageId);
    return { sessionId, pageId, url: page.url(), moved: response !== null };
  }

  async evaluate(target: BrowserTarget, args: { readonly expression: string }): Promise<Record<string, unknown>> {
    const { sessionId, pageId, page } = await this.target(target);
    const value: unknown = await page.evaluate<unknown, string>((source) => {
      const runner = new Function(`return (${source});`) as () => unknown;
      return runner();
    }, args.expression);
    return { sessionId, pageId, url: page.url(), value: value === undefined ? null : value };
  }

  async shutdown(): Promise<void> {
    await this.sessions.shutdown();
  }
}

export { BrowserSessionError, StaleElementError };
