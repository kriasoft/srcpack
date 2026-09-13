import { describe, expect, test } from "bun:test";
import { parseCliArgs, UsageError } from "../../src/args.ts";

describe("parseCliArgs", () => {
  test("should default to a full run that uploads", () => {
    expect(parseCliArgs([])).toEqual({
      bundles: [],
      adHoc: null,
      dryRun: false,
      emptyOutDir: undefined,
      upload: true,
    });
  });

  test("should read bundle names and flags in any order", () => {
    expect(
      parseCliArgs(["web", "--dry-run", "api", "--no-upload", "--emptyOutDir"]),
    ).toEqual({
      bundles: ["web", "api"],
      adHoc: null,
      dryRun: true,
      emptyOutDir: true,
      upload: false,
    });
    expect(parseCliArgs(["--no-emptyOutDir"]).emptyOutDir).toBe(false);
  });

  test("should keep the value of --since out of the bundle names", () => {
    // `init` here is a branch, not a bundle or the wizard
    expect(parseCliArgs(["--since", "init"])).toMatchObject({
      bundles: [],
      adHoc: { name: "since", patterns: ["git:init", "git:untracked"] },
    });
    expect(parseCliArgs(["--since=main"]).adHoc?.patterns[0]).toBe("git:main");
  });

  // Each of these reads as a real option and would otherwise do the opposite
  // of what was typed, or nothing at all
  test.each([
    ["--upload"],
    ["--no-dry-run"],
    ["--no-staged"],
    ["--no-uplaod"],
    // A terminator parseArgs would accept, turning `srcpack --` into a full run
    ["--"],
  ])("should reject %p as an unknown option", (flag) => {
    expect(() => parseCliArgs([flag])).toThrow(
      `Unknown option: ${flag}\nRun \`srcpack --help\``,
    );
  });

  test.each([[["--since"]], [["--since", "-x"]], [["--since="]]])(
    "should require a revision for %p",
    (argv) => {
      expect(() => parseCliArgs(argv)).toThrow("Missing revision");
    },
  );

  test("should reject a boolean flag given a value", () => {
    expect(() => parseCliArgs(["--dry-run=1"])).toThrow(UsageError);
  });

  test("should reject contradictory and exclusive combinations", () => {
    expect(() => parseCliArgs(["--emptyOutDir", "--no-emptyOutDir"])).toThrow(
      "Cannot combine --emptyOutDir with --no-emptyOutDir.",
    );
    expect(() => parseCliArgs(["--staged", "--since", "main"])).toThrow(
      "Cannot combine --staged and --since.",
    );
    expect(() => parseCliArgs(["web", "--dirty"])).toThrow(
      "Cannot combine --dirty with named bundles.",
    );
    expect(() => parseCliArgs(["--since", "main..HEAD"])).toThrow(
      "not a range",
    );
    // Last-one-wins would bundle a different change set than the one asked for
    expect(() => parseCliArgs(["--since", "main", "--since", "HEAD"])).toThrow(
      '--since takes one revision; got "main" and "HEAD".',
    );
  });
});
