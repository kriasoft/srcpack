// SPDX-License-Identifier: MIT

import { glob } from "fast-glob";
import ignore, { type Ignore } from "ignore";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import picomatch from "picomatch";
import {
  ConfigError,
  expandPath,
  type BundleConfigInput,
  type LinearSourceInput,
} from "./config.ts";
import { isGitSource, resolveGitSource } from "./git.ts";
import { resolveLinearSource } from "./linear.ts";

// Binary file detection: check first 8KB for null bytes (same heuristic as git)
const BINARY_CHECK_SIZE = 8192;

/**
 * Shared glob options. `followSymbolicLinks: false` is the load-bearing one:
 * fast-glob defaults to true, so a link like `vendor -> ../../elsewhere` would
 * be walked and every regular file under it bundled. Rejecting symlinks at the
 * final component (see {@link isBundleable}) can't catch that — the leaf is an
 * ordinary file; the escape happened in a directory along the way.
 */
const GLOB_OPTIONS = {
  onlyFiles: true,
  dot: true,
  followSymbolicLinks: false,
} as const;

/**
 * Whether a path can be read into a bundle: an existing regular text file.
 * Globs only yield files, but git can name a submodule directory or a file
 * deleted from the worktree after it was listed.
 *
 * `lstat` deliberately does not follow symlinks: a tracked link such as
 * `notes.txt -> ~/.ssh/id_rsa` would otherwise bundle a file from outside the
 * project under an innocuous name. Point a pattern at the real path instead.
 */
async function isBundleable(filePath: string): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  if (stats.size === 0) return true;

  // Racy against deletion between lstat and open, so failure means "skip"
  let fd;
  try {
    fd = await open(filePath, "r");
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(Math.min(stats.size, BINARY_CHECK_SIZE));
    await fd.read(buffer, 0, buffer.length, 0);
    return !buffer.includes(0);
  } finally {
    await fd.close();
  }
}

/**
 * One bundle member, before its content is laid out.
 *
 * `content` present means the entry is virtual — produced by a non-filesystem
 * source such as Linear — and its `path` is synthetic. Absent means an ordinary
 * file, read from disk at bundle time.
 */
export interface Entry {
  path: string;
  content?: string;
}

/** One line of the bundle index — a file or a virtual entry, once laid out. */
export interface IndexEntry {
  path: string; // Relative path from cwd, or a synthetic path
  lines: number; // Line count in the entry's content
  startLine: number; // Start line in bundle (1-indexed)
  endLine: number; // End line in bundle
}

export interface BundleResult {
  content: string;
  index: IndexEntry[];
}

/**
 * Normalize BundleConfig to arrays of include/exclude/force patterns.
 * - Regular patterns: included, filtered by .gitignore
 * - `!pattern`: excluded from results
 * - `+pattern`: force-included, bypasses .gitignore
 *
 * `git:` sources are include-only: `!` has no clear meaning for them, and `+`
 * is redundant since they already bypass .gitignore.
 */
/**
 * Prepare a config pattern for matching: expand `~/`, then force posix
 * separators. fast-glob and picomatch require them, but `~/` expansion and
 * hand-written Windows paths produce backslashes.
 */
function toPattern(pattern: string): string {
  const expanded = expandPath(pattern);
  return sep === "\\" ? expanded.replaceAll("\\", "/") : expanded;
}

function normalizePatterns(config: BundleConfigInput): {
  include: string[];
  exclude: string[];
  force: string[];
} {
  let patterns: string[];

  if (typeof config === "string") {
    patterns = [config];
  } else if (Array.isArray(config)) {
    patterns = config;
  } else if (config.include === undefined) {
    // A `linear`-only bundle has no patterns at all
    patterns = [];
  } else {
    patterns = Array.isArray(config.include)
      ? config.include
      : [config.include];
  }

  const include: string[] = [];
  const exclude: string[] = [];
  const force: string[] = [];

  for (const p of patterns) {
    if (p.startsWith("!")) {
      exclude.push(toPattern(p.slice(1)));
    } else if (p.startsWith("+")) {
      force.push(toPattern(p.slice(1)));
    } else {
      include.push(toPattern(p));
    }
  }

  for (const [prefix, prefixed] of [
    ["!", exclude],
    ["+", force],
  ] as const) {
    const misused = prefixed.find(isGitSource);
    if (misused) {
      throw new ConfigError(
        `Git sources cannot use the "${prefix}" prefix: "${prefix}${misused}"`,
      );
    }
  }

  return { include, exclude, force };
}

