/**
 * Names and shapes of this repo's release assets, exactly as the Release
 * workflow publishes them (.github/workflows/release.yml):
 *
 *   - compiled binaries `goodvibes-agent-<os>-<arch>` for linux/macos ×
 *     x64/arm64 (the release tag maps darwin → "macos");
 *   - per-platform sqlite-vec native addon ARCHIVES named
 *     `sqlite-vec-<platform>-<arch>.tar.gz` (Node-style platform tag), each
 *     carrying the exact layout the runtime resolves relative to the binary —
 *     `lib/sqlite-vec-<platform>-<arch>/vec0.<suffix>`;
 *   - one `SHA256SUMS.txt` manifest covering every asset above.
 *
 * The checksum manifest name and parser are the SDK's canonical ones
 * (platform/runtime/self-update) so the agent verifies with the same
 * mechanism every other surface uses. Asset NAMING stays local because it
 * encodes THIS repo's release layout — the SDK's resolveArtifactNames names
 * the TUI's `goodvibes`/`goodvibes-daemon` pair, which this repo does not
 * ship.
 */
import { gunzipSync } from 'node:zlib';

export { CHECKSUM_MANIFEST_NAME, parseChecksumFile } from '@pellux/goodvibes-sdk/platform/runtime/self-update';

const SUPPORTED_ARCHES = new Set(['x64', 'arm64']);

/**
 * Release asset name of the compiled agent binary for a platform/arch, or
 * null when no prebuilt binary is published for it (the release ships no
 * Windows binary asset).
 */
export function resolveAgentBinaryAssetName(platform: string, arch: string): string | null {
  if (!SUPPORTED_ARCHES.has(arch)) return null;
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'macos' : null;
  if (!os) return null;
  return `goodvibes-agent-${os}-${arch}`;
}

export interface SqliteVecArchiveAsset {
  /** Release asset filename, e.g. `sqlite-vec-linux-x64.tar.gz`. */
  readonly assetName: string;
  /** Directory name the loader resolves, e.g. `sqlite-vec-linux-x64`. */
  readonly dirName: string;
  /** File the loader opens inside that directory, e.g. `vec0.so`. */
  readonly fileName: string;
  /** The addon file's path inside the archive (and relative to the binary): `lib/<dirName>/<fileName>`. */
  readonly entryPath: string;
}

/**
 * Names the sqlite-vec addon ARCHIVE for a platform/arch. Unlike the binary
 * (whose release name maps darwin to "macos"), the archive keeps the
 * Node-style platform tag because that is exactly what the extension loader
 * resolves at `<execDir>/lib/sqlite-vec-<platform>-<arch>/vec0.<suffix>`.
 */
export function resolveSqliteVecArchive(platform: string, arch: string): SqliteVecArchiveAsset | null {
  if (!SUPPORTED_ARCHES.has(arch)) return null;
  const suffix = platform === 'linux' ? 'so' : platform === 'darwin' ? 'dylib' : null;
  if (!suffix) return null;
  const dirName = `sqlite-vec-${platform}-${arch}`;
  const fileName = `vec0.${suffix}`;
  return {
    assetName: `${dirName}.tar.gz`,
    dirName,
    fileName,
    entryPath: `lib/${dirName}/${fileName}`,
  };
}

const TAR_BLOCK = 512;

function readTarString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.toString('utf-8', 0, nul === -1 ? length : nul);
}

/**
 * Extract one regular-file entry from a gzipped tar archive, by its exact
 * path (a leading `./` on the archived name is tolerated). Returns the file
 * bytes, or null when the archive holds no such entry. Throws on a gzip
 * stream that does not decompress — a corrupted download must fail loudly,
 * never read as "entry absent".
 *
 * Local on purpose: the released addon archives are flat ustar archives with
 * short paths, so this reads the standard header fields (name, size octal,
 * typeflag, ustar prefix) and skips everything that is not the requested
 * regular file — no external `tar` spawn in the update path.
 */
export function extractTarGzEntry(archive: Buffer | Uint8Array, entryPath: string): Buffer | null {
  const tar = gunzipSync(archive);
  let offset = 0;
  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    // Two consecutive zero blocks end the archive; a zero name block is enough here.
    if (header[0] === 0) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeOctal = readTarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeOctal || '0', 8);
    if (!Number.isFinite(size) || size < 0) return null;
    const typeflag = header[156];
    const isRegular = typeflag === 0 || typeflag === 0x30; // NUL or '0'
    const normalized = fullName.startsWith('./') ? fullName.slice(2) : fullName;
    const dataStart = offset + TAR_BLOCK;
    if (isRegular && normalized === entryPath) {
      if (dataStart + size > tar.length) return null;
      return Buffer.from(tar.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return null;
}
