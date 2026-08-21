/**
 * store-file.ts, the single writer every on-disk JSON store in this repo goes
 * through.
 *
 * Every store here is a shared write target: the agent process and a one-shot
 * `goodvibes ...` CLI invocation construct the same registry class over the
 * same path, so two OS processes can be mid-write on one file at once. That
 * sharing is not removable (the store IS the canonical record both processes
 * read), so it has to be serialized structurally instead, and the structure is
 * this module: nobody hand-rolls a temp path.
 *
 * Two separate hazards, two separate mechanisms:
 *
 * 1. TORN FILES, handled by {@link writeStoreFile}. A fixed `${path}.tmp` temp
 *    name is shared by every writer: both truncate it, both write into it, and
 *    whichever renames second promotes a file holding interleaved bytes from
 *    two writers. The next read then fails to parse and the store's whole
 *    history is gone, not just the record being written. A temp name carrying
 *    the pid and a per-process sequence number cannot be shared by any two
 *    writes anywhere, and `rename` onto the final path is atomic, so a reader
 *    sees either the whole previous file or the whole new one.
 *
 * 2. LOST UPDATES inside one process, handled by {@link runStoreFileUpdate}.
 *    A read-modify-write cycle written as straight-line synchronous code
 *    (`readStore(); mutate; writeStore()`) cannot be interleaved at all: the
 *    event loop gets no turn between the read and the rename, so the cycle is
 *    already serialized by construction and needs no lock. That is why the
 *    synchronous registries below call {@link writeStoreFile} directly. A
 *    cycle that spans an `await` has no such protection: two overlapping
 *    callers both read the old file and the second rename discards the first
 *    caller's change. Those cycles queue on {@link runStoreFileUpdate}, which
 *    keys the queue on the resolved store path rather than on an owning
 *    object, so two registry instances over one file still take turns.
 *
 * Neither mechanism serializes read-modify-write ACROSS processes; only the
 * torn-file half of that is fixed here. Making the CLI and the agent take
 * turns on a whole cycle needs an out-of-process lock, which nothing in this
 * repo has yet.
 *
 * `scripts/check-architecture.ts`'s `no-hand-rolled-store-temp-writes` rule
 * fails the build on any `${...}.tmp` temp path built outside this file, so
 * the pattern cannot come back by copy-paste.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Atomic single-file writes
// ---------------------------------------------------------------------------

/**
 * Distinguishes two writes issued by this same process. The pid alone is not
 * enough: one process can have two writes to one path in flight across an
 * `await`, and they would otherwise share a temp name exactly the way two
 * processes used to.
 */
let tempSequence = 0;

/** The temp path a single write owns for its lifetime. */
function nextTempPath(path: string): string {
  tempSequence += 1;
  return `${path}.${process.pid}.${tempSequence}.tmp`;
}

/**
 * Write `contents` to `path` through a private temp file and an atomic rename,
 * creating the parent directory if needed. A failed write removes its own temp
 * file and leaves `path` holding its previous contents.
 */
export function writeStoreFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = nextTempPath(path);
  try {
    writeFileSync(tempPath, contents, 'utf-8');
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // The temp file is inert; a failed cleanup must not mask the real error.
    }
    throw error;
  }
}

/** {@link writeStoreFile} for the pretty-printed-JSON-plus-newline shape most stores use. */
export function writeStoreJson(path: string, data: unknown): void {
  writeStoreFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Serializing read-modify-write cycles that span an await
// ---------------------------------------------------------------------------

/**
 * One promise chain per store path, holding the tail of that path's queue.
 *
 * Keyed by resolved path, not by the object that happens to own the store, so
 * two registry instances built over one file serialize against each other.
 * Entries are dropped once a path's queue drains, so a long-lived process that
 * touches many stores does not accumulate them.
 */
const updateQueues = new Map<string, Promise<unknown>>();

/**
 * Run `update` once every previously queued update for `path` has settled.
 *
 * Chains onto the queue regardless of whether earlier updates resolved or
 * rejected, so a failed update never wedges the ones behind it, and returns
 * `update`'s own result or rejection to its caller.
 */
export function runStoreFileUpdate<T>(path: string, update: () => Promise<T> | T): Promise<T> {
  const key = resolve(path);
  const previous = updateQueues.get(key) ?? Promise.resolve();
  const run = previous.then(update, update);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  updateQueues.set(key, tail);
  void tail.then(() => {
    // Only the tail may clear the entry; a later enqueue has already replaced it.
    if (updateQueues.get(key) === tail) updateQueues.delete(key);
  });
  return run;
}
