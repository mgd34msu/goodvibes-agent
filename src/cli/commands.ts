import { delegateToTui } from '../assistant/delegation.js';
import { formatJson } from '../utils/format.js';
import { AgentTuiApp } from '../tui/app.js';
import { bootstrapAgentRuntime } from '../runtime/bootstrap.js';
import { getText, hasFlag, type ParsedArgs } from './args.js';
import { renderHelp } from './help.js';

export async function runCommand(args: ParsedArgs): Promise<number> {
  const { services } = bootstrapAgentRuntime();
  const { config, assistant: runtime } = services;
  const text = getText(args);

  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      console.log(renderHelp());
      return 0;
    case 'tui':
      await new AgentTuiApp(runtime).run();
      return 0;
    case 'status':
    case 'health': {
      const diagnostics = await runtime.client.diagnostics();
      console.log(formatJson(diagnostics));
      return diagnostics.ok ? 0 : 1;
    }
    case 'auth':
      console.log(formatJson(await runtime.client.currentAuth()));
      return 0;
    case 'smoke': {
      const diagnostics = await runtime.client.diagnostics();
      console.log(formatJson({
        ok: diagnostics.ok,
        bin: 'goodvibes-agent',
        surfaceKind: config.surfaceKind,
        surfaceId: config.surfaceId,
        daemon: diagnostics,
      }));
      return diagnostics.ok ? 0 : 1;
    }
    case 'chat':
      console.log((await runtime.handleUserText(text)).text);
      return 0;
    case 'ask':
      console.log((await runtime.askKnowledge(text)).text);
      return 0;
    case 'search':
      console.log((await runtime.searchKnowledge(text)).text);
      return 0;
    case 'remember':
      console.log(formatJson(runtime.memory.remember({ text, source: 'cli' })));
      return 0;
    case 'memory':
      console.log(formatJson(text ? runtime.memory.search(text) : runtime.memory.list()));
      return 0;
    case 'skills':
      console.log(formatJson(text ? runtime.skills.search(text) : runtime.skills.list()));
      return 0;
    case 'personas':
      console.log(formatJson(runtime.personas.list()));
      return 0;
    case 'delegate':
      console.log(formatJson(await delegateToTui(runtime.client, config, {
        task: text,
        wrfc: hasFlag(args, 'wrfc'),
        reason: 'cli-command',
      })));
      return 0;
    case 'approvals':
      console.log(formatJson(await runtime.client.invoke('approvals.list')));
      return 0;
    case 'workplan':
      console.log(formatJson(await runtime.client.invoke('projectPlanning.workPlan.snapshot')));
      return 0;
    default:
      console.error(`Unknown command: ${args.command}\n`);
      console.error(renderHelp());
      return 2;
  }
}
