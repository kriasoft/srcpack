import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  bundleOne,
  createBundle,
  formatIndex,
  resolvePatterns,
  type FileEntry,
} from "../../src/bundle.ts";

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
});

describe("formatIndex", () => {
  test("should format empty index", () => {
    const result = formatIndex([]);

    expect(result).toBe("# Index\n# (empty)");
  });

  test("should format single entry", () => {
    const index: FileEntry[] = [
      { path: "src/index.ts", lines: 25, startLine: 1, endLine: 25 },
    ];
    const result = formatIndex(index);

    expect(result).toBe(
      "# Index (1 file)\n# [1]   src/index.ts  L1-L25 (25 lines)",
    );
  });

  test("should format multiple entries", () => {
    const index: FileEntry[] = [
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
    const result = await createBundle(["src/index.ts"], fixturesDir);

    expect(result.content).toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
    expect(result.content).toContain(
      'export const greeting = "Hello, srcpack!"',
    );
  });

  test("should compute correct line counts", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir);

    expect(result.index).toHaveLength(1);
    expect(result.index[0]!.path).toBe("src/index.ts");
    expect(result.index[0]!.lines).toBe(1);
  });

  test("should handle multiple files with correct line ranges", async () => {
    const result = await createBundle(
      ["src/index.ts", "src/utils/helpers.ts"],
      fixturesDir,
    );

    expect(result.index).toHaveLength(2);

    const [first, second] = result.index;
    // Index header: "# Index (2 files)" + 2 entries + blank line = 4 lines
    // First file separator is line 5, content starts at line 6
    expect(first!.startLine).toBe(6);
    expect(second!.startLine).toBeGreaterThan(first!.endLine);
  });

  test("should handle empty file list", async () => {
    const result = await createBundle([], fixturesDir);

    expect(result.index).toHaveLength(0);
    expect(result.content).toBe("# Index\n# (empty)");
  });

  test("should preserve file content exactly", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir);
    const content = await Bun.file(join(fixturesDir, "src/index.ts")).text();

    // Bundle should contain the file content (without trailing newline)
    expect(result.content).toContain(content.trimEnd());
  });

  test("should handle files with multiple lines", async () => {
    const result = await createBundle(["src/utils/helpers.ts"], fixturesDir);

    expect(result.index[0]!.lines).toBeGreaterThan(1);
    expect(result.index[0]!.endLine).toBeGreaterThan(
      result.index[0]!.startLine,
    );
  });

  test("should omit index header when includeIndex is false", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir, {
      includeIndex: false,
    });

    expect(result.content).not.toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
    expect(result.content).toContain(
      'export const greeting = "Hello, srcpack!"',
    );
  });

  test("should not adjust line numbers when index is omitted", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir, {
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
      ["src/index.ts", "src/utils/helpers.ts"],
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
    const result = await createBundle(["src/index.ts"], fixturesDir, {
      prompt: "Review this code for security issues.",
    });

    expect(result.content).toStartWith("Review this code for security issues.");
    expect(result.content).toContain("\n\n---\n\n");
    expect(result.content).toContain("# Index");
  });

  test("should adjust line numbers for prompt offset", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir, {
      prompt: "Review this code.",
    });

    // Prompt: 1 line + blank + "---" + blank = 4 lines
    // Index: header + 1 entry + blank = 3 lines
    // Separator: 1 line, content starts next line
    // Content at: 4 + 3 + 1 + 1 = 9
    expect(result.index[0]!.startLine).toBe(9);
  });

  test("should handle multi-line prompt", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir, {
      prompt: "Review this code.\nFocus on:\n- Security\n- Performance",
    });

    expect(result.content).toStartWith("Review this code.");
    // Prompt: 4 lines + blank + "---" + blank = 7 lines
    // Index: 3 lines, separator: 1 line, content next line
    // Content at: 7 + 3 + 1 + 1 = 12
    expect(result.index[0]!.startLine).toBe(12);
  });

  test("should prepend prompt without index", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir, {
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
    const result = await createBundle(["src/index.ts"], fixturesDir, {
      prompt: "",
    });

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });

  test("should ignore whitespace-only prompt", async () => {
    const result = await createBundle(["src/index.ts"], fixturesDir, {
      prompt: "   \n  \n  ",
    });

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });
});

describe("bundleOne", () => {
  test("should include index by default", async () => {
    const result = await bundleOne("web", "src/index.ts", fixturesDir);

    expect(result.content).toContain("# Index");
  });

  test("should include index when explicitly enabled", async () => {
    const result = await bundleOne(
      "web",
      { include: "src/index.ts", index: true },
      fixturesDir,
    );

    expect(result.content).toContain("# Index");
  });

  test("should omit index when disabled in config", async () => {
    const result = await bundleOne(
      "web",
      { include: "src/index.ts", index: false },
      fixturesDir,
    );

    expect(result.content).not.toContain("# Index");
    expect(result.content).toContain("#==> [1] src/index.ts <==");
  });

  test("should include index for string pattern config", async () => {
    const result = await bundleOne("web", "src/index.ts", fixturesDir);

    expect(result.content).toContain("# Index");
  });

  test("should include index for array pattern config", async () => {
    const result = await bundleOne(
      "web",
      ["src/index.ts", "!src/utils/**"],
      fixturesDir,
    );

    expect(result.content).toContain("# Index");
  });

  test("should prepend prompt from config", async () => {
    const result = await bundleOne(
      "web",
      { include: "src/index.ts", prompt: "Review this code." },
      fixturesDir,
    );

    expect(result.content).toStartWith("Review this code.");
    expect(result.content).toContain("\n\n---\n\n");
    expect(result.content).toContain("# Index");
  });

  test("should ignore empty prompt in config", async () => {
    const result = await bundleOne(
      "web",
      { include: "src/index.ts", prompt: "" },
      fixturesDir,
    );

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });

  test("should ignore undefined prompt in config", async () => {
    const result = await bundleOne(
      "web",
      { include: "src/index.ts", prompt: undefined },
      fixturesDir,
    );

    expect(result.content).toStartWith("# Index");
    expect(result.content).not.toContain("---");
  });

  test("should load prompt from file when path starts with ./", async () => {
    const result = await bundleOne(
      "web",
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
        "web",
        { include: "src/index.ts", prompt: "~/non-existent-srcpack-test.md" },
        fixturesDir,
      ),
    ).rejects.toThrow("ENOENT");
  });

  test("should use literal prompt when not a path", async () => {
    const result = await bundleOne(
      "web",
      { include: "src/index.ts", prompt: "Check for bugs." },
      fixturesDir,
    );

    expect(result.content).toStartWith("Check for bugs.");
    expect(result.content).not.toContain("./");
  });
});
