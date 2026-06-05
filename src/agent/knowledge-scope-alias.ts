import {
  DEFAULT_KNOWLEDGE_SPACE_ID,
  goodVibesAgentKnowledgeSpaceId,
} from '@pellux/goodvibes-sdk/platform/knowledge';

type JsonRecord = Record<string, unknown>;

const AGENT_KNOWLEDGE_PUBLIC_SPACE_ID = goodVibesAgentKnowledgeSpaceId();
const AGENT_KNOWLEDGE_SCOPE_FIELDS = new Set(['spaceId', 'knowledgeSpaceId', 'namespace']);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDefaultScopeValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === DEFAULT_KNOWLEDGE_SPACE_ID;
}

export function normalizeAgentKnowledgeScopeAliases<TValue>(value: TValue): TValue {
  if (Array.isArray(value)) {
    let changed = false;
    const normalized = value.map((item) => {
      const next = normalizeAgentKnowledgeScopeAliases(item);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? normalized : value) as TValue;
  }

  if (!isRecord(value)) return value;

  let changed = false;
  const output: JsonRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    if (AGENT_KNOWLEDGE_SCOPE_FIELDS.has(key) && isDefaultScopeValue(nested)) {
      output[key] = AGENT_KNOWLEDGE_PUBLIC_SPACE_ID;
      changed = true;
      continue;
    }
    const normalized = normalizeAgentKnowledgeScopeAliases(nested);
    output[key] = normalized;
    if (normalized !== nested) changed = true;
  }

  return (changed ? output : value) as TValue;
}

export function normalizeAgentKnowledgeJsonText(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const normalized = normalizeAgentKnowledgeScopeAliases(parsed);
    return normalized === parsed ? body : JSON.stringify(normalized);
  } catch {
    return body;
  }
}
