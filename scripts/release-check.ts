import { existsSync } from 'node:fs';
import { formatJson } from '../src/utils/format.js';
import { isRecord } from '../src/types.js';

type CheckMode = 'source' | 'release';

interface CheckStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const mode = parseMode(process.argv.slice(2));
const steps: CheckStep[] = [];

await checkFile('changelog present', 'CHANGELOG.md');
await runStep('typecheck', ['bun', 'run', 'typecheck']);
await runStep('test', ['bun', 'test']);
await runStep('build', ['bun', 'run', 'build']);
await runStep('git diff check', ['git', 'diff', '--check']);
await runStep('npm pack dry-run', ['npm', 'pack', '--dry-run']);

if (mode === 'release') {
  await runStep('smoke cli', ['bun', 'run', 'smoke:cli']);
  await runStep('smoke release', ['bun', 'run', 'smoke:release']);
}

const ok = steps.every((step) => step.ok);
console.log(formatJson({ ok, mode, steps }));
process.exit(ok ? 0 : 1);

async function runStep(name: string, cmd: readonly string[]): Promise<void> {
  const result = await runCommand(cmd);
  recordStep(name, result.exitCode === 0, result.exitCode === 0 ? successDetail(result.stdout) : compactFailure(result));
}

async function checkFile(name: string, path: string): Promise<void> {
  recordStep(name, existsSync(path), existsSync(path) ? path : `${path} is missing`);
}

async function runCommand(cmd: readonly string[]): Promise<CommandResult> {
  const proc = Bun.spawn({
    cmd: [...cmd],
    cwd: process.cwd(),
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function parseMode(argv: readonly string[]): CheckMode {
  return argv.includes('--release') ? 'release' : 'source';
}

function compactFailure(result: CommandResult): string {
  const out = firstLine(result.stdout);
  const err = firstLine(result.stderr);
  return `exit ${result.exitCode}; stdout ${out || '<empty>'}; stderr ${err || '<empty>'}`;
}

function successDetail(stdout: string): string {
  const parsed = parseJsonObject(stdout);
  if (parsed) {
    const ok = parsed.ok;
    const mode = parsed.mode;
    if (typeof ok === 'boolean' && typeof mode === 'string') return `ok ${ok}; mode ${mode}`;
    if (typeof ok === 'boolean') return `ok ${ok}`;
  }
  return firstLine(stdout) || 'ok';
}

function parseJsonObject(stdout: string): Readonly<Record<string, unknown>> | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, 160) ?? '';
}

function recordStep(name: string, ok: boolean, detail: string): void {
  steps.push({ name, ok, detail });
}
