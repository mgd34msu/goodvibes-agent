import { parseArgs } from './cli/args.js';
import { runCommand } from './cli/commands.js';
import { printCaughtFailure } from './cli/output.js';

try {
  const exitCode = await runCommand(parseArgs(process.argv.slice(2)));
  process.exit(exitCode);
} catch (error) {
  process.exit(printCaughtFailure(error));
}