type Matcher = (path: string) => boolean;

/**
 * Check if a path matches any of the exclusion matchers
 */
function isExcluded(filePath: string, matchers: Matcher[]): boolean {
  return matchers.some((match) => match(filePath));
}

/**
 * Convert gitignore patterns to glob ignore patterns for fast-glob.
 * This prevents traversing into ignored directories (performance optimization).
 *
 * Conservative approach: only convert simple, unambiguous directory patterns.
 * Complex patterns (negations, root-anchored, globs) are left to the ignore filter.
 */
function gitignoreToGlobPatterns(lines: string[]): string[] {
  // If any negation patterns exist, skip optimization entirely
  // (negations could re-include files in otherwise-ignored directories)
  const hasNegation = lines.some((line) => {
    const trimmed = line.trim();
    // Any line starting with ! is a negation (including !#file which negates "#file")
    return trimmed.startsWith("!");
  });
  if (hasNegation) return [];

  const patterns: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // A trailing slash only says "directory", which is what this prunes anyway.
    // Stripping it first matters: `node_modules/` is the common spelling, and
    // testing for "/" before stripping rejected every one of them.
    const name = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;

    // Skip patterns with special gitignore features we can't safely convert:
    // - Root-anchored (starts with /)
    // - Contains globs (*, ?, [)
    // - Contains path separators (complex paths)
    // - Escaped characters
    if (
      name.startsWith("/") ||
      name.includes("*") ||
      name.includes("?") ||
      name.includes("[") ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      continue;
    }

    // Only convert simple directory names (e.g., "node_modules", "dist")
    // These are safe to prune at any depth
    if (name && /^[\w.-]+$/.test(name)) {
      patterns.push(`**/${name}/**`);
    }
  }

  return patterns;
}

interface GitignoreResult {
  /** Whether git would ignore this cwd-relative posix path. */
  ignores: (path: string) => boolean;
  globPatterns: string[];
}

/** One directory's ignore rules. `dir` is a cwd-relative prefix, "" for root. */
interface IgnoreLayer {
  dir: string;
  ig: Ignore;
}

/**
 * Read an ignore file. Only a missing file means "no rules" — a permission or
 * I/O error would otherwise widen the bundle to exactly the files someone chose
 * to hide, so it fails the run instead.
 */
async function readIgnoreFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ConfigError(
      `Cannot read "${path}": ${(error as Error).message}. ` +
        "srcpack stops rather than bundle files it cannot confirm are ignored.",
    );
  }
}

/**
 * Load the .gitignore rules that apply anywhere under `cwd`.
 *
 * Git resolves ignores per directory: a path is governed by the ignore file in
 * its own directory and in every parent, deepest rule winning. Reading only the
 * root file bundles whatever a nested .gitignore hides — `packages/app/.env` in
 * a monorepo being the case that matters, since ignored secrets staying out is
 * a documented guarantee rather than a convenience.
 */
async function loadGitignore(cwd: string): Promise<GitignoreResult> {
  const rootContent = await readIgnoreFile(join(cwd, ".gitignore"));
  const globPatterns = rootContent
    ? gitignoreToGlobPatterns(rootContent.split("\n"))
    : [];

  const layers: IgnoreLayer[] = [];
  if (rootContent) layers.push({ dir: "", ig: ignore().add(rootContent) });

  // Pruned by the root file's directory patterns: no point walking node_modules
  // to collect ignore files that only govern paths already ignored.
  const nested = await glob(["**/.gitignore"], {
    cwd,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: globPatterns,
  });

  for (const file of nested) {
    const content = await readIgnoreFile(join(cwd, file));
    if (content) layers.push({ dir: dirname(file), ig: ignore().add(content) });
  }

  return { ignores: makeIgnores(layers), globPatterns };
}

/** Resolve the layered rules for one path, deepest directory first. */
function makeIgnores(layers: IgnoreLayer[]): (path: string) => boolean {
  if (layers.length === 0) return () => false;
  const ordered = [...layers].sort((a, b) => b.dir.length - a.dir.length);

  // First layer with an opinion wins; an explicit negation (`!keep.env`) is an
  // opinion too, which is what lets a nested file re-include what its parent hid.
  const opinion = (path: string): boolean | undefined => {
    for (const { dir, ig } of ordered) {
      if (dir && !path.startsWith(`${dir}/`)) continue;
      const relative = dir ? path.slice(dir.length + 1) : path;
      if (!relative || relative === "/") continue;
      const { ignored, unignored } = ig.test(relative);
      if (ignored) return true;
      if (unignored) return false;
    }
    return undefined;
  };

  return (path: string) => {
    // Ancestors first: git never descends into an ignored directory, so nothing
    // beneath one can be negated back in.
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      if (opinion(`${segments.slice(0, i).join("/")}/`)) return true;
    }
    return opinion(path) === true;
  };
}

