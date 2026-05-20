import { parseArgs } from './cli/args.js';
import { runCommand } from './cli/commands.js';

try {
  const exitCode = await runCommand(parseArgs(process.argv.slice(2)));
  process.exit(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
