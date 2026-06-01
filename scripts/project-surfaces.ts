import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPeerContract } from '@pellux/goodvibes-sdk/contracts';
import { GatewayMethodCatalog, buildOperatorContract } from '@pellux/goodvibes-sdk/platform/control-plane';
import { getKnowledgeGraphqlSchemaText, renderKnowledgeSchemaSql } from '@pellux/goodvibes-sdk/platform/knowledge';

const ROOT = join(import.meta.dir, '..');
type OperatorContractArtifact = ReturnType<typeof buildOperatorContract>;
type OperatorContractMethod = OperatorContractArtifact['operator']['methods'][number];

const AGENT_EXCLUDED_OPERATOR_METHOD_PREFIXES = [
  'homeassistant.',
] as const;
const AGENT_EXCLUDED_CONTRACT_VALUES = new Set<unknown>([
  'homeassistant',
]);

function toSerializable(value: unknown, stack = new Map<object, string>(), path = '$'): unknown {
  if (!value || typeof value !== 'object') return value;
  const prior = stack.get(value as object);
  if (prior) {
    return { $ref: prior };
  }
  const next = new Map(stack);
  next.set(value as object, path);
  if (Array.isArray(value)) {
    return value.map((entry, index) => toSerializable(entry, next, `${path}[${index}]`));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      toSerializable(entry, next, `${path}.${key}`),
    ]),
  );
}

function writeJsonArtifact(outputDir: string, name: string, value: unknown): void {
  const target = join(outputDir, name);
  const normalized = JSON.stringify(toSerializable(value), null, 2);
  writeFileSync(target, `${normalized}\n`, 'utf8');
}

function writeTextArtifact(outputDir: string, name: string, value: string): void {
  writeFileSync(join(outputDir, name), value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

function hasSchema(schema: unknown): boolean {
  return Boolean(schema && typeof schema === 'object');
}

function isAgentOperatorMethod(method: OperatorContractMethod): boolean {
  const routePath = typeof method.http?.path === 'string' ? method.http.path : '';
  return !AGENT_EXCLUDED_OPERATOR_METHOD_PREFIXES.some((prefix) => method.id.startsWith(prefix))
    && !routePath.startsWith('/api/homeassistant/');
}

function stripAgentExcludedContractValues(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (AGENT_EXCLUDED_CONTRACT_VALUES.has(value)) return undefined;
  if (!value || typeof value !== 'object') return value;

  const prior = seen.get(value);
  if (prior) return prior;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const entry of value) {
      const next = stripAgentExcludedContractValues(entry, seen);
      if (next !== undefined) output.push(next);
    }
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    const next = stripAgentExcludedContractValues(entry, seen);
    if (next !== undefined) output[key] = next;
  }
  return output;
}

export function buildAgentOperatorContractArtifact(catalog = new GatewayMethodCatalog()): OperatorContractArtifact {
  const contract = buildOperatorContract(catalog);
  const methods = contract.operator.methods.filter(isAgentOperatorMethod);
  const typedInputs = methods.filter((method) => hasSchema(method.inputSchema)).length;
  const typedOutputs = methods.filter((method) => hasSchema(method.outputSchema)).length;
  return stripAgentExcludedContractValues({
    ...contract,
    operator: {
      ...contract.operator,
      methods,
      schemaCoverage: {
        ...contract.operator.schemaCoverage,
        methods: methods.length,
        typedInputs,
        genericInputs: methods.length - typedInputs,
        typedOutputs,
        genericOutputs: methods.length - typedOutputs,
      },
    },
  }) as OperatorContractArtifact;
}

export function syncVersionSurfaces(root = ROOT): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    readonly version?: unknown;
    readonly dependencies?: Record<string, unknown>;
  };
  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const sdkVersion = typeof pkg.dependencies?.['@pellux/goodvibes-sdk'] === 'string'
    ? pkg.dependencies['@pellux/goodvibes-sdk']
    : 'unknown';

  const versionTsPath = join(root, 'src', 'version.ts');
  try {
    let versionTs = readFileSync(versionTsPath, 'utf8');
    versionTs = versionTs.replace(/let _version = '[^']*'/, `let _version = '${version}'`);
    versionTs = versionTs.replace(/let _sdkVersion = '[^']*'/, `let _sdkVersion = '${sdkVersion}'`);
    writeFileSync(versionTsPath, versionTs);
    console.log(`prebuild: src/version.ts fallback → ${version} / sdk ${sdkVersion}`);
  } catch {
    console.log('prebuild: src/version.ts — not found, skipping');
  }

  const readmePath = join(root, 'README.md');
  try {
    let readme = readFileSync(readmePath, 'utf8');
    const versionRe = /version-[0-9]+\.[0-9]+\.[0-9]+-blue\.svg/;
    if (versionRe.test(readme)) {
      readme = readme.replace(versionRe, `version-${version}-blue.svg`);
      writeFileSync(readmePath, readme);
      console.log(`prebuild: README.md → ${version}`);
    } else {
      console.log('prebuild: README.md — no version badge found, skipping');
    }
  } catch {
    console.log('prebuild: README.md — not found, skipping');
  }

  return version;
}

export function syncFoundationArtifacts(root = ROOT): void {
  const outputDir = join(root, 'docs', 'foundation-artifacts');

  mkdirSync(outputDir, { recursive: true });

  const operatorContract = buildAgentOperatorContractArtifact();
  const peerContract = getPeerContract();

  writeJsonArtifact(outputDir, 'operator-contract.json', operatorContract);
  writeJsonArtifact(outputDir, 'peer-contract.json', peerContract);
  writeTextArtifact(outputDir, 'knowledge-graphql.graphql', getKnowledgeGraphqlSchemaText());
  writeTextArtifact(outputDir, 'knowledge-store.sql', renderKnowledgeSchemaSql());

  console.log(`foundation artifacts written to ${outputDir}`);
}

export function syncProjectSurfaces(root = ROOT): string {
  const version = syncVersionSurfaces(root);
  syncFoundationArtifacts(root);
  console.log(`prebuild: done (v${version})`);
  return version;
}
