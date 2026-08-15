// SPDX-License-Identifier: MIT

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Marks a pattern as a git source rather than a glob. */
const GIT_PREFIX = "git:";

/** Added, Copied, Modified, Renamed — the states that leave a readable file. */
const DIFF_FILTER = "--diff-filter=ACMR";

/** Large change sets can exceed Node's 1MB default. */
const MAX_BUFFER = 32 * 1024 * 1024;

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export function isGitSource(pattern: string): boolean {
  return pattern.startsWith(GIT_PREFIX);
}

async function isRepository(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run git and split its NUL-terminated path list.
 * `-z` avoids git's path quoting for non-ASCII and unusual filenames.
 */
async function run(args: string[], cwd: string): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: MAX_BUFFER,
    }));
  } catch (error) {
    const { code, stderr, message } = error as {
      code?: string;
      stderr?: string;
      message?: string;
    };
    if (code === "ENOENT") {
      throw new GitError("git not found (required by `git:` patterns)");
    }
    // Outside a repository `git diff` falls back to --no-index and reports a
    // usage error, so check for the real cause before surfacing stderr.
    if (!(await isRepository(cwd))) {
      throw new GitError(`Not a git repository: ${cwd}`);
    }
    // stderr is empty when the process was killed (maxBuffer, signal), so fall
    // back to the Node error rather than an opaque "failed"
    throw new GitError(
      stderr?.trim() || message?.trim() || `git ${args.join(" ")} failed`,
    );
  }
  return stdout.split("\0").filter(Boolean);
}

/**
 * Resolve a `git:` source to worktree-relative paths.
 *
 * - `git:staged` — index vs HEAD
 * - `git:unstaged` — worktree vs index (tracked files only)
 * - `git:untracked` — new files not ignored by git
 * - `git:dirty` — union of the three
 * - `git:<rev>` — worktree vs the merge base of `<rev>` and HEAD, so a
 *   diverged branch reports only your own changes. Ranges pass through verbatim.
 *
 * `--relative` scopes results to `cwd` and makes them relative to it, matching
 * how glob patterns resolve.
 */
export async function resolveGitSource(
  pattern: string,
  cwd: string,
): Promise<string[]> {
  const source = pattern.slice(GIT_PREFIX.length);

  if (!source) {
    throw new GitError(
      `Empty git source in "${pattern}". Expected git:staged, git:unstaged, git:untracked, git:dirty, or git:<rev>.`,
    );
  }
  // git would parse a leading dash as a flag
  if (source.startsWith("-")) {
    throw new GitError(
      `Invalid git source "${pattern}": revision starts with "-".`,
    );
  }

  const diff = (...args: string[]) =>
    run(
      ["diff", "--name-only", DIFF_FILTER, "--relative", "-z", ...args, "--"],
      cwd,
    );

  switch (source) {
    case "staged":
      return diff("--cached");
    case "unstaged":
      return diff();
    case "untracked":
      return run(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
    case "dirty": {
      const sets = await Promise.all([
        resolveGitSource("git:staged", cwd),
        resolveGitSource("git:unstaged", cwd),
        resolveGitSource("git:untracked", cwd),
      ]);
      return [...new Set(sets.flat())];
    }
    default:
      // A range already names both endpoints; a single rev gets merge-base
      // treatment, which is a no-op for ancestors like HEAD~3.
      return source.includes("..")
        ? diff(source)
        : diff("--merge-base", source);
  }
}
