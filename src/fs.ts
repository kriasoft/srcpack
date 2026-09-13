// SPDX-License-Identifier: MIT

import { realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Where a path physically is, with symlinks resolved. Destructive decisions are
 * made on this rather than the lexical path: `.srcpack -> ../shared` is inside
 * the project by name and somewhere else in fact, and it is the somewhere else
 * whose contents `rm` would take.
 *
 * Resolves as much of the path as exists, however deep that is. Stopping at the
 * immediate parent would call `.srcpack/nested/x.txt` and `alias/nested/x.txt`
 * different files until `mkdir -p` runs, which is one step too late to still be
 * a check: aliasing is a property of the ancestors, not of when they were made.
 */
export async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    // dirname("/") === "/": nothing above the filesystem root left to resolve
    if (parent === path) return path;
    return join(await physicalPath(parent), basename(path));
  }
}

/**
 * Where `rename` puts a directory entry: ancestors resolved, the entry itself
 * left alone. Writing replaces the entry instead of following it, so a bundle
 * whose output is a symlink is identified as the link rather than its target —
 * two bundles writing over one link's target are still two separate files.
 */
export async function entryPath(path: string): Promise<string> {
  return join(await physicalPath(dirname(path)), basename(path));
}

export function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  // Compare against ".." as a whole segment — "..cache/x" is a child, not an escape
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Write a file by replacing the directory entry rather than the file behind
 * it. Writing in place follows a symlink sitting at the output path, so
 * `.srcpack/web.txt -> ~/.ssh/config` would be written through; rename replaces
 * the link itself. It also makes each file appear whole or not at all.
 *
 * The temp name carries the pid so two runs can't rename each other's file.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } finally {
    // A failed write or rename would otherwise leave a partial file behind:
    // stale inside outDir, and bundled by the next run beside a custom outfile.
    await rm(temp, { force: true });
  }
}
