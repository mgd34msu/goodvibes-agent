import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const roots = ['bin', 'scripts', 'src', 'test'] as const;
const sourceExtensions = new Set(['.ts', '.tsx']);
const forbiddenSourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const forbiddenWord = `${'a'}${'ny'}`;
const forbiddenPattern = new RegExp(`(^|[^A-Za-z0-9_$])${forbiddenWord}([^A-Za-z0-9_$]|$)`);

const failures: string[] = [];

for (const root of roots) {
  for (const path of await listFiles(root)) {
    const extension = path.slice(path.lastIndexOf('.'));
    if (forbiddenSourceExtensions.has(extension)) {
      failures.push(`${relative(process.cwd(), path)}: authored code must be TypeScript`);
      continue;
    }
    if (!sourceExtensions.has(extension)) continue;
    const text = await readFile(path, 'utf-8');
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (forbiddenPattern.test(stripStringLiterals(lines[index] ?? ''))) {
        failures.push(`${relative(process.cwd(), path)}:${index + 1}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Type policy check failed:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

async function listFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function stripStringLiterals(line: string): string {
  let result = '';
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (const char of line) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      result += ' ';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result += ' ';
      continue;
    }
    result += char;
  }
  return result;
}
