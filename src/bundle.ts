// SPDX-License-Identifier: MIT

import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "fast-glob";
import picomatch from "picomatch";
import ignore, { type Ignore } from "ignore";
import type { BundleConfigInput } from "./config.ts";

// Binary file detection: check first 8KB for null bytes (same heuristic as git)
const BINARY_CHECK_SIZE = 8192;

async function isBinary(filePath: string): Promise<boolean> {
  const stats = await stat(filePath);
  if (stats.size === 0) return false;

  const fd = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(stats.size, BINARY_CHECK_SIZE));
    await fd.read(buffer, 0, buffer.length, 0);
    return buffer.includes(0);
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
 */
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
      exclude.push(p.slice(1));
    } else if (p.startsWith("+")) {
      force.push(p.slice(1));
    } else {
      include.push(p);
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
 * Load and parse .gitignore file from a directory
 */
async function loadGitignore(cwd: string): Promise<Ignore> {
  const ig = ignore();
  const gitignorePath = join(cwd, ".gitignore");

  try {
    const content = await readFile(gitignorePath, "utf-8");
    ig.add(content);
  } catch {
    // No .gitignore file, return empty ignore instance
  }

  return ig;
}

/**
 * Resolve bundle config to a list of file paths.
 * - Regular patterns respect .gitignore
 * - Force patterns (+prefix) bypass .gitignore
 * - Exclude patterns (!prefix) filter both
 */
export async function resolvePatterns(
  config: BundleConfigInput,
  cwd: string,
): Promise<string[]> {
  const { include, exclude, force } = normalizePatterns(config);
  const excludeMatchers = exclude.map((p) => picomatch(p));
  const gitignore = await loadGitignore(cwd);
  const files = new Set<string>();

  // Regular includes: respect .gitignore
  if (include.length > 0) {
    const matches = await glob(include, { cwd, onlyFiles: true, dot: true });
    for (const match of matches) {
      if (!isExcluded(match, excludeMatchers) && !gitignore.ignores(match)) {
        const fullPath = join(cwd, match);
        if (!(await isBinary(fullPath))) {
          files.add(match);
        }
      }
    }
  }

  // Force includes: bypass .gitignore
  if (force.length > 0) {
    const matches = await glob(force, { cwd, onlyFiles: true, dot: true });
    for (const match of matches) {
      if (!isExcluded(match, excludeMatchers)) {
        const fullPath = join(cwd, match);
        if (!(await isBinary(fullPath))) {
          files.add(match);
        }
      }
    }
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
  const index: FileEntry[] = [];
  const contentParts: string[] = [];
  let currentLine = 1;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const fullPath = join(cwd, filePath);
    const content = await readFile(fullPath, "utf-8");
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

  if (includeIndex) {
    // Adjust line numbers to account for index header
    // Header: "# Index (N files)" + N index lines + 1 blank line
    const headerLines = index.length + 2;
    for (const entry of index) {
      entry.startLine += headerLines;
      entry.endLine += headerLines;
    }

    const indexBlock = formatIndex(index);
    const content =
      index.length === 0
        ? indexBlock
        : indexBlock + "\n\n" + contentParts.join("\n");

    return { content, index };
  }

  // No index: just join file content
  const content = contentParts.join("\n");
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
 * Bundle a single named bundle from config
 */
export async function bundleOne(
  name: string,
  config: BundleConfigInput,
  cwd: string,
): Promise<BundleResult> {
  const files = await resolvePatterns(config, cwd);
  const includeIndex = getIncludeIndex(config);
  return createBundle(files, cwd, { includeIndex });
}
