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

  describe("version flag", () => {
    test.each([["--version"], ["-v"]])(
      "should print the package version when %p is passed",
      async (flag) => {
        const pkg = await Bun.file(
          join(import.meta.dir, "../../package.json"),
        ).json();
        const result = await runCli([flag]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(pkg.version);
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

    test("should treat a subcommand name as a bundle when not first", async () => {
      // `--since init` must diff against the `init` branch, not run the wizard
      const result = await runCli(["--dry-run", "init"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown bundle: init");
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

  describe("own output", () => {
    const project = join(tmpdir(), `srcpack-own-${Date.now()}`);

    afterEach(async () => {
      await rm(project, { recursive: true, force: true });
    });

    test("should refuse to empty an outDir that holds the project root", async () => {
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(join(project, "keep.md"), "# keep\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { outDir: ".", bundles: { app: "src/**/*" } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("contains the project root");
      // The whole project would otherwise be deleted
      expect(await Bun.file(join(project, "keep.md")).exists()).toBe(true);
      expect(await Bun.file(join(project, "src/index.ts")).exists()).toBe(true);
    });

    test("should keep other bundles when building a named subset", async () => {
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: { web: "src/**/*", api: "src/**/*" } };`,
      );

      await runCli([], { cwd: project });
      // Emptying outDir would delete api.txt, which this run cannot rebuild
      await runCli(["web"], { cwd: project });

      expect(await Bun.file(join(project, ".srcpack/api.txt")).exists()).toBe(
        true,
      );
      expect(await Bun.file(join(project, ".srcpack/web.txt")).exists()).toBe(
        true,
      );
    });

    test("should not bundle a previous run's output", async () => {
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { emptyOutDir: false, bundles: { app: "**/*" } };`,
      );

      await runCli([], { cwd: project });
      const first = await Bun.file(join(project, ".srcpack/app.txt")).text();
      await runCli([], { cwd: project });
      const second = await Bun.file(join(project, ".srcpack/app.txt")).text();

      // Without the guard each run nests the previous bundle one level deeper
      expect(second).toBe(first);
      expect(second).not.toContain(".srcpack/app.txt");
    });
  });

  describe("ad-hoc git bundles", () => {
    const repo = join(tmpdir(), `srcpack-adhoc-${Date.now()}`);

    async function git(...args: string[]) {
      const proc = Bun.spawn(
        [
          "git",
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: repo, stdout: "pipe", stderr: "pipe" },
      );
      // Fail loudly: a silent setup failure would make the assertions lie
      if ((await proc.exited) !== 0) {
        throw new Error(
          `git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`,
        );
      }
    }

    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    test("should bundle staged files without a config file", async () => {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/index.ts"), "export const x = 1;\n");
      await writeFile(join(repo, "src/other.ts"), "export const y = 2;\n");
      await git("init", "-b", "main");
      await git("add", "src/index.ts");

      const result = await runCli(["--staged"], { cwd: repo });

      expect(result.exitCode).toBe(0);
      const bundle = Bun.file(join(repo, ".srcpack/staged.txt"));
      expect(await bundle.exists()).toBe(true);
      const content = await bundle.text();
      expect(content).toContain("src/index.ts");
      expect(content).not.toContain("src/other.ts");
    });

    test("should bundle staged, unstaged, and untracked with --dirty", async () => {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/committed.ts"), "export const a = 1;\n");
      await writeFile(join(repo, "src/tracked.ts"), "export const b = 2;\n");
      await git("init", "-b", "main");
      await git("add", ".");
      await git("commit", "-m", "init");

      await writeFile(join(repo, "src/tracked.ts"), "export const b = 22;\n");
      await writeFile(join(repo, "src/fresh.ts"), "export const c = 3;\n");
      await git("add", "src/tracked.ts");
      await writeFile(join(repo, "src/tracked.ts"), "export const b = 222;\n");

      const result = await runCli(["--dirty"], { cwd: repo });

      expect(result.exitCode).toBe(0);
      const content = await Bun.file(join(repo, ".srcpack/dirty.txt")).text();
      expect(content).toContain("src/tracked.ts"); // staged + unstaged
      expect(content).toContain("src/fresh.ts"); // untracked
      expect(content).not.toContain("src/committed.ts"); // unchanged
    });

    test("should bundle branch work with --since, including untracked", async () => {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/base.ts"), "export const a = 1;\n");
      await git("init", "-b", "main");
      await git("add", ".");
      await git("commit", "-m", "init");

      await git("checkout", "-b", "feature");
      await writeFile(join(repo, "src/onbranch.ts"), "export const b = 2;\n");
      await git("add", "src/onbranch.ts");
      await git("commit", "-m", "branch work");
      await writeFile(join(repo, "src/untracked.ts"), "export const c = 3;\n");

      const result = await runCli(["--since", "main"], { cwd: repo });

      expect(result.exitCode).toBe(0);
      const content = await Bun.file(join(repo, ".srcpack/since.txt")).text();
      expect(content).toContain("src/onbranch.ts");
      expect(content).toContain("src/untracked.ts");
      expect(content).not.toContain("src/base.ts");
    });

    test("should skip writing when nothing is staged", async () => {
      await mkdir(repo, { recursive: true });
      await writeFile(join(repo, "README.md"), "# test\n");
      await git("init", "-b", "main");

      const result = await runCli(["--staged"], { cwd: repo });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("skipped");
      expect(await Bun.file(join(repo, ".srcpack/staged.txt")).exists()).toBe(
        false,
      );
    });

    test("should report a git failure without a stack trace", async () => {
      await mkdir(repo, { recursive: true });

      const result = await runCli(["--staged"], { cwd: repo });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Not a git repository");
      expect(result.stderr).not.toContain("at ");
    });

    test("should reject combining an ad-hoc flag with named bundles", async () => {
      const result = await runCli(["code", "--staged"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Cannot combine --staged");
    });

    test("should require a revision for --since", async () => {
      const result = await runCli(["--since"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Missing revision");
    });

    test("should not bundle a previous ad-hoc run's output", async () => {
      // No config, so outDir is the only thing marking srcpack's own output —
      // and `git:untracked` reports `.srcpack/dirty.txt` unless it is excluded
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/index.ts"), "export const x = 1;\n");
      await git("init", "-b", "main");

      await runCli(["--dirty"], { cwd: repo });
      const first = await Bun.file(join(repo, ".srcpack/dirty.txt")).text();
      await runCli(["--dirty"], { cwd: repo });
      const second = await Bun.file(join(repo, ".srcpack/dirty.txt")).text();

      expect(second).toBe(first);
      expect(second).not.toContain(".srcpack/dirty.txt");
    });

    test("should reject a range for --since", async () => {
      const result = await runCli(["--since", "main...HEAD"], {
        cwd: FIXTURE_PATH,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not a range");
    });
  });
});
