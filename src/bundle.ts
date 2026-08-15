// SPDX-License-Identifier: MIT

import { lstat, open, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { glob } from "fast-glob";
import picomatch from "picomatch";
import ignore, { type Ignore } from "ignore";
import { ConfigError, expandPath, type BundleConfigInput } from "./config.ts";
import { isGitSource, resolveGitSource } from "./git.ts";

// Binary file detection: check first 8KB for null bytes (same heuristic as git)
const BINARY_CHECK_SIZE = 8192;

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

export interface FileEntry {
  path: string; // Relative path from cwd
  lines: number; // Line count in source file
  startLine: number; // Start line in bundle (1-indexed)
  endLine: number; // End line in bundle
}

export interface BundleResult {
  content: string;
  index: FileEntry[];
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

    // Skip patterns with special gitignore features we can't safely convert:
    // - Root-anchored (starts with /)
    // - Contains globs (*, ?, [)
    // - Contains path separators (complex paths)
    // - Escaped characters
    if (
      trimmed.startsWith("/") ||
      trimmed.includes("*") ||
      trimmed.includes("?") ||
      trimmed.includes("[") ||
      trimmed.includes("/") ||
      trimmed.includes("\\")
    ) {
      continue;
    }

    // Only convert simple directory names (e.g., "node_modules", "dist")
    // These are safe to prune at any depth
    const name = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
    if (name && /^[\w.-]+$/.test(name)) {
      patterns.push(`**/${name}/**`);
    }
  }

  return patterns;
}

interface GitignoreResult {
  ignore: Ignore;
  globPatterns: string[];
}

/**
 * Load and parse .gitignore file from a directory.
 * Returns both an Ignore instance for filtering and glob patterns for fast-glob.
 */
async function loadGitignore(cwd: string): Promise<GitignoreResult> {
  const ig = ignore();
  const gitignorePath = join(cwd, ".gitignore");
  let globPatterns: string[] = [];

  try {
    const content = await readFile(gitignorePath, "utf-8");
    ig.add(content);
    globPatterns = gitignoreToGlobPatterns(content.split("\n"));
  } catch {
    // No .gitignore file, return empty ignore instance
  }

  return { ignore: ig, globPatterns };
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
 * Whether a path is one srcpack writes. `outputs` holds absolute paths of
 * files or directories; a directory covers everything beneath it.
 */
function isOwnOutput(filePath: string, outputs: string[]): boolean {
  return outputs.some(
    (out) => filePath === out || filePath.startsWith(out + sep),
  );
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
    const { ignore: gitignore, globPatterns } = await loadGitignore(cwd);
    const matches = await glob(internalPatterns, {
      cwd,
      onlyFiles: true,
      dot: true,
      ignore: globPatterns,
    });
    await add(matches.filter((m) => !gitignore.ignores(m)));
  }

  // External patterns: skip .gitignore (it doesn't apply outside cwd)
  const externalPatterns = globs.filter(isExternalPattern);
  if (externalPatterns.length > 0) {
    await add(
      await glob(externalPatterns, { cwd, onlyFiles: true, dot: true }),
    );
  }

  // Force includes: bypass .gitignore (no ignore patterns passed to glob)
  if (force.length > 0) {
    await add(await glob(force, { cwd, onlyFiles: true, dot: true }));
  }

  // Sort for deterministic output
  return [...files].sort();
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
export function formatIndex(index: FileEntry[]): string {
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
 * Create a bundle from a list of files.
 * Line numbers in the index point to the first line of actual file content,
 * not to the separator line.
 */
export async function createBundle(
  files: string[],
  cwd: string,
  options: BundleOptions = {},
): Promise<BundleResult> {
  const { includeIndex = true } = options;
  // Normalize prompt: trim and treat whitespace-only as no prompt
  const prompt = options.prompt?.trim() || undefined;
  const index: FileEntry[] = [];
  const contentParts: string[] = [];
  let currentLine = 1;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const content = await readFile(resolve(cwd, filePath), "utf-8");
    const lines = countLines(content);

    // Separator takes 1 line, then content starts on next line
    const contentStartLine = currentLine + 1;

    const entry: FileEntry = {
      path: filePath,
      lines,
      startLine: contentStartLine,
      endLine: contentStartLine + Math.max(0, lines - 1),
    };
    index.push(entry);

    contentParts.push(formatSeparator(i + 1, filePath));
    contentParts.push(content.endsWith("\n") ? content.slice(0, -1) : content);

    // Next separator line = after content
    currentLine = entry.endLine + 1;
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
  const files = await resolvePatterns(config, cwd, outputs);
  const includeIndex = getIncludeIndex(config);
  const prompt = await resolvePrompt(getPrompt(config), cwd);
  return createBundle(files, cwd, { includeIndex, prompt });
}
