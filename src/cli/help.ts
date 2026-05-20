export function renderHelp(): string {
  return [
    'goodvibes-agent',
    '',
    'Usage:',
    '  goodvibes-agent tui',
    '  goodvibes-agent status',
    '  goodvibes-agent chat <message>',
    '  goodvibes-agent ask <knowledge query>',
    '  goodvibes-agent search <knowledge query>',
    '  goodvibes-agent remember <fact>',
    '  goodvibes-agent delegate [--wrfc] <build/fix/review task>',
    '  goodvibes-agent memory [query]',
    '  goodvibes-agent skills [query]',
    '  goodvibes-agent personas',
    '',
    'The default command is tui.',
  ].join('\n');
}
