import { access, lstat, mkdtemp, readlink, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { formatJson } from '../src/utils/format.js';
import { isRecord } from '../src/types.js';

type SmokeMode = 'cli' | 'release';

interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface SmokeStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface JsonCommandSuccess {
  readonly parsed: Record<string, unknown>;
}

const mode = parseMode(process.argv.slice(2));
const repoRoot = process.cwd();
const steps: SmokeStep[] = [];

try {
  await runSourceSmoke();
  if (mode === 'release') await runReleaseSmoke();
} catch (error) {
  recordStep('smoke.unhandled', false, error instanceof Error ? error.message : String(error));
}

const ok = steps.every((step) => step.ok);
console.log(formatJson({ ok, mode, steps }));
process.exit(ok ? 0 : 1);

async function runSourceSmoke(): Promise<void> {
  const agentHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-smoke-cli-'));
  try {
    const source = (args: readonly string[]): readonly string[] => [process.execPath, 'run', 'src/main.ts', ...args];
    const env = { ...process.env, GOODVIBES_AGENT_HOME: agentHome };
    await expectHelp(source(['--help']), repoRoot, env, 'source help');
    await expectJsonCommand({
      name: 'source config',
      cmd: source(['config']),
      cwd: repoRoot,
      env,
      expectedKind: 'config',
    });
    await expectJsonCommand({
      name: 'source status',
      cmd: source(['status']),
      cwd: repoRoot,
      env,
      expectedKind: 'ok',
    });
    await expectJsonCommand({
      name: 'source smoke',
      cmd: source(['smoke']),
      cwd: repoRoot,
      env,
      expectedKind: null,
    });
    await expectJsonCommand({
      name: 'source auth',
      cmd: source(['auth']),
      cwd: repoRoot,
      env,
      expectedKind: 'auth.current',
    });
    await expectJsonCommand({
      name: 'source policy safe',
      cmd: source(['policy', 'summarize', 'my', 'work', 'plan']),
      cwd: repoRoot,
      env,
      expectedKind: 'policy.evaluated',
    });
    await expectTextCommand({
      name: 'source ask',
      cmd: source(['ask', 'GoodVibes Agent']),
      cwd: repoRoot,
      env,
      expectIncludes: [],
    });
    await expectTextCommand({
      name: 'source search',
      cmd: source(['search', 'GoodVibes Agent']),
      cwd: repoRoot,
      env,
      expectIncludes: [],
    });
    await expectTextCommand({
      name: 'source workplan',
      cmd: source(['workplan']),
      cwd: repoRoot,
      env,
      expectIncludes: ['Work plan'],
    });
    await expectTextCommand({
      name: 'source approvals',
      cmd: source(['approvals']),
      cwd: repoRoot,
      env,
      expectIncludes: ['Approvals'],
    });
    await expectTextCommand({
      name: 'source automation',
      cmd: source(['automation']),
      cwd: repoRoot,
      env,
      expectIncludes: ['Automation'],
    });
    await expectJsonCommand({
      name: 'source automation jobs json',
      cmd: source(['automation', 'jobs', '--json']),
      cwd: repoRoot,
      env,
      expectedKind: 'automation.jobs.list',
    });
    await expectJsonCommand({
      name: 'source automation runs json',
      cmd: source(['automation', 'runs', '--json']),
      cwd: repoRoot,
      env,
      expectedKind: 'automation.runs.list',
    });
    await expectJsonCommand({
      name: 'source automation heartbeat json',
      cmd: source(['automation', 'heartbeat', '--json']),
      cwd: repoRoot,
      env,
      expectedKind: 'automation.heartbeat.list',
    });
    await expectJsonCommand({
      name: 'source automation capacity json',
      cmd: source(['automation', 'capacity', '--json']),
      cwd: repoRoot,
      env,
      expectedKind: 'scheduler.capacity',
    });
    await expectTextCommand({
      name: 'source schedules',
      cmd: source(['schedules']),
      cwd: repoRoot,
      env,
      expectIncludes: ['Schedules'],
    });
    await expectTextCommand({
      name: 'source delegations',
      cmd: source(['delegations']),
      cwd: repoRoot,
      env,
      expectIncludes: ['Delegations'],
    });
    await expectJsonCommand({
      name: 'source delegations json',
      cmd: source(['delegations', '--json']),
      cwd: repoRoot,
      env,
      expectedKind: 'delegations.status',
    });
    await runLocalCrud(source, env, 'source');
    await expectFailureJsonCommand({
      name: 'invalid base URL envelope',
      cmd: source(['config']),
      cwd: repoRoot,
      env: { ...env, GOODVIBES_AGENT_BASE_URL: 'not-a-url' },
      expectedKind: 'config_error',
    });
    await expectFailureJsonCommand({
      name: 'invalid token auth envelope',
      cmd: source(['chat', 'hello']),
      cwd: repoRoot,
      env: { ...env, GOODVIBES_AGENT_TOKEN: invalidToken() },
      expectedKind: 'auth_required',
      forbiddenText: invalidToken(),
    });
  } finally {
    await rm(agentHome, { recursive: true, force: true });
  }
}

async function runReleaseSmoke(): Promise<void> {
  const packDir = await mkdtemp(join(tmpdir(), 'goodvibes-agent-pack-'));
  const prefix = await mkdtemp(join(tmpdir(), 'goodvibes-agent-prefix-'));
  let tarballPath: string | null = null;
  try {
    const pack = await runCommand(['npm', 'pack', '--pack-destination', packDir], repoRoot, process.env);
    if (pack.exitCode !== 0) {
      recordStep('release npm pack', false, compactFailure(pack));
      return;
    }
    const tarballName = pack.stdout.trim().split(/\s+/).find((value) => value.endsWith('.tgz'));
    if (!tarballName) {
      recordStep('release npm pack', false, 'npm pack did not report a tarball name.');
      return;
    }
    tarballPath = resolve(packDir, tarballName);
    recordStep('release npm pack', true, tarballPath);

    const install = await runCommand(['npm', 'install', '-g', '--prefix', prefix, tarballPath], repoRoot, process.env);
    if (install.exitCode !== 0) {
      recordStep('release npm install prefix', false, compactFailure(install));
      return;
    }
    recordStep('release npm install prefix', true, prefix);

    const binPath = join(prefix, 'bin', 'goodvibes-agent');
    const binStat = await stat(binPath);
    await access(binPath, constants.X_OK);
    recordStep('release bin executable', true, `${binPath} mode ${modeBits(binStat.mode)}`);

    const binLink = await lstat(binPath);
    if (binLink.isSymbolicLink()) {
      const target = await readlink(binPath);
      const targetOk = target.endsWith('bin/goodvibes-agent.ts') || target.endsWith('bin\\goodvibes-agent.ts');
      recordStep('release bin target', targetOk, target);
    } else {
      recordStep('release bin target', false, 'global bin is not a symlink to package bin/goodvibes-agent.ts');
    }

    const binHead = await Bun.file(binPath).text();
    const shebangOk = binHead.startsWith('#!/usr/bin/env bun');
    recordStep('release bin shebang', shebangOk, shebangOk ? 'Bun shebang present' : firstLine(binHead));

    const installedHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-installed-home-'));
    try {
      const env = {
        ...process.env,
        PATH: `${join(prefix, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
        GOODVIBES_AGENT_HOME: installedHome,
      };
      await expectHelp(['goodvibes-agent', '--help'], repoRoot, env, 'installed help');
      await expectJsonCommand({
        name: 'installed status',
        cmd: ['goodvibes-agent', 'status'],
        cwd: repoRoot,
        env,
        expectedKind: 'ok',
      });
      await expectJsonCommand({
        name: 'installed smoke',
        cmd: ['goodvibes-agent', 'smoke'],
        cwd: repoRoot,
        env,
        expectedKind: null,
      });
    } finally {
      await rm(installedHome, { recursive: true, force: true });
    }
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(prefix, { recursive: true, force: true });
    if (tarballPath) await rm(tarballPath, { force: true });
  }
}

async function runLocalCrud(
  command: (args: readonly string[]) => readonly string[],
  env: NodeJS.ProcessEnv,
  prefix: string,
): Promise<void> {
  const memory = await expectJsonCommand({
    name: `${prefix} memory create`,
    cmd: command(['memory', 'add', 'Smoke memory record', '--class', 'fact', '--sensitivity', 'project']),
    cwd: repoRoot,
    env,
    expectedKind: 'memory.created',
  });
  const memoryId = getNestedString(memory.parsed, ['data', 'id']);
  await expectJsonCommand({ name: `${prefix} memory list`, cmd: command(['memory', 'list']), cwd: repoRoot, env, expectedKind: 'memory.list' });
  await expectJsonCommand({
    name: `${prefix} memory update`,
    cmd: command(['memory', 'update', memoryId, '--summary', 'Updated smoke memory']),
    cwd: repoRoot,
    env,
    expectedKind: 'memory.updated',
  });
  await expectJsonCommand({
    name: `${prefix} memory delete`,
    cmd: command(['memory', 'delete', memoryId, '--yes']),
    cwd: repoRoot,
    env,
    expectedKind: 'memory.deleted',
  });

  await expectJsonCommand({
    name: `${prefix} skill create`,
    cmd: command(['skills', 'create', 'smoke-skill', '--description', 'Smoke skill']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.created',
  });
  await expectJsonCommand({ name: `${prefix} skill list`, cmd: command(['skills', 'list']), cwd: repoRoot, env, expectedKind: 'skills.list' });
  await expectJsonCommand({
    name: `${prefix} skill update`,
    cmd: command(['skills', 'update', 'smoke-skill', '--description', 'Updated smoke skill']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.updated',
  });
  await expectJsonCommand({
    name: `${prefix} skill enable`,
    cmd: command(['skills', 'enable', 'smoke-skill']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.enabled',
  });
  await expectJsonCommand({
    name: `${prefix} skill active`,
    cmd: command(['skills', 'active']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.active',
  });
  await expectJsonCommand({
    name: `${prefix} skill stale`,
    cmd: command(['skills', 'stale', 'smoke-skill']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.stale',
  });
  await expectJsonCommand({
    name: `${prefix} skill disable`,
    cmd: command(['skills', 'disable', 'smoke-skill']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.disabled',
  });
  await expectJsonCommand({
    name: `${prefix} skill delete`,
    cmd: command(['skills', 'delete', 'smoke-skill', '--yes']),
    cwd: repoRoot,
    env,
    expectedKind: 'skills.deleted',
  });

  await expectJsonCommand({
    name: `${prefix} persona create`,
    cmd: command(['personas', 'create', 'smoke-persona', '--description', 'Smoke persona']),
    cwd: repoRoot,
    env,
    expectedKind: 'personas.created',
  });
  await expectJsonCommand({ name: `${prefix} persona list`, cmd: command(['personas', 'list']), cwd: repoRoot, env, expectedKind: 'personas.list' });
  await expectJsonCommand({
    name: `${prefix} persona update`,
    cmd: command(['personas', 'update', 'smoke-persona', '--description', 'Updated smoke persona']),
    cwd: repoRoot,
    env,
    expectedKind: 'personas.updated',
  });
  await expectJsonCommand({
    name: `${prefix} persona use`,
    cmd: command(['personas', 'use', 'smoke-persona']),
    cwd: repoRoot,
    env,
    expectedKind: 'personas.active',
  });
  await expectJsonCommand({
    name: `${prefix} persona active`,
    cmd: command(['personas', 'active']),
    cwd: repoRoot,
    env,
    expectedKind: 'personas.active',
  });
  await expectJsonCommand({
    name: `${prefix} persona stale`,
    cmd: command(['personas', 'stale', 'smoke-persona']),
    cwd: repoRoot,
    env,
    expectedKind: 'personas.stale',
  });
  await expectJsonCommand({
    name: `${prefix} persona delete`,
    cmd: command(['personas', 'delete', 'smoke-persona', '--yes']),
    cwd: repoRoot,
    env,
    expectedKind: 'personas.deleted',
  });
}

async function expectHelp(
  cmd: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  name: string,
): Promise<void> {
  const result = await runCommand(cmd, cwd, env);
  recordStep(name, result.exitCode === 0 && result.stdout.includes('goodvibes-agent'), result.exitCode === 0 ? 'help rendered' : compactFailure(result));
}

async function expectTextCommand(input: {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectIncludes: readonly string[];
}): Promise<void> {
  const result = await runCommand(input.cmd, input.cwd, input.env);
  const includesOk = input.expectIncludes.every((text) => result.stdout.includes(text));
  const noLeak = !containsTokenLeak(result);
  recordStep(
    input.name,
    result.exitCode === 0 && result.stdout.trim().length > 0 && includesOk && noLeak,
    result.exitCode === 0 ? firstLine(result.stdout) : compactFailure(result),
  );
}

async function expectJsonCommand(input: {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedKind: string | null;
}): Promise<JsonCommandSuccess> {
  const result = await runCommand(input.cmd, input.cwd, input.env);
  const parsed = parseJsonObject(result.stdout);
  const kindOk = input.expectedKind === null || parsed?.kind === input.expectedKind;
  const ok = result.exitCode === 0 && parsed?.ok === true && kindOk && !containsTokenLeak(result);
  recordStep(input.name, ok, ok ? input.expectedKind ? `kind ${input.expectedKind}` : 'ok true' : compactFailure(result));
  if (!ok || !parsed) throw new Error(`${input.name} failed`);
  return { parsed };
}

async function expectFailureJsonCommand(input: {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedKind: string;
  readonly forbiddenText?: string | undefined;
}): Promise<void> {
  const result = await runCommand(input.cmd, input.cwd, input.env);
  const parsed = parseJsonObject(result.stdout);
  const forbidden = input.forbiddenText ?? '';
  const leak = forbidden.length > 0 && `${result.stdout}\n${result.stderr}`.includes(forbidden);
  const ok = result.exitCode !== 0 && parsed?.ok === false && parsed.kind === input.expectedKind && !leak;
  recordStep(input.name, ok, ok ? `kind ${input.expectedKind}` : compactFailure(result));
}

async function runCommand(
  cmd: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const proc = Bun.spawn({
    cmd: [...cmd],
    cwd,
    env,
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function getNestedString(record: Record<string, unknown>, path: readonly string[]): string {
  let current: unknown = record;
  for (const part of path) {
    if (!isRecord(current)) throw new Error(`Expected object at ${path.join('.')}`);
    current = current[part];
  }
  if (typeof current !== 'string' || !current.trim()) throw new Error(`Expected string at ${path.join('.')}`);
  return current;
}

function compactFailure(result: CommandResult): string {
  const out = firstLine(result.stdout);
  const err = firstLine(result.stderr);
  return `exit ${result.exitCode}; stdout ${out || '<empty>'}; stderr ${err || '<empty>'}`;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, 160) ?? '';
}

function recordStep(name: string, ok: boolean, detail: string): void {
  steps.push({ name, ok, detail: redact(detail) });
}

function modeBits(modeValue: number): string {
  return `0${(modeValue & 0o777).toString(8)}`;
}

function parseMode(argv: readonly string[]): SmokeMode {
  return argv.includes('--release') ? 'release' : 'cli';
}

function invalidToken(): string {
  return 'goodvibes-agent-smoke-invalid-token';
}

function containsTokenLeak(result: CommandResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`;
  return text.includes(invalidToken());
}

function redact(text: string): string {
  return text.replaceAll(invalidToken(), '[redacted]');
}
