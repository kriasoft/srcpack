import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundleOne,
  createBundle,
  formatIndex,
  resolvePatterns,
  type Entry,
  type IndexEntry,
} from "../../src/bundle.ts";

/** createBundle takes entries; these tests only exercise on-disk files. */
const entries = (...paths: string[]): Entry[] =>
  paths.map((path) => ({ path }));

const fixturesDir = join(import.meta.dir, "../fixtures/sample-project");
const gitignoreFixturesDir = join(
  import.meta.dir,
  "../fixtures/gitignore-project",
);
const binaryFixturesDir = join(import.meta.dir, "../fixtures/binary-project");
const forceIncludeDir = join(
  import.meta.dir,
  "../fixtures/force-include-project",
);
const negationDir = join(import.meta.dir, "../fixtures/negation-project");

describe("resolvePatterns", () => {
  test("should resolve string pattern", async () => {
    const files = await resolvePatterns("src/**/*.ts", fixturesDir);

    expect(files).toContain("src/index.ts");
  });

  test("should resolve array of patterns", async () => {
    const files = await resolvePatterns(
      ["src/**/*.ts", "src/**/*.js"],
      fixturesDir,
    );

    expect(files).toContain("src/index.ts");
  });

  test("should exclude patterns starting with !", async () => {
    const files = await resolvePatterns(
      ["src/**/*", "!src/utils/**/*"],
      fixturesDir,
    );

    expect(files).toContain("src/index.ts");
    expect(files.some((f) => f.startsWith("src/utils/"))).toBe(false);
  });

  test("should handle object config with include", async () => {
    const files = await resolvePatterns(
      { include: "src/**/*.ts" },
      fixturesDir,
    );

    expect(files).toContain("src/index.ts");
  });

  test("should handle object config with array include", async () => {
    const files = await resolvePatterns(
      { include: ["src/**/*.ts"] },
      fixturesDir,
    );

    expect(files).toContain("src/index.ts");
  });

  test("should return sorted results", async () => {
    const files = await resolvePatterns("src/**/*", fixturesDir);
    const sorted = [...files].sort();

    expect(files).toEqual(sorted);
  });

  test("should return empty array for no matches", async () => {
    const files = await resolvePatterns("nonexistent/**/*", fixturesDir);

    expect(files).toEqual([]);
  });

  test("should respect .gitignore patterns", async () => {
    const files = await resolvePatterns("**/*", gitignoreFixturesDir);

    // Should include src files
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/utils.ts");

    // Should exclude gitignored patterns
    expect(files).not.toContain("dist/bundle.js");
    expect(files).not.toContain("node_modules/pkg/index.js");
    expect(files).not.toContain("debug.log");
  });

  test("should exclude files matching .gitignore directory patterns", async () => {
    const files = await resolvePatterns("**/*.js", gitignoreFixturesDir);

    // dist/ and node_modules/ are gitignored
    expect(files).toEqual([]);
  });

  test("should exclude files matching .gitignore glob patterns", async () => {
    const files = await resolvePatterns("**/*.log", gitignoreFixturesDir);

    // *.log is gitignored
    expect(files).toEqual([]);
  });

  test("should work when no .gitignore exists", async () => {
    // sample-project has no .gitignore
    const files = await resolvePatterns("src/**/*.ts", fixturesDir);

    expect(files).toContain("src/index.ts");
  });

  test("should exclude binary files", async () => {
    const files = await resolvePatterns("src/**/*", binaryFixturesDir);

    expect(files).toContain("src/index.ts");
    expect(files).not.toContain("src/binary.bin");
    expect(files).not.toContain("src/image.png");
  });

  test("should force-include gitignored files with + prefix", async () => {
    const files = await resolvePatterns(
      ["docs/**/*", "+docs/**/*.local.md"],
      forceIncludeDir,
    );

    // Regular file included
    expect(files).toContain("docs/guide.md");
    // Gitignored files force-included
    expect(files).toContain("docs/notes.local.md");
    expect(files).toContain("docs/private.local.md");
  });

  test("should exclude gitignored files without + prefix", async () => {
    const files = await resolvePatterns("docs/**/*", forceIncludeDir);

    expect(files).toContain("docs/guide.md");
    expect(files).not.toContain("docs/notes.local.md");
    expect(files).not.toContain("docs/private.local.md");
  });

  test("should apply ! exclusions to force-included files", async () => {
    const files = await resolvePatterns(
      ["+docs/**/*.local.md", "!docs/private.local.md"],
      forceIncludeDir,
    );

    expect(files).toContain("docs/notes.local.md");
    expect(files).not.toContain("docs/private.local.md");
  });

  test("should work with only force-include patterns", async () => {
    const files = await resolvePatterns("+docs/**/*.local.md", forceIncludeDir);

    expect(files).toContain("docs/notes.local.md");
    expect(files).toContain("docs/private.local.md");
    expect(files).not.toContain("docs/guide.md");
  });

  test("should respect gitignore negation patterns", async () => {
    // .gitignore contains: build/** + !build/keep.txt
    // The negation re-includes build/keep.txt while other build files stay ignored
    const files = await resolvePatterns("**/*", negationDir);

    expect(files).toContain("src/index.ts");
    expect(files).toContain("build/keep.txt"); // Re-included by negation
    expect(files).not.toContain("build/bundle.js"); // Still ignored
  });

  test("should handle patterns pointing outside cwd", async () => {
    // Use sample-project as cwd and resolve pattern pointing to gitignore-project
    // External patterns skip .gitignore entirely (it doesn't apply to external files)
    const files = await resolvePatterns(
      "../gitignore-project/src/**/*.ts",
      fixturesDir,
    );

    // Should include files from the external directory
    expect(files).toContain("../gitignore-project/src/index.ts");
    expect(files).toContain("../gitignore-project/src/utils.ts");
  });

  test("should not apply cwd gitignore to external patterns", async () => {
    // fixturesDir is sample-project; external pattern points to gitignore-project
    // Even though "dist" is a common gitignore pattern, external paths skip .gitignore
    const files = await resolvePatterns(
      "../gitignore-project/dist/**/*.js",
      fixturesDir,
    );

    expect(files).toContain("../gitignore-project/dist/bundle.js");
  });

  test("should handle ./../ prefix as external pattern", async () => {
    // Redundant ./ prefix should still be recognized as external
    const files = await resolvePatterns(
      "./../gitignore-project/src/**/*.ts",
      fixturesDir,
    );

    expect(files).toContain("./../gitignore-project/src/index.ts");
  });

  test("should resolve absolute patterns", async () => {
    // fast-glob returns absolute paths for absolute patterns, so they must not
    // be joined onto cwd
    const files = await resolvePatterns(
      join(gitignoreFixturesDir, "src/**/*.ts"),
      fixturesDir,
    );

    expect(files).toContain(join(gitignoreFixturesDir, "src/index.ts"));
  });

  test("should bundle content from an absolute pattern", async () => {
    const files = await resolvePatterns(
      join(gitignoreFixturesDir, "src/index.ts"),
      fixturesDir,
    );
    const result = await createBundle(entries(...files), fixturesDir);

    expect(result.index).toHaveLength(1);
    expect(result.index[0]!.lines).toBeGreaterThan(0);
  });

  test("should bundle a file once when named both ways", async () => {
    const files = await resolvePatterns(
      ["src/index.ts", join(fixturesDir, "src/index.ts")],
      fixturesDir,
    );

    expect(files).toEqual(["src/index.ts"]);
  });

  test("should skip files under an output directory", async () => {
    const files = await resolvePatterns("src/**/*", fixturesDir, [
      join(fixturesDir, "src/utils"),
    ]);

    expect(files).toContain("src/index.ts");
    expect(files.some((f) => f.startsWith("src/utils/"))).toBe(false);
  });

  test("should skip an output file without skipping its siblings", async () => {
    const files = await resolvePatterns("src/**/*", fixturesDir, [
      join(fixturesDir, "src/index.ts"),
    ]);

    expect(files).not.toContain("src/index.ts");
    expect(files.length).toBeGreaterThan(0);
  });

  test("should not skip paths that merely share a prefix with an output", async () => {
    // "src/util" is a prefix of "src/utils" but not a parent of it
    const files = await resolvePatterns("src/**/*", fixturesDir, [
      join(fixturesDir, "src/util"),
    ]);

    expect(files).toContain("src/utils/helpers.ts");
  });
});

