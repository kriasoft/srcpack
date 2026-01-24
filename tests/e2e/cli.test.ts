import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test, afterEach } from "bun:test";

const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");
const FIXTURE_PATH = join(import.meta.dir, "../fixtures/sample-project");

async function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
  };
}

describe("cli", () => {
  describe("help flag", () => {
    test.each([["--help"], ["-h"]])(
      "should display usage information and exit 0 when %p is passed",
      async (flag) => {
        const result = await runCli([flag]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("srcpack");
        expect(result.stdout).toContain("Usage:");
        expect(result.stdout).toContain("--dry-run");
        expect(result.stdout).toContain("init");
      },
    );
  });

  describe("init subcommand", () => {
    test("should exit gracefully in non-TTY mode", async () => {
      const result = await runCli(["init"]);

      // In non-TTY mode, @clack/prompts auto-cancels prompts
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Create srcpack.config.ts");
    });
  });

  describe("without config file", () => {
    test("should print error and exit 1 when no config found", async () => {
      const result = await runCli([], { cwd: "/tmp" });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No configuration found");
      expect(result.stderr).toContain("init");
    });
  });

  describe("with config file", () => {
    test("should process bundles and exit 0", async () => {
      const result = await runCli([], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("web");
      expect(result.stdout).toContain("files");
      expect(result.stdout).toContain("Bundled:");
    });

    test("should show file list in dry-run mode", async () => {
      const result = await runCli(["--dry-run"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("lines");
      expect(result.stdout).toContain("Dry run:");
      expect(result.stdout).not.toContain("→");
    });

    test("should parse positional bundle names", async () => {
      const result = await runCli(["web", "api"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("web");
      expect(result.stdout).toContain("api");
    });

    test("should only process specified bundles", async () => {
      const result = await runCli(["--dry-run", "web"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("web");
      expect(result.stdout).toContain("1 bundle");
      expect(result.stdout).not.toContain("2 bundles");
    });

    test("should process all bundles when none specified", async () => {
      const result = await runCli([], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("web");
      expect(result.stdout).toContain("api");
      expect(result.stdout).toContain("2 bundles");
    });

    test("should reject unknown bundle names", async () => {
      const result = await runCli(["unknown"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown bundle: unknown");
    });
  });

  describe("absolute outDir with custom root", () => {
    const tempRoot = join(tmpdir(), `srcpack-test-${Date.now()}`);
    const tempOutDir = join(tmpdir(), `srcpack-out-${Date.now()}`);

    afterEach(async () => {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempOutDir, { recursive: true, force: true });
    });

    test("should write to absolute outDir when root is also specified", async () => {
      // Setup: create temp project with config using absolute outDir
      await mkdir(join(tempRoot, "src"), { recursive: true });
      await writeFile(join(tempRoot, "src/index.ts"), "export const x = 1;");
      await writeFile(
        join(tempRoot, "srcpack.config.ts"),
        `export default {
          outDir: ${JSON.stringify(tempOutDir)},
          bundles: { app: "src/**/*" },
        };`,
      );

      const result = await runCli([], { cwd: tempRoot });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("app");

      // Verify file was written to absolute outDir, not joined with root
      const outFile = Bun.file(join(tempOutDir, "app.txt"));
      expect(await outFile.exists()).toBe(true);
    });
  });
});