/**
 * Check if a glob pattern references paths outside cwd.
 * Patterns traversing to parent directories start with ../ (or ./../).
 * Absolute paths are also external.
 */
function isExternalPattern(pattern: string): boolean {
  // e.g. from ~/xxx expansion; isAbsolute also catches Windows drive letters
  if (isAbsolute(pattern)) return true;
  // Handle redundant ./ prefix (e.g., ./../other)
  const normalized = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  return normalized.startsWith("../");
}

/**
 * The key two paths are compared by: canonical spelling, then case folded, on
 * every platform. A case-insensitive filesystem — the default on macOS and
 * Windows — treats `Context.txt` and `context.txt` as one directory entry, and
 * APFS additionally folds Unicode normalisation, so `Café.txt` written as
 * precomposed U+00E9 and as `e` plus U+0301 is also one entry. Normalising
 * before folding is what makes the comparison sound: equal inputs stay equal
 * afterwards whether or not case folding preserves normalisation. `realpath`
 * resolves
 * an existing component to its on-disk spelling, but that doesn't cover these:
 * an output not yet written has no on-disk spelling, and the destination entry
 * is deliberately left unresolved so `rename` replaces a symlink rather than
 * following it. A config that works in Linux CI and loses a bundle on the
 * author's laptop is worse than one rejected everywhere, so the rule is the
 * same on every platform rather than keyed to the filesystem under it.
 *
 * Comparison only. Paths used for I/O keep their original spelling, and
 * ownership stays an exact match: folding there could only widen what srcpack
 * deletes, which is the one direction that must never be widened by a guess.
 */
export function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

/**
 * Whether a path is one srcpack writes. `outputs` holds absolute paths of
 * files or directories; a directory covers everything beneath it.
 */
function isOwnOutput(filePath: string, outputs: string[]): boolean {
  const key = pathKey(filePath);
  return outputs.some((out) => {
    const outKey = pathKey(out);
    return key === outKey || key.startsWith(outKey + sep);
  });
}

/**
 * Resolve bundle config to a list of file paths.
 * - Regular patterns respect .gitignore
 * - Force patterns (+prefix) bypass .gitignore
 * - Exclude patterns (!prefix) filter everything, including git sources
 * - External patterns (`../`, absolute) skip .gitignore entirely
 * - `git:` sources yield concrete paths and skip .gitignore (already tracked,
 *   or reported by git only when not ignored)
 *
 * `outputs` names absolute paths srcpack writes (outDir, custom outfiles).
 * They are never bundled: a rerun would otherwise bundle the previous run's
 * output, nesting it one level deeper every time.
 */
export async function resolvePatterns(
  config: BundleConfigInput,
  cwd: string,
  outputs: string[] = [],
): Promise<string[]> {
  const { include, exclude, force } = normalizePatterns(config);
  const excludeMatchers = exclude.map((p) => picomatch(p));
  const files = new Set<string>();
  // Dedupe by absolute path, not by pattern text: an absolute pattern and a
  // relative one can name the same file, which would bundle it twice.
  const seen = new Set<string>();

  // Absolute patterns (from `~/` or `/`) make fast-glob return absolute paths,
  // so resolve rather than join — `join(cwd, "/abs")` would mangle them.
  const add = async (candidates: string[]) => {
    for (const path of candidates) {
      if (isExcluded(path, excludeMatchers)) continue;
      const absolute = resolve(cwd, path);
      if (seen.has(absolute)) continue;
      if (isOwnOutput(absolute, outputs)) continue;
      if (await isBundleable(absolute)) {
        seen.add(absolute);
        files.add(path);
      }
    }
  };

  for (const source of include.filter(isGitSource)) {
    await add(await resolveGitSource(source, cwd));
  }

  const globs = include.filter((p) => !isGitSource(p));

  // Internal patterns (within cwd): respect .gitignore
  const internalPatterns = globs.filter((p) => !isExternalPattern(p));
  if (internalPatterns.length > 0) {
    const { ignores, globPatterns } = await loadGitignore(cwd);
    const matches = await glob(internalPatterns, {
      ...GLOB_OPTIONS,
      cwd,
      ignore: globPatterns,
    });
    await add(matches.filter((m) => !ignores(m)));
  }

  // External patterns: skip .gitignore (it doesn't apply outside cwd)
  const externalPatterns = globs.filter(isExternalPattern);
  if (externalPatterns.length > 0) {
    await add(await glob(externalPatterns, { ...GLOB_OPTIONS, cwd }));
  }

  // Force includes: bypass .gitignore (no ignore patterns passed to glob)
  if (force.length > 0) {
    await add(await glob(force, { ...GLOB_OPTIONS, cwd }));
  }

  // Sort for deterministic output
  return [...files].sort();
}