/**
 * The two boundaries a bundle must not cross: what .gitignore hides, and the
 * project itself. Both are documented guarantees, so both are tested against a
 * layout built here rather than a fixture — a symlink pointing out of the repo
 * doesn't survive packaging.
 */
describe("resolvePatterns boundaries", () => {
  let project: string;
  let outside: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "srcpack-project-"));
    outside = await mkdtemp(join(tmpdir(), "srcpack-outside-"));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test("should apply a nested .gitignore the way git does", async () => {
    await mkdir(join(project, "packages/app"), { recursive: true });
    await writeFile(join(project, ".gitignore"), "node_modules/\n");
    await writeFile(
      join(project, "packages/app/.gitignore"),
      ".env\n!keep.env\n",
    );
    await writeFile(
      join(project, "packages/app/.env"),
      "DB_PASSWORD=hunter2\n",
    );
    await writeFile(join(project, "packages/app/keep.env"), "PUBLIC=1\n");
    await writeFile(join(project, "packages/app/index.ts"), "export {};\n");

    const files = await resolvePatterns("**/*", project);

    // Reading only the root .gitignore bundles every secret a monorepo hides
    // one directory down — the case that motivates layered resolution
    expect(files).not.toContain("packages/app/.env");
    // A negation in the same file re-includes, as it does for git
    expect(files).toContain("packages/app/keep.env");
    expect(files).toContain("packages/app/index.ts");
  });

  test("should not re-include what an ignored parent directory hides", async () => {
    await mkdir(join(project, "hidden"), { recursive: true });
    await writeFile(join(project, ".gitignore"), "hidden/\n");
    await writeFile(join(project, "hidden/.gitignore"), "!secret.txt\n");
    await writeFile(join(project, "hidden/secret.txt"), "SECRET\n");

    const files = await resolvePatterns("**/*", project);

    // Git never descends into an ignored directory, so the negation can't apply
    expect(files).not.toContain("hidden/secret.txt");
  });

  test("should not walk into a symlinked directory", async () => {
    await mkdir(join(outside, "private"), { recursive: true });
    await writeFile(join(outside, "private/secret.txt"), "SECRET\n");
    await writeFile(join(project, "own.ts"), "export {};\n");
    await symlink(outside, join(project, "vendor"));

    const files = await resolvePatterns("**/*", project);

    // The leaf here is an ordinary file — the escape happened at `vendor`,
    // which is why checking only the final component cannot catch it
    expect(files).not.toContain("vendor/private/secret.txt");
    expect(files).toEqual(["own.ts"]);
  });
});

