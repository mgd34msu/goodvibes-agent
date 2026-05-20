import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { isRecord } from './types.js';

const ConfigSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:3421'),
  token: z.string().optional(),
  surfaceKind: z.string().default('goodvibes-agent'),
  surfaceId: z.string().default('goodvibes-agent'),
  defaultChatTitle: z.string().default('GoodVibes Agent'),
  provider: z.string().optional(),
  model: z.string().optional(),
  companionTimeoutMs: z.number().int().positive().default(90_000),
  autoRemember: z.boolean().default(true),
  autoDelegateBuildRequests: z.boolean().default(true),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

export type ConfigValueSource = 'file' | 'env' | 'default';
export type TokenSourceKind = 'env' | 'daemon-token-file' | 'none';

export interface AgentTokenInfo {
  readonly source: TokenSourceKind;
  readonly envName?: string | undefined;
  readonly path?: string | undefined;
  readonly present: boolean;
  readonly fingerprint?: string | undefined;
}

export interface AgentConfigMetadata {
  readonly agentHome: string;
  readonly configPath: string;
  readonly configExists: boolean;
  readonly baseUrlSource: ConfigValueSource;
  readonly token: AgentTokenInfo;
}

export interface LoadedAgentConfig {
  readonly config: AgentConfig;
  readonly metadata: AgentConfigMetadata;
}

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

function readDaemonToken(): { readonly token?: string | undefined; readonly info: AgentTokenInfo } {
  const envCandidates = [
    ['GOODVIBES_AGENT_TOKEN', process.env.GOODVIBES_AGENT_TOKEN],
    ['GOODVIBES_HTTP_TOKEN', process.env.GOODVIBES_HTTP_TOKEN],
    ['GOODVIBES_DAEMON_TOKEN', process.env.GOODVIBES_DAEMON_TOKEN],
  ] as const;
  for (const [envName, value] of envCandidates) {
    if (value?.trim()) {
      const token = value.trim();
      return {
        token,
        info: {
          source: 'env',
          envName,
          present: true,
          fingerprint: tokenFingerprint(token),
        },
      };
    }
  }
  const tokenPath = join(homedir(), '.goodvibes', 'daemon', 'operator-tokens.json');
  try {
    if (!existsSync(tokenPath)) return { info: { source: 'none', present: false } };
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as unknown;
    const token = isRecord(parsed) && typeof parsed.token === 'string' && parsed.token.trim()
      ? parsed.token.trim()
      : undefined;
    return {
      token,
      info: token
        ? {
          source: 'daemon-token-file',
          path: tokenPath,
          present: true,
          fingerprint: tokenFingerprint(token),
        }
        : {
          source: 'daemon-token-file',
          path: tokenPath,
          present: false,
        },
    };
  } catch {
    return { info: { source: 'daemon-token-file', path: tokenPath, present: false } };
  }
}

export function loadAgentConfig(): AgentConfig {
  return loadAgentConfigWithMetadata().config;
}

export function loadAgentConfigWithMetadata(): LoadedAgentConfig {
  const fileConfig = readJsonFile(agentConfigPath());
  const fileRecord = isRecord(fileConfig) ? fileConfig : {};
  const token = readDaemonToken();
  const envBaseUrl = process.env.GOODVIBES_AGENT_BASE_URL ?? process.env.GOODVIBES_BASE_URL;
  const envProvider = process.env.GOODVIBES_AGENT_PROVIDER;
  const envModel = process.env.GOODVIBES_AGENT_MODEL;
  const config = ConfigSchema.parse({
    ...fileRecord,
    ...(envBaseUrl ? { baseUrl: envBaseUrl }
      : {}),
    ...(envProvider ? { provider: envProvider } : {}),
    ...(envModel ? { model: envModel } : {}),
    ...(token.token ? { token: token.token } : {}),
  });
  return {
    config,
    metadata: {
      agentHome: agentHomeDir(),
      configPath: agentConfigPath(),
      configExists: existsSync(agentConfigPath()),
      baseUrlSource: envBaseUrl
        ? 'env'
        : typeof fileRecord.baseUrl === 'string'
          ? 'file'
          : 'default',
      token: token.info,
    },
  };
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

function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}