/** Read the `linear` source off a bundle config, if it declares one. */
function getLinear(config: BundleConfigInput): LinearSourceInput | undefined {
  if (typeof config === "object" && !Array.isArray(config)) {
    return config.linear;
  }
  return undefined;
}

/**
 * Resolve every source a bundle declares into a sorted entry list.
 *
 * Filesystem and `git:` sources produce paths ({@link resolvePatterns}, which
 * never touches the network); `linear` produces virtual entries carrying their
 * own content. Both then meet the same rules — `!` exclusions apply uniformly,
 * and the result is sorted by path so bundles stay deterministic.
 */
export async function resolveEntries(
  config: BundleConfigInput,
  cwd: string,
  outputs: string[] = [],
): Promise<Entry[]> {
  const linearSource = getLinear(config);

  // Sequential, not parallel: a bad pattern should fail before spending a
  // network round trip, and a failed fetch shouldn't race a filesystem walk.
  const paths = await resolvePatterns(config, cwd, outputs);
  const entries: Entry[] = paths.map((path) => ({ path }));

  if (linearSource) {
    const { exclude } = normalizePatterns(config);
    const excludeMatchers = exclude.map((p) => picomatch(p));
    // Compare resolved paths, not the strings: an absolute pattern and a
    // relative one name the same file with different spellings, and only the
    // resolved form tells whether a real file occupies a synthetic path.
    const taken = new Set(paths.map((path) => resolve(cwd, path)));

    for (const entry of await resolveLinearSource(linearSource)) {
      if (isExcluded(entry.path, excludeMatchers)) continue;
      // `linear/issues/` is a reserved namespace once a bundle pulls issues:
      // a real file there would put two entries in the index under one name,
      // and an `!` exclusion can't drop one without dropping both.
      if (taken.has(resolve(cwd, entry.path))) {
        throw new ConfigError(
          `Linear issue collides with the file "${entry.path}". ` +
            "Rename the file, or narrow the include patterns so it isn't matched.",
        );
      }
      entries.push(entry);
    }
  }

  return entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/**
 * Count lines in a string (handles empty strings correctly)
 */
function countLines(content: string): number {
  if (content === "") return 0;
  // Count newlines and add 1 for the last line (if not ending with newline)
  const newlines = (content.match(/\n/g) || []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * Format the index header block.
 * Format designed for LLM context files (ChatGPT, Grok, Gemini):
 * - Numbered entries for cross-reference with file separators
 * - ASCII-only characters for broad compatibility
 * - Line locations that point to actual file content
 */
export function formatIndex(index: IndexEntry[]): string {
  if (index.length === 0) return "# Index\n# (empty)";

  const count = index.length;
  const lines = [`# Index (${count} file${count === 1 ? "" : "s"})`];
  for (let i = 0; i < index.length; i++) {
    const entry = index[i]!;
    const num = `[${i + 1}]`.padEnd(5);
    const lineWord = entry.lines === 1 ? "line" : "lines";
    lines.push(
      `# ${num} ${entry.path}  L${entry.startLine}-L${entry.endLine} (${entry.lines} ${lineWord})`,
    );
  }
  return lines.join("\n");
}

export interface BundleOptions {
  includeIndex?: boolean; // Default: true
  prompt?: string; // Text to prepend to bundle
}

/**
 * Format a file separator line with index number for cross-reference.
 * Uses `==>` / `<==` pattern (from Unix head/tail) which is unlikely
 * to appear naturally in bundled files.
 */
function formatSeparator(index: number, filePath: string): string {
  return `#==> [${index}] ${filePath} <==`;
}

/**
 * Create a bundle from a list of entries.
 * Line numbers in the index point to the first line of actual file content,
 * not to the separator line.
 */
export async function createBundle(
  entries: Entry[],
  cwd: string,
  options: BundleOptions = {},
): Promise<BundleResult> {
  const { includeIndex = true } = options;
  // Normalize prompt: trim and treat whitespace-only as no prompt
  const prompt = options.prompt?.trim() || undefined;
  const index: IndexEntry[] = [];
  const contentParts: string[] = [];
  let currentLine = 1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const filePath = entry.path;
    // Virtual entries carry their content; files are read from disk
    const content =
      entry.content ?? (await readFile(resolve(cwd, filePath), "utf-8"));
    const lines = countLines(content);

    // Separator takes 1 line, then content starts on next line
    const contentStartLine = currentLine + 1;

    const indexEntry: IndexEntry = {
      path: filePath,
      lines,
      startLine: contentStartLine,
      endLine: contentStartLine + Math.max(0, lines - 1),
    };
    index.push(indexEntry);

    contentParts.push(formatSeparator(i + 1, filePath));
    contentParts.push(content.endsWith("\n") ? content.slice(0, -1) : content);

    // Next separator line = after content
    currentLine = indexEntry.endLine + 1;
  }

  // Calculate prompt offset (prompt text + blank + "---" + blank)
  const promptLines = prompt ? countLines(prompt) + 3 : 0;

  if (includeIndex) {
    // Adjust line numbers to account for index header
    // Header: "# Index (N files)" + N index lines + 1 blank line
    const headerLines = index.length + 2 + promptLines;
    for (const entry of index) {
      entry.startLine += headerLines;
      entry.endLine += headerLines;
    }

    const indexBlock = formatIndex(index);
    const bundleContent =
      index.length === 0
        ? indexBlock
        : indexBlock + "\n\n" + contentParts.join("\n");

    const content = prompt
      ? `${prompt}\n\n---\n\n${bundleContent}`
      : bundleContent;
    return { content, index };
  }

  // No index: just join file content
  const bundleContent = contentParts.join("\n");
  const content = prompt
    ? `${prompt}\n\n---\n\n${bundleContent}`
    : bundleContent;

  // Adjust line numbers for prompt offset (no index case)
  if (promptLines > 0) {
    for (const entry of index) {
      entry.startLine += promptLines;
      entry.endLine += promptLines;
    }
  }

  return { content, index };
}

/**
 * Extract the index option from bundle config (default: true)
 */
function getIncludeIndex(config: BundleConfigInput): boolean {
  if (typeof config === "object" && !Array.isArray(config)) {
    return config.index ?? true;
  }
  return true;
}

/**
 * Extract the prompt option from bundle config.
 * Returns undefined for empty/null/undefined values.
 */
function getPrompt(config: BundleConfigInput): string | undefined {
  if (typeof config === "object" && !Array.isArray(config)) {
    const prompt = config.prompt;
    // Treat empty string, null, undefined as no prompt
    return prompt && prompt.trim() ? prompt : undefined;
  }
  return undefined;
}

/**
 * Resolve prompt value: load from file if path, otherwise return as-is.
 * Paths starting with ./, ../, or ~/ are treated as file paths.
 */
async function resolvePrompt(
  prompt: string | undefined,
  cwd: string,
): Promise<string | undefined> {
  if (!prompt) return undefined;

  // Check if prompt looks like a file path
  if (prompt.startsWith("./") || prompt.startsWith("../")) {
    const filePath = join(cwd, prompt);
    const content = await readFile(filePath, "utf-8");
    return content.trim() || undefined;
  }

  if (prompt.startsWith("~/")) {
    const filePath = expandPath(prompt);
    const content = await readFile(filePath, "utf-8");
    return content.trim() || undefined;
  }

  // Trim inline prompts for consistent behavior with file-based prompts
  return prompt.trim() || undefined;
}

/**
 * Bundle one config entry. `outputs` lists absolute paths srcpack writes,
 * which are never bundled — see {@link resolvePatterns}.
 */
export async function bundleOne(
  config: BundleConfigInput,
  cwd: string,
  outputs: string[] = [],
): Promise<BundleResult> {
  const entries = await resolveEntries(config, cwd, outputs);
  const includeIndex = getIncludeIndex(config);
  const prompt = await resolvePrompt(getPrompt(config), cwd);
  return createBundle(entries, cwd, { includeIndex, prompt });
}