describe("formatIndex", () => {
  test("should format empty index", () => {
    const result = formatIndex([]);

    expect(result).toBe("# Index\n# (empty)");
  });

  test("should format single entry", () => {
    const index: IndexEntry[] = [
      { path: "src/index.ts", lines: 25, startLine: 1, endLine: 25 },
    ];
    const result = formatIndex(index);

    expect(result).toBe(
      "# Index (1 file)\n# [1]   src/index.ts  L1-L25 (25 lines)",
    );
  });

  test("should format multiple entries", () => {
    const index: IndexEntry[] = [
      { path: "src/index.ts", lines: 25, startLine: 1, endLine: 25 },
      { path: "src/utils.ts", lines: 100, startLine: 26, endLine: 125 },
    ];
    const result = formatIndex(index);

    expect(result).toContain("# Index (2 files)");
    expect(result).toContain("# [1]   src/index.ts  L1-L25 (25 lines)");
    expect(result).toContain("# [2]   src/utils.ts  L26-L125 (100 lines)");
  });
});

describe("createBundle", () => {
  test("should create bundle with correct content", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir);

    expect(result.content).toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
    expect(result.content).toContain(
      'export const greeting = "Hello, srcpack!"',
    );
  });

  test("should compute correct line counts", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir);

    expect(result.index).toHaveLength(1);
    expect(result.index[0]!.path).toBe("src/index.ts");
    expect(result.index[0]!.lines).toBe(1);
  });

  test("should handle multiple files with correct line ranges", async () => {
    const result = await createBundle(
      entries("src/index.ts", "src/utils/helpers.ts"),
      fixturesDir,
    );

    expect(result.index).toHaveLength(2);

    const [first, second] = result.index;
    // Index header: "# Index (2 files)" + 2 entries + blank line = 4 lines
    // First file separator is line 5, content starts at line 6
    expect(first!.startLine).toBe(6);
    expect(second!.startLine).toBeGreaterThan(first!.endLine);
  });

  test("should point the index at real content for virtual entries", async () => {
    const result = await createBundle(
      [
        { path: "src/index.ts" },
        { path: "linear/issues/ENG-1.md", content: "# ENG-1\n\nBody.\n" },
      ],
      fixturesDir,
    );

    // The whole point of the index is that a cited line range is readable
    const lines = result.content.split("\n");
    const issue = result.index[1]!;
    expect(lines.slice(issue.startLine - 1, issue.endLine)).toEqual([
      "# ENG-1",
      "",
      "Body.",
    ]);
    expect(lines[issue.startLine - 2]).toBe(
      "#==> [2] linear/issues/ENG-1.md <==",
    );
  });

  test("should handle empty file list", async () => {
    const result = await createBundle([], fixturesDir);

    expect(result.index).toHaveLength(0);
    expect(result.content).toBe("# Index\n# (empty)");
  });

  test("should preserve file content exactly", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir);
    const content = await Bun.file(join(fixturesDir, "src/index.ts")).text();

    // Bundle should contain the file content (without trailing newline)
    expect(result.content).toContain(content.trimEnd());
  });

  test("should handle files with multiple lines", async () => {
    const result = await createBundle(
      entries("src/utils/helpers.ts"),
      fixturesDir,
    );

    expect(result.index[0]!.lines).toBeGreaterThan(1);
    expect(result.index[0]!.endLine).toBeGreaterThan(
      result.index[0]!.startLine,
    );
  });

  test("should omit index header when includeIndex is false", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      includeIndex: false,
    });

    expect(result.content).not.toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
    expect(result.content).toContain(
      'export const greeting = "Hello, srcpack!"',
    );
  });

  test("should not adjust line numbers when index is omitted", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      includeIndex: false,
    });

    // Separator is line 1, content starts at line 2
    expect(result.index[0]!.startLine).toBe(2);
    expect(result.index[0]!.endLine).toBe(2);
  });

  test("should return empty string for empty file list without index", async () => {
    const result = await createBundle([], fixturesDir, { includeIndex: false });

    expect(result.content).toBe("");
    expect(result.index).toHaveLength(0);
  });

  test("should handle multiple files without index", async () => {
    const result = await createBundle(
      entries("src/index.ts", "src/utils/helpers.ts"),
      fixturesDir,
      { includeIndex: false },
    );

    expect(result.content).not.toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
    expect(result.content).toContain("#==> [2] src/utils/helpers.ts <==");
    // Separator is line 1, content starts at line 2
    expect(result.index[0]!.startLine).toBe(2);
  });

  test("should prepend prompt with separator", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      prompt: "Review this code for security issues.",
    });

    expect(result.content).toStartWith("Review this code for security issues.");
    expect(result.content).toContain("\n\n---\n\n");
    expect(result.content).toContain("# Index");
  });

  test("should adjust line numbers for prompt offset", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      prompt: "Review this code.",
    });

    // Prompt: 1 line + blank + "---" + blank = 4 lines
    // Index: header + 1 entry + blank = 3 lines
    // Separator: 1 line, content starts next line
    // Content at: 4 + 3 + 1 + 1 = 9
    expect(result.index[0]!.startLine).toBe(9);
  });

  test("should handle multi-line prompt", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      prompt: "Review this code.\nFocus on:\n- Security\n- Performance",
    });

    expect(result.content).toStartWith("Review this code.");
    // Prompt: 4 lines + blank + "---" + blank = 7 lines
    // Index: 3 lines, separator: 1 line, content next line
    // Content at: 7 + 3 + 1 + 1 = 12
    expect(result.index[0]!.startLine).toBe(12);
  });

  test("should prepend prompt without index", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      prompt: "Review this code.",
      includeIndex: false,
    });

    expect(result.content).toStartWith("Review this code.");
    expect(result.content).toContain("\n\n---\n\n");
    expect(result.content).not.toContain("# Index");
    // Prompt: 1 line + blank + "---" + blank = 4 lines
    // Separator: 1 line, content next line
    // Content at: 4 + 1 + 1 = 6
    expect(result.index[0]!.startLine).toBe(6);
  });

  test("should ignore empty prompt", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      prompt: "",
    });

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });

  test("should ignore whitespace-only prompt", async () => {
    const result = await createBundle(entries("src/index.ts"), fixturesDir, {
      prompt: "   \n  \n  ",
    });

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });
});

