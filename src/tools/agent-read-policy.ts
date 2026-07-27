import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { wasWrittenThisSession } from '../runtime/session-write-provenance.ts';

type ReadFileArgs = {
  readonly path?: unknown;
  readonly image_mode?: unknown;
  readonly [key: string]: unknown;
};

type ReadToolArgs = {
  readonly files?: unknown;
  readonly image_mode?: unknown;
  readonly max_image_size?: unknown;
  readonly [key: string]: unknown;
};

const READ_IMAGE_MODES = ['default', 'metadata-only', 'thumbnail-only'] as const;
const READ_IMAGE_MODE_SET = new Set<string>(READ_IMAGE_MODES);
const MAX_READ_FILES = 10;
const MAX_READ_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const SECRET_FILE_EXTENSIONS = new Set([
  '',
  '.cfg',
  '.conf',
  '.env',
  '.ini',
  '.json',
  '.properties',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
]);

const SECRET_EXACT_SEGMENTS = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'apikey',
  'api_key',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'password',
  'passwords',
  'passwd',
  'secret',
  'secrets',
  'token',
  'tokens',
]);

const SECRET_EXACT_FILE_NAMES = new Set([
  'known_hosts',
]);

const PRIVATE_KEY_EXTENSIONS = new Set([
  '.key',
  '.p12',
  '.pem',
  '.pfx',
]);

const READ_POLICY_DENIAL = [
  'GoodVibes Agent only exposes bounded, non-secret project reads from the main conversation.',
  'Hidden paths, secret-looking files, broad batches, unoptimized image extraction, and oversized image reads are disabled here.',
  'Use explicit Agent CLI/slash commands or GoodVibes TUI delegation when the user intentionally asks for sensitive or deeper local inspection.',
].join(' ');

export const AGENT_READ_IMAGE_MODES = READ_IMAGE_MODES;
export const AGENT_MAX_READ_FILES = MAX_READ_FILES;
export const AGENT_MAX_READ_IMAGE_SIZE_BYTES = MAX_READ_IMAGE_SIZE_BYTES;
export const AGENT_READ_POLICY_DENIAL_MESSAGE = READ_POLICY_DENIAL;

export function wrapReadToolForAgentPolicy(tool: Tool): void {
  narrowReadToolDefinitionForAgentPolicy(tool);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const readArgs = args as ReadToolArgs;
    const denial = validateReadToolInvocationForAgentPolicy(readArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(args);
  };
}

export function validateReadToolInvocationForAgentPolicy(args: ReadToolArgs): string | null {
  if (Array.isArray(args.files) && args.files.length > MAX_READ_FILES) return READ_POLICY_DENIAL;
  if (args.image_mode === 'unoptimized') return READ_POLICY_DENIAL;
  if (typeof args.image_mode === 'string' && !READ_IMAGE_MODE_SET.has(args.image_mode)) return READ_POLICY_DENIAL;
  if (typeof args.max_image_size === 'number' && args.max_image_size > MAX_READ_IMAGE_SIZE_BYTES) {
    return READ_POLICY_DENIAL;
  }

  if (!Array.isArray(args.files)) return null;
  for (const file of args.files) {
    if (!isRecord(file)) continue;
    const fileArgs = file as ReadFileArgs;
    if (fileArgs.image_mode === 'unoptimized') return READ_POLICY_DENIAL;
    if (typeof fileArgs.image_mode === 'string' && !READ_IMAGE_MODE_SET.has(fileArgs.image_mode)) {
      return READ_POLICY_DENIAL;
    }
    if (typeof fileArgs.path === 'string' && isBlockedReadPath(fileArgs.path)) return READ_POLICY_DENIAL;
  }

  return null;
}

export function isBlockedReadPath(path: string): boolean {
  const segments = path.replaceAll('\\', '/').split('/').filter((segment) => segment.length > 0);
  const fileNameEarly = segments.at(-1)?.toLowerCase() ?? '';
  const secretLooking = SECRET_EXACT_FILE_NAMES.has(fileNameEarly)
    || PRIVATE_KEY_EXTENSIONS.has(getExtension(fileNameEarly))
    || segments.some((segment) => SECRET_EXACT_SEGMENTS.has(segment.toLowerCase()));

  // A file this session wrote itself is not what the hidden-path rule protects.
  // The agent takes a screenshot into the platform's storage root — a dotted
  // directory — and must be able to open the thing it just made. The exemption
  // is narrow on purpose: only paths recorded as written by this session, and
  // never anything secret-looking.
  if (!secretLooking && wasWrittenThisSession(path)) return false;

  for (const segment of segments) {
    if (segment === '.' || segment === '..') continue;
    const lower = segment.toLowerCase();
    if (lower.startsWith('.')) return true;
    if (SECRET_EXACT_SEGMENTS.has(lower)) return true;
  }

  const fileName = segments.at(-1)?.toLowerCase() ?? '';
  if (fileName.length === 0) return false;
  if (SECRET_EXACT_FILE_NAMES.has(fileName)) return true;
  const extension = getExtension(fileName);
  if (PRIVATE_KEY_EXTENSIONS.has(extension)) return true;
  const stem = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
  return SECRET_EXACT_SEGMENTS.has(stem) && SECRET_FILE_EXTENSIONS.has(extension);
}

function narrowReadToolDefinitionForAgentPolicy(tool: Tool): void {
  tool.definition.description = 'Read ordinary non-secret project files for GoodVibes Agent.';
  tool.definition.sideEffects = ['read_fs'];
  tool.definition.concurrency = 'serial';

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;

  const files = properties.files;
  if (isRecord(files)) {
    files.maxItems = MAX_READ_FILES;
    files.description = 'Ordinary non-hidden, non-secret-looking project files to read. Sensitive paths require explicit user-directed workflows.';
    const itemSchema = files.items;
    if (isRecord(itemSchema)) {
      const fileProperties = itemSchema.properties;
      if (isRecord(fileProperties)) {
        const pathProperty = fileProperties.path;
        if (isRecord(pathProperty)) {
          pathProperty.description = 'Relative or absolute path to a non-hidden, non-secret-looking project file.';
        }
        narrowImageModeProperty(fileProperties, 'image_mode');
      }
    }
  }

  narrowImageModeProperty(properties, 'image_mode');
  const maxImageSize = properties.max_image_size;
  if (isRecord(maxImageSize)) {
    maxImageSize.maximum = MAX_READ_IMAGE_SIZE_BYTES;
    maxImageSize.description = 'Maximum image file size in bytes allowed by GoodVibes Agent read policy.';
  }
}

function narrowImageModeProperty(properties: Record<string, unknown>, key: string): void {
  const property = properties[key];
  if (!isRecord(property)) return;
  property.enum = [...READ_IMAGE_MODES];
  property.description = 'Image handling mode allowed by GoodVibes Agent read policy. Full-resolution unoptimized extraction is disabled.';
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return fileName.slice(dotIndex);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
