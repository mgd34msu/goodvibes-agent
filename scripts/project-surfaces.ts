import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

export function syncVersionSurfaces(root = ROOT): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    readonly version?: unknown;
    readonly dependencies?: Record<string, unknown>;
    readonly devDependencies?: Record<string, unknown>;
  };
  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const packageSdkVersion = pkg.dependencies?.['@pellux/goodvibes-sdk'] ?? pkg.devDependencies?.['@pellux/goodvibes-sdk'];
  const sdkVersion = typeof packageSdkVersion === 'string'
    ? packageSdkVersion
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

export function syncProjectSurfaces(root = ROOT): string {
  const version = syncVersionSurfaces(root);
  console.log(`prebuild: done (v${version})`);
  return version;
}