describe("bundleOne", () => {
  test("should include index by default", async () => {
    const result = await bundleOne("src/index.ts", fixturesDir);

    expect(result.content).toContain("# Index");
  });

  test("should include index when explicitly enabled", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", index: true },
      fixturesDir,
    );

    expect(result.content).toContain("# Index");
  });

  test("should omit index when disabled in config", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", index: false },
      fixturesDir,
    );

    expect(result.content).not.toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
  });

  test("should include index for string pattern config", async () => {
    const result = await bundleOne("src/index.ts", fixturesDir);

    expect(result.content).toContain("# Index");
  });

  test("should include index for array pattern config", async () => {
    const result = await bundleOne(
      ["src/index.ts", "!src/utils/**"],
      fixturesDir,
    );

    expect(result.content).toContain("# Index");
  });

  test("should prepend prompt from config", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", prompt: "Review this code." },
      fixturesDir,
    );

    expect(result.content).toStartWith("Review this code.");
    expect(result.content).toContain("\n\n---\n\n");
    expect(result.content).toContain("# Index");
  });

  test("should ignore empty prompt in config", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", prompt: "" },
      fixturesDir,
    );

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });

  test("should ignore undefined prompt in config", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", prompt: undefined },
      fixturesDir,
    );

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });

  test("should load prompt from file when path starts with ./", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", prompt: "./prompts/review.md" },
      fixturesDir,
    );

    expect(result.content).toStartWith("Review this code for:");
    expect(result.content).toContain("- Security issues");
    expect(result.content).toContain("\n\n---\n\n");
  });

  test("should attempt to load prompt from ~/ path", async () => {
    // Verify ~/ paths are treated as file paths (throws for non-existent file)
    await expect(
      bundleOne(
        { include: "src/index.ts", prompt: "~/non-existent-srcpack-test.md" },
        fixturesDir,
      ),
    ).rejects.toThrow("ENOENT");
  });

  test("should use literal prompt when not a path", async () => {
    const result = await bundleOne(
      { include: "src/index.ts", prompt: "Check for bugs." },
      fixturesDir,
    );

    expect(result.content).toStartWith("Check for bugs.");
    expect(result.content).not.toContain("./");
  });
});
