import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:3421'),
  token: z.string().optional(),
  surfaceKind: z.string().default('goodvibes-agent'),
  surfaceId: z.string().default('goodvibes-agent'),
  defaultChatTitle: z.string().default('GoodVibes Agent'),
  autoRemember: z.boolean().default(true),
  autoDelegateBuildRequests: z.boolean().default(true),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

export function agentHomeDir(): string {
  return process.env.GOODVIBES_AGENT_HOME ?? join(homedir(), '.goodvibes', 'agent');
}

export function agentConfigPath(): string {
  return join(agentHomeDir(), 'config.json');
}

function readJsonFile(path: string): unknown {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch {
    return {};
  }
}

function readDaemonToken(): string | undefined {
  const envToken = process.env.GOODVIBES_AGENT_TOKEN
    ?? process.env.GOODVIBES_HTTP_TOKEN
    ?? process.env.GOODVIBES_DAEMON_TOKEN;
  if (envToken?.trim()) return envToken.trim();
  const tokenPath = join(homedir(), '.goodvibes', 'daemon', 'operator-tokens.json');
  try {
    if (!existsSync(tokenPath)) return undefined;
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as { token?: unknown };
    return typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function loadAgentConfig(): AgentConfig {
  const fileConfig = readJsonFile(agentConfigPath());
  return ConfigSchema.parse({
    ...(typeof fileConfig === 'object' && fileConfig !== null ? fileConfig : {}),
    ...(process.env.GOODVIBES_AGENT_BASE_URL || process.env.GOODVIBES_BASE_URL
      ? { baseUrl: process.env.GOODVIBES_AGENT_BASE_URL ?? process.env.GOODVIBES_BASE_URL }
      : {}),
    ...(readDaemonToken() ? { token: readDaemonToken() } : {}),
  });
}

export function saveAgentConfig(config: AgentConfig): void {
  const path = agentConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort permissions on platforms that support chmod.
  }
}
