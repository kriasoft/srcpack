import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");
const FIXTURE_PATH = join(import.meta.dir, "../fixtures/sample-project");

async function runCli(
  args: string[],
  options?: { cwd?: string; unsetEnv?: string[] },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = { ...process.env };
  for (const key of options?.unsetEnv ?? []) delete env[key];

  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    cwd: options?.cwd,
    env,
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

  describe("argument validation", () => {
    // Dropping an unknown flag turns the safe command the user typed into the
    // dangerous one they didn't: --no-uplaod uploads, --dry-rnu writes
    test.each([["--no-uplaod"], ["--dry-rnu"], ["--no-emptyOutdir"]])(
      "should reject %p instead of ignoring it",
      async (flag) => {
        const result = await runCli([flag], { cwd: FIXTURE_PATH });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`Unknown option: ${flag}`);
      },
    );

    test("should reject contradictory emptyOutDir flags", async () => {
      const result = await runCli(["--emptyOutDir", "--no-emptyOutDir"], {
        cwd: FIXTURE_PATH,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Cannot combine");
    });

    test.each([["init"], ["login"]])(
      "should reject arguments to %p, which takes none",
      async (command) => {
        const result = await runCli([command, "--wat"], { cwd: FIXTURE_PATH });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("takes no arguments");
      },
    );

    test("should treat an inherited property as an unknown bundle", async () => {
      const result = await runCli(["toString"], { cwd: FIXTURE_PATH });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown bundle: toString");
    });
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

  describe("failed run", () => {
    const project = join(tmpdir(), `srcpack-fail-${Date.now()}`);

    afterEach(async () => {
      await rm(project, { recursive: true, force: true });
    });

    test("should keep the previous output when a bundle fails to resolve", async () => {
      await mkdir(join(project, "docs"), { recursive: true });
      await writeFile(join(project, "docs/readme.md"), "# Readme\n");
      const config = join(project, "srcpack.config.ts");
      await writeFile(
        config,
        `export default { bundles: { docs: "docs/**/*.md" } };`,
      );

      const good = await runCli([], { cwd: project });
      expect(good.exitCode).toBe(0);

      const bundle = Bun.file(join(project, ".srcpack/docs.txt"));
      const before = await bundle.text();

      // Now add a bundle that cannot resolve. `linear` needs no network to
      // fail: with no API key it throws before the first request.
      await writeFile(
        config,
        `export default {
          bundles: {
            docs: "docs/**/*.md",
            backlog: { linear: "ENG" },
          },
        };`,
      );

      const failed = await runCli([], {
        cwd: project,
        unsetEnv: ["LINEAR_API_KEY"],
      });

      expect(failed.exitCode).toBe(1);
      expect(failed.stderr).toContain("LINEAR_API_KEY is not set");
      // outDir is emptied before writing, so emptying it before resolving
      // would leave nothing behind when a later bundle throws
      expect(await bundle.exists()).toBe(true);
      expect(await bundle.text()).toBe(before);
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
        `export default { outDir: ".", emptyOutDir: true, bundles: { app: "src/**/*" } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("contains the project root");
      // The whole project would otherwise be deleted
      expect(await Bun.file(join(project, "keep.md")).exists()).toBe(true);
      expect(await Bun.file(join(project, "src/index.ts")).exists()).toBe(true);
    });

    test("should not empty a custom outDir unless asked", async () => {
      // `outDir: "src"` reads as an ordinary setting; auto-emptying it would
      // delete the sources the same config asks to bundle
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { outDir: "src", bundles: { app: "src/**/*.ts" } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      expect(await Bun.file(join(project, "src/index.ts")).exists()).toBe(true);
    });

    test("should refuse a .srcpack that resolves outside the project", async () => {
      // Lexically `.srcpack` is inside the project; physically it is someone
      // else's directory. Declining to empty it isn't enough — writing there
      // still overwrites whatever shares a name with a bundle.
      const elsewhere = `${project}-elsewhere`;
      await mkdir(elsewhere, { recursive: true });
      await mkdir(project, { recursive: true });
      await writeFile(join(elsewhere, "sentinel.txt"), "do not delete\n");
      await symlink(elsewhere, join(project, ".srcpack"));
      await writeFile(join(project, "a.md"), "# a\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: { docs: "*.md" } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("it resolves to");
      expect(await Bun.file(join(elsewhere, "sentinel.txt")).exists()).toBe(
        true,
      );
      expect(await Bun.file(join(elsewhere, "docs.txt")).exists()).toBe(false);
      await rm(elsewhere, { recursive: true, force: true });
    });

    test("should still exclude stale output when root reaches it through a link", async () => {
      // `root` is spelled with a symlink, so the paths srcpack compares are
      // lexical while the directory it owns resolves elsewhere. Mixing the two
      // makes the previous run's bundle look like an ordinary source file.
      const real = join(project, "real");
      await mkdir(join(real, ".srcpack"), { recursive: true });
      await symlink(real, join(project, "app"));
      await writeFile(join(real, "a.md"), "# a\n");
      await writeFile(
        join(real, ".srcpack/old-name.txt"),
        "STALE BUNDLE FROM A RENAMED CONFIG\n",
      );
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { root: "./app", emptyOutDir: false, bundles: { current: "**/*" } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      const bundle = await Bun.file(join(real, ".srcpack/current.txt")).text();
      expect(bundle).not.toContain("STALE BUNDLE");
    });

    test("should replace a symlinked output instead of writing through it", async () => {
      // Nothing empties outDir here, so the link is still in place at write
      // time — and writing in place would land in the linked file
      const elsewhere = `${project}-elsewhere`;
      await mkdir(elsewhere, { recursive: true });
      await mkdir(join(project, ".srcpack"), { recursive: true });
      await writeFile(join(elsewhere, "private.txt"), "untouched\n");
      await symlink(
        join(elsewhere, "private.txt"),
        join(project, ".srcpack/docs.txt"),
      );
      await writeFile(join(project, "a.md"), "# a\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { emptyOutDir: false, bundles: { docs: "*.md" } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      expect(await Bun.file(join(elsewhere, "private.txt")).text()).toBe(
        "untouched\n",
      );
      expect(
        await Bun.file(join(project, ".srcpack/docs.txt")).text(),
      ).toContain("# a");
      await rm(elsewhere, { recursive: true, force: true });
    });

    test("should reject two bundles whose paths alias one file", async () => {
      await mkdir(join(project, "src"), { recursive: true });
      await mkdir(join(project, ".srcpack"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await symlink(join(project, ".srcpack"), join(project, "alias"));
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           frontend: { include: "src/**/*", outfile: ".srcpack/ctx.txt" },
           backend: { include: "src/**/*", outfile: "alias/ctx.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("both write to");
    });

    // "Café.txt" precomposed (U+00E9) and decomposed (e + U+0301). APFS stores
    // whichever spelling it is given but resolves both to one directory entry.
    // Written as escapes: a literal would be at the mercy of whatever
    // normalisation an editor or formatter applies to this file.
    const NFC_NAME = "Caf\u00e9.txt";
    const NFD_NAME = "Cafe\u0301.txt";

    test("should reject two bundles whose outfiles differ only by normalisation", async () => {
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           frontend: { include: "src/**/*", outfile: ".srcpack/${NFC_NAME}" },
           backend: { include: "src/**/*", outfile: ".srcpack/${NFD_NAME}" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("both write to");
    });

    test("should exclude a stale output whose name differs only by normalisation", async () => {
      await mkdir(join(project, "generated"), { recursive: true });
      await writeFile(join(project, "generated/notes.md"), "# notes\n");
      await writeFile(
        join(project, `generated/${NFC_NAME}`),
        "STALE BUNDLE FROM THE PREVIOUS RUN\n",
      );
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           ctx: { include: "generated/**/*", outfile: "generated/${NFD_NAME}" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      const bundle = await Bun.file(
        join(project, `generated/${NFD_NAME}`),
      ).text();
      expect(bundle).toContain("# notes");
      expect(bundle).not.toContain("STALE BUNDLE");
    });

    test("should never empty a directory that only case-matches .srcpack", async () => {
      // Ownership is an exact match on purpose, so `.SRCPACK` is never the
      // directory srcpack clears unasked. How it declines differs by
      // filesystem — refused as a redirected `.srcpack` where case folds, an
      // unrelated directory where it doesn't — but the contents survive either
      // way, which is the property worth pinning.
      await mkdir(join(project, ".SRCPACK"), { recursive: true });
      await writeFile(
        join(project, ".SRCPACK/sentinel.txt"),
        "irreplaceable\n",
      );
      await writeFile(join(project, "a.md"), "# a\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: { docs: "*.md" } };`,
      );

      await runCli([], { cwd: project });

      expect(
        await Bun.file(join(project, ".SRCPACK/sentinel.txt")).text(),
      ).toBe("irreplaceable\n");
    });

    test("should reject two bundles whose outfiles differ only by case", async () => {
      // macOS and Windows fold case, so these are one directory entry there and
      // the second bundle silently replaces the first. Rejected everywhere: a
      // config that survives on Linux and loses a bundle on a laptop is worse
      // than one that fails the same way on both.
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           Web: { include: "src/**/*", outfile: ".srcpack/Context.txt" },
           web: { include: "src/**/*", outfile: ".srcpack/context.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("both write to");
      expect(
        await Bun.file(join(project, ".srcpack/Context.txt")).exists(),
      ).toBe(false);
    });

    test("should exclude a stale output whose name differs only by case", async () => {
      await mkdir(join(project, "generated"), { recursive: true });
      await writeFile(join(project, "generated/notes.md"), "# notes\n");
      await writeFile(
        join(project, "generated/Context.txt"),
        "STALE BUNDLE FROM THE PREVIOUS RUN\n",
      );
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           ctx: { include: "generated/**/*", outfile: "generated/context.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      const written = join(project, "generated/context.txt");
      const bundle = await Bun.file(written).text();
      expect(bundle).toContain("# notes");
      expect(bundle).not.toContain("STALE BUNDLE");
    });

    test("should exclude stale bundles under an outDir named by a link", async () => {
      await mkdir(join(project, "generated"), { recursive: true });
      await symlink(join(project, "generated"), join(project, "alias"));
      await writeFile(join(project, "notes.md"), "# notes\n");
      await writeFile(
        join(project, "generated/old-name.txt"),
        "STALE BUNDLE FROM A RENAMED CONFIG\n",
      );
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { outDir: "alias", bundles: { ctx: ["**/*"] } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      const bundle = await Bun.file(join(project, "generated/ctx.txt")).text();
      expect(bundle).toContain("# notes");
      expect(bundle).not.toContain("STALE BUNDLE");
    });

    test("should exclude a custom outfile when root reaches it through a link", async () => {
      // The mirror of the case above: here the glob yields lexical paths and the
      // outfile resolves physically. Neither identity alone covers both.
      const real = join(project, "real");
      await mkdir(real, { recursive: true });
      await symlink(real, join(project, "app"));
      await writeFile(join(real, "a.md"), "# a\n");
      await writeFile(
        join(real, "ctx.txt"),
        "STALE BUNDLE FROM THE PREVIOUS RUN\n",
      );
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { root: "./app", bundles: {
           ctx: { include: "**/*", outfile: "ctx.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      const bundle = await Bun.file(join(real, "ctx.txt")).text();
      expect(bundle).toContain("# a");
      expect(bundle).not.toContain("STALE BUNDLE");
    });

    test("should reject aliased outfiles under a directory that does not exist yet", async () => {
      // The alias only becomes visible once the intermediate directories are
      // created, which the first write does. Resolving a fixed number of levels
      // calls these two different files right up until they turn out to be one.
      await mkdir(join(project, "src"), { recursive: true });
      await mkdir(join(project, ".srcpack"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await symlink(join(project, ".srcpack"), join(project, "alias"));
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           frontend: { include: "src/**/*", outfile: ".srcpack/nested/deep/ctx.txt" },
           backend: { include: "src/**/*", outfile: "alias/nested/deep/ctx.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("both write to");
      expect(
        await Bun.file(join(project, ".srcpack/nested/deep/ctx.txt")).exists(),
      ).toBe(false);
    });

    test("should exclude a custom outfile reached through a link from its own sources", async () => {
      // The outfile and the source glob name one directory by two spellings, so
      // lexical comparison alone lets the previous run's bundle back in.
      await mkdir(join(project, "generated"), { recursive: true });
      await symlink(join(project, "generated"), join(project, "alias"));
      await writeFile(join(project, "generated/notes.md"), "# notes\n");
      await writeFile(
        join(project, "generated/context.txt"),
        "STALE BUNDLE FROM THE PREVIOUS RUN\n",
      );
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           context: { include: "generated/**/*", outfile: "alias/context.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(0);
      const bundle = await Bun.file(
        join(project, "generated/context.txt"),
      ).text();
      expect(bundle).toContain("# notes");
      expect(bundle).not.toContain("STALE BUNDLE");
    });

    test("should reject two bundles writing to one file", async () => {
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/index.ts"), "export const x = 1;\n");
      await writeFile(
        join(project, "srcpack.config.ts"),
        `export default { bundles: {
           frontend: { include: "src/**/*", outfile: ".srcpack/ctx.txt" },
           backend: { include: "src/**/*", outfile: ".srcpack/ctx.txt" },
         } };`,
      );

      const result = await runCli([], { cwd: project });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("both write to");
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
