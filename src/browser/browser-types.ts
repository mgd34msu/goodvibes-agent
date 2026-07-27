/**
 * Shared types for first-class browser automation.
 *
 * The engine under src/browser/ is deliberately free of Agent-surface imports
 * (no CommandContext, no tool registry, no renderer). Every external effect it
 * needs — spawning a process, touching the filesystem, loading the Playwright
 * driver — arrives through an injected IO record, so the same engine can be
 * hoisted into the SDK for other surfaces without carrying Agent wiring or
 * being untestable offline.
 */

/** Where a usable browser binary came from. */
export type BrowserBinarySource =
  /** Already present in the managed Playwright browser cache. */
  | 'managed-cache'
  /** Downloaded into the managed cache by this provisioning act. */
  | 'managed-download'
  /** A browser already installed on the machine (Chrome/Chromium/Edge/Brave). */
  | 'system-browser';

/**
 * Every distinct way provisioning can fail on a clean machine. Each value maps
 * to a plain-language problem statement AND a named fix, because "browser not
 * available" with no next step is what made this capability unusable before.
 */
export type BrowserProvisionFailure =
  | 'driver-missing'
  /**
   * No driver is present and this call was told to install nothing, so none was
   * attempted. Distinct from 'driver-missing' on purpose: that value means
   * installing WAS tried and could not finish, and reporting it for a call that
   * never tried would tell the owner their machine cannot get a driver when in
   * fact nothing has asked for one yet. Only a reporting call (status, or any
   * provision with allowDownload:false) can produce this.
   */
  | 'driver-not-installed-yet'
  | 'download-failed'
  | 'download-blocked-offline'
  | 'binary-missing-after-install'
  | 'binary-not-executable'
  | 'missing-system-libraries'
  | 'cache-directory-unwritable'
  | 'unknown';

export interface BrowserProvisionStep {
  readonly step: string;
  readonly detail: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
}

export interface BrowserProvisionReport {
  readonly ok: boolean;
  readonly source: BrowserBinarySource | null;
  readonly executablePath: string | null;
  readonly browsersPath: string;
  readonly driverVersion: string | null;
  /** Honest progress: what provisioning actually did, in order, with timings. */
  readonly steps: readonly BrowserProvisionStep[];
  readonly failure: BrowserProvisionFailure | null;
  /** Plain-language statement of what is wrong. Null when ok. */
  readonly problem: string | null;
  /** Exactly what to do about it. Null when ok. */
  readonly fix: string | null;
}

export interface CommandOutcome {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | null;
}

/** Resolution of the Playwright driver package itself (not the browser binary). */
export interface BrowserDriverResolution {
  readonly available: boolean;
  readonly packageDirectory: string | null;
  readonly cliPath: string | null;
  readonly version: string | null;
  readonly error: string | null;
}

/** Injected IO for provisioning, so tests never download or spawn anything. */
export interface BrowserProvisionIo {
  readonly resolveDriver: () => BrowserDriverResolution;
  /** Installs the driver package into a directory the agent owns. */
  readonly installDriver?: (targetRoot: string) => Promise<CommandOutcome>;
  /** Where a self-installed driver goes. */
  readonly managedDriverRoot?: () => string;
  /**
   * What to tell the user when the driver is neither present nor installable,
   * phrased for how this build was installed. Injected so the provisioning
   * policy never has to know about release assets or package managers.
   */
  readonly driverFix?: () => string;
  readonly expectedExecutablePath: () => string | null;
  readonly browsersPath: () => string;
  readonly pathExists: (path: string) => boolean;
  readonly isExecutableFile: (path: string) => boolean;
  readonly directoryWritable: (path: string) => boolean;
  readonly removePath: (path: string) => void;
  readonly runCommand: (
    command: string,
    args: readonly string[],
    options: { readonly timeoutMs: number; readonly env?: Readonly<Record<string, string>> },
  ) => Promise<CommandOutcome>;
  readonly systemBrowserCandidates: () => readonly string[];
  readonly now: () => number;
}

/** How a browser session came to exist — the ownership fact the safety rules key on. */
export type BrowserSessionOrigin =
  /** This agent started the browser process. Only these may ever be closed by the agent. */
  | 'launched'
  /** The browser was already running. The agent connected to it and must never end it. */
  | 'attached';

export interface BrowserSessionInfo {
  readonly sessionId: string;
  readonly origin: BrowserSessionOrigin;
  readonly profileDirectory: string | null;
  readonly cdpEndpoint: string | null;
  readonly executablePath: string | null;
  readonly source: BrowserBinarySource | null;
  readonly headless: boolean;
  readonly startedAt: string;
  readonly pageCount: number;
  readonly activePageId: string | null;
  /**
   * False for attached sessions. Enforced by the session registry rather than
   * by convention: the agent physically has no code path that ends a browser
   * it did not start.
   */
  readonly closableByAgent: boolean;
}

export interface BrowserPageInfo {
  readonly pageId: string;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

/**
 * One addressable element from a snapshot. `ref` is only meaningful together
 * with the snapshot that produced it: acting on a ref re-verifies the element's
 * identity before touching it, so a stale ref fails loudly instead of clicking
 * whatever now occupies that position.
 */
export interface BrowserElementRef {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly tag: string;
  readonly selector: string;
  readonly value?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly checked?: boolean | undefined;
  readonly depth: number;
  /**
   * Activating this control submits a form, which sends data to whoever runs
   * the site. Recorded at snapshot time so the outward-effect boundary is a
   * fact about the element rather than a guess at click time.
   */
  readonly submits: boolean;
  /**
   * Selectors of the iframes this element sits inside, outermost first. Empty
   * for the main document. Embedded forms and consent screens live in frames
   * routinely, so an element inside one has to be addressable like any other.
   */
  readonly frameChain: readonly string[];
}

export interface BrowserSnapshot {
  readonly sessionId: string;
  readonly pageId: string;
  readonly url: string;
  readonly title: string;
  readonly snapshotId: string;
  readonly elements: readonly BrowserElementRef[];
  readonly truncated: boolean;
}
