/**
 * What to tell someone whose browser driver is not there, matched to how they
 * actually installed the agent.
 *
 * This exists because every driver-missing message in 1.18.1 said `bun add -g
 * @pellux/goodvibes-agent`. That command does work — the npm package carries
 * playwright-core — but telling someone who downloaded a release binary to
 * install the npm package silently changes their install method, and it is not
 * the fix for their situation. The fix has to name the thing they did.
 *
 * The install kind comes from the same detector `/update` uses
 * (runtime/update-check.ts), so a message here can never disagree with what
 * `/update apply` would do on the same machine.
 */
import { detectInstallKind } from '../runtime/update-check.ts';
import { BROWSER_DRIVER_ARCHIVE_NAME, BROWSER_DRIVER_DIR_NAME } from '../runtime/release-artifacts.ts';

export const RELEASES_LATEST_URL = 'https://github.com/mgd34msu/goodvibes-agent/releases/latest';

export interface DriverRemediationOptions {
  /** Path of the running executable. Defaults to this process's. */
  readonly execPath?: string;
  /** Directory the driver would be extracted into. Defaults to the executable's. */
  readonly executableDirectory?: string;
}

function executableDirectoryOf(execPath: string): string {
  const separator = execPath.includes('\\') && !execPath.includes('/') ? '\\' : '/';
  const cut = execPath.lastIndexOf(separator);
  return cut <= 0 ? '.' : execPath.slice(0, cut);
}

/**
 * The one sentence to print when the driver could not be found AND could not be
 * provisioned. Provisioning is tried first everywhere this is used, so reaching
 * this text means the automatic path is genuinely unavailable (no network, no
 * package manager, nowhere writable) and the person has to do something.
 */
export function driverRemediation(options: DriverRemediationOptions = {}): string {
  const execPath = options.execPath ?? process.execPath;
  const directory = options.executableDirectory ?? executableDirectoryOf(execPath);
  switch (detectInstallKind(execPath)) {
    case 'binary':
      return [
        `The driver ships with the release. Re-run the installer (curl -fsSL https://goodvibes.sh/install.sh | sh),`,
        `or download ${BROWSER_DRIVER_ARCHIVE_NAME} from ${RELEASES_LATEST_URL} and extract it beside the binary`,
        `so that ${directory}/${BROWSER_DRIVER_DIR_NAME}/cli.js exists.`,
        'Installing bun or npm also works: the agent then installs the driver for itself on the next browser call.',
      ].join(' ');
    case 'bun-global-package':
      return 'Reinstall the package so its dependencies are present: bun add -g @pellux/goodvibes-agent';
    case 'source':
      return 'Install this checkout\'s dependencies: bun install';
  }
}

/**
 * Where the driver would go if the person followed the advice above, for
 * messages that want to name the exact path rather than the whole recipe.
 */
export function shippedDriverPath(options: DriverRemediationOptions = {}): string {
  const execPath = options.execPath ?? process.execPath;
  const directory = options.executableDirectory ?? executableDirectoryOf(execPath);
  return `${directory}/${BROWSER_DRIVER_DIR_NAME}`;
}
