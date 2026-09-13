#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ora from "ora";
import { parseCliArgs, UsageError } from "./args.ts";
import { bundleOne, type BundleResult } from "./bundle.ts";
import {
  ConfigError,
  loadConfig,
  parseConfig,
  type UploadConfig,
} from "./config.ts";
import { isInside, physicalPath, writeFileAtomic } from "./fs.ts";
import {
  ensureAuthenticated,
  login,
  OAuthError,
  uploadFile,
  type UploadResult,
} from "./gdrive.ts";
import { GitError } from "./git.ts";
import { runInit } from "./init.ts";
import { LinearError } from "./linear.ts";
import { planOutputs, selectBundles, type ResolvedBundle } from "./plan.ts";

function sumLines(result: BundleResult): number {
  return result.index.reduce((sum, entry) => sum + entry.lines, 0);
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? singular + "s");
}

/** The directory srcpack owns by convention, and the only one it clears unasked. */
const DEFAULT_OUT_DIR = ".srcpack";

/**
 * Empty a directory while preserving specified entries (e.g., `.git`).
 * Uses `force: true` to handle read-only or in-use files.
 */
async function emptyDirectory(dir: string, skip: string[] = []): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    // Only a missing directory is "nothing to empty". Anything else — a
    // permission error, a file where a directory belongs — would otherwise be
    // reported as a clean run that then writes into a directory it never read.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new ConfigError(
      `Cannot empty outDir "${dir}": ${(error as Error).message}`,
    );
  }
  const skipSet = new Set(skip);
  await Promise.all(
    entries
      .filter((entry) => !skipSet.has(entry))
      .map((entry) => rm(join(dir, entry), { recursive: true, force: true })),
  );
}

/** Resolves to the package root from both `src/cli.ts` and `dist/cli.js`. */
async function readVersion(): Promise<string> {
  const pkg = await readFile(
    new URL("../package.json", import.meta.url),
    "utf-8",
  );
  return (JSON.parse(pkg) as { version: string }).version;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(await readVersion());
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
srcpack - Bundle and upload tool

Usage:
  npx srcpack              Bundle all, upload if configured
  npx srcpack web api      Bundle specific bundles only
  npx srcpack --staged     Bundle staged changes (no config needed)
  npx srcpack --dry-run    Preview bundles without writing files
  npx srcpack --no-upload  Bundle only, skip upload
  npx srcpack init         Interactive config setup
  npx srcpack login        Authenticate with Google Drive

Options:
  --staged         Bundle staged changes only
  --dirty          Bundle staged, unstaged, and untracked changes
  --since <rev>    Bundle changes since <rev> (e.g. --since main)
  --dry-run        Preview bundles without writing files
  --emptyOutDir    Empty output directory before writing
  --no-emptyOutDir Keep existing files in output directory
  --no-upload      Skip uploading to cloud storage
  -h, --help       Show this help message
  -v, --version    Show version
`);
    return;
  }

  // Only in first position: elsewhere the word is a bundle name or a revision,
  // and `--since init` must diff against the `init` branch, not run the wizard.
  if (args[0] === "init" || args[0] === "login") {
    // Neither takes arguments, so anything after is a misunderstanding worth
    // saying out loud rather than a flag that silently does nothing.
    if (args.length > 1) {
      console.error(`srcpack ${args[0]} takes no arguments.`);
      process.exit(1);
    }
    await (args[0] === "init" ? runInit() : runLogin());
    return;
  }

  const {
    bundles: requestedBundles,
    adHoc,
    dryRun,
    emptyOutDir: emptyOutDirFlag,
    upload,
  } = parseCliArgs(args);

  let config = await loadConfig();

  if (!config) {
    if (!adHoc) {
      console.error(
        "No configuration found. Run `npx srcpack init` to create one.",
      );
      process.exit(1);
    }
    // Ad-hoc bundles are self-describing, so defaults are enough
    config = parseConfig({ bundles: {} });
  }

  const bundles = adHoc ? { [adHoc.name]: adHoc.patterns } : config.bundles;

  const { names: bundleNames, skipped } = selectBundles(
    bundles,
    requestedBundles,
  );
  const onDemandNote = skipped.length
    ? `On demand: ${skipped.join(", ")}`
    : undefined;

  // Every bundle on demand is still a full run: it goes on to empty outDir
  if (bundleNames.length === 0 && !onDemandNote) {
    console.log("No bundles configured.");
    return;
  }

  const root = config.root;

  // Resolve emptyOutDir: CLI flag > config > auto.
  //
  // Auto means only the conventional `.srcpack`: recursive deletion needs a
  // directory srcpack demonstrably owns, and `outDir: "src"` reads as an
  // ordinary setting while turning a bundling run into a source-tree wipe.
  // Every other directory belongs to the user until they say otherwise.
  //
  // The comparison is physical, not lexical: `.srcpack -> ../shared` looks
  // inside the project and deletes somewhere else. Ad-hoc runs never empty by
  // default either — they shouldn't delete configured bundles.
  // Lexical is what gets written to and excluded from bundles; physical is what
  // decides ownership. Conflating them is what let a symlink redirect a delete.
  const rootPath = await physicalPath(root);
  const outDirPath = resolve(root, config.outDir);
  const outDirPhysical = await physicalPath(outDirPath);
  const defaultOutDir = join(rootPath, DEFAULT_OUT_DIR);

  // The conventional name is a claim about a place. A `.srcpack` that resolves
  // somewhere else keeps the name while writing into a directory srcpack was
  // never given — and would overwrite whatever shares a filename there.
  if (
    resolve(root, DEFAULT_OUT_DIR) === outDirPath &&
    outDirPhysical !== defaultOutDir
  ) {
    throw new ConfigError(
      `Refusing to use "${DEFAULT_OUT_DIR}": it resolves to "${outDirPhysical}", not "${defaultOutDir}". ` +
        "Set outDir to that path explicitly if that is where bundles belong.",
    );
  }

  const ownsOutDir = outDirPhysical === defaultOutDir;
  const emptyOutDir =
    emptyOutDirFlag ?? (adHoc ? false : (config.emptyOutDir ?? ownsOutDir));

  // `outDir: "."` resolves to the project root, where emptying deletes the
  // whole project — sources, config and all. Refuse rather than warn.
  const outDirHoldsRoot = isInside(rootPath, outDirPhysical);
  if (emptyOutDir && outDirHoldsRoot) {
    throw new ConfigError(
      `Refusing to empty outDir "${config.outDir}": it contains the project root. ` +
        "Use a subdirectory, or set emptyOutDir: false.",
    );
  }

  // srcpack never bundles what srcpack writes. Every output is named
  // explicitly; outDir covers stale bundles from renamed config entries too,
  // but not when it holds the root — that would exclude the whole project.
  const { bundles: plans, ownOutputs } = await planOutputs(
    root,
    config.outDir,
    config.bundles,
    bundleNames.map((name) => [name, bundles[name]!]),
  );
  if (!outDirHoldsRoot) ownOutputs.push(outDirPath, outDirPhysical);

  const outputs: ResolvedBundle[] = [];

  // Process all bundles with progress
  const bundleSpinner = ora({
    text: "Bundling...",
    color: "cyan",
  }).start();

  try {
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i]!;
      bundleSpinner.text = `Bundling ${plan.name}... (${i + 1}/${plans.length})`;
      let text: BundleResult;
      try {
        text = await bundleOne(plan.source, root, ownOutputs);
      } catch (error) {
        // A config can declare many bundles; the underlying message says what
        // broke but not which bundle asked for it.
        if (
          error instanceof ConfigError ||
          error instanceof GitError ||
          error instanceof LinearError
        ) {
          error.message = `Bundle "${plan.name}": ${error.message}`;
        }
        throw error;
      }
      outputs.push({ plan, text });
    }
  } finally {
    bundleSpinner.stop();
  }

  // Empty outDir only once every bundle has resolved, and only for a full run:
  // a named subset can't tell what is stale, so `srcpack web` must not delete
  // api.txt. Emptying earlier would destroy a good previous run whenever a
  // later bundle fails — routine once a source is remote, since an expired
  // token or a rate limit aborts the run after outDir is already gone.
  // Resolution doesn't need the files removed first: `ownOutputs` already keeps
  // srcpack's own output from being bundled.
  if (emptyOutDir && !dryRun && requestedBundles.length === 0) {
    await emptyDirectory(outDirPath, [".git"]);
  }

  if (outputs.length === 0) {
    console.log(onDemandNote);
    return;
  }

  // Calculate column widths for aligned output
  const maxNameLen = Math.max(...outputs.map((o) => o.plan.name.length));
  const maxFilesLen = Math.max(
    ...outputs.map((o) => formatNumber(o.text.index.length).length),
  );
  const maxLinesLen = Math.max(
    ...outputs.map((o) => formatNumber(sumLines(o.text)).length),
  );

  // Print each bundle
  console.log();
  for (const { plan, text: result } of outputs) {
    const fileCount = result.index.length;
    const lineCount = sumLines(result);
    const outPath = plan.text.outfile;

    const nameCol = plan.name.padEnd(maxNameLen);
    const filesCol = formatNumber(fileCount).padStart(maxFilesLen);
    const linesCol = formatNumber(lineCount).padStart(maxLinesLen);

    if (dryRun) {
      console.log(
        `  ${nameCol}  ${filesCol} ${plural(fileCount, "file")}  ${linesCol} ${plural(lineCount, "line")}`,
      );
      for (const entry of result.index) {
        console.log(`    ${entry.path}`);
      }
    } else if (fileCount === 0) {
      // Drop a previous run's file so the bundle never goes stale, but only
      // inside outDir — a custom outfile points at a location srcpack doesn't own
      if (isInside(outPath, outDirPath)) {
        await rm(outPath, { force: true });
      }
      console.log(
        `  ${nameCol}  ${filesCol} ${plural(fileCount, "file")}  ${linesCol} ${plural(lineCount, "line")}  → skipped`,
      );
    } else {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFileAtomic(outPath, result.content);
      const displayPath = relative(process.cwd(), outPath);
      console.log(
        `  ${nameCol}  ${filesCol} ${plural(fileCount, "file")}  ${linesCol} ${plural(lineCount, "line")}  → ${displayPath}`,
      );
    }
  }

  // Print summary
  const totalFiles = outputs.reduce((sum, o) => sum + o.text.index.length, 0);
  const totalLines = outputs.reduce((sum, o) => sum + sumLines(o.text), 0);
  const bundleWord = plural(outputs.length, "bundle");
  const fileWord = plural(totalFiles, "file");
  const lineWord = plural(totalLines, "line");

  console.log();
  if (dryRun) {
    console.log(
      `Dry run: ${outputs.length} ${bundleWord}, ${formatNumber(totalFiles)} ${fileWord}, ${formatNumber(totalLines)} ${lineWord}`,
    );
    if (onDemandNote) console.log(onDemandNote);
  } else {
    console.log(
      `Bundled: ${outputs.length} ${bundleWord}, ${formatNumber(totalFiles)} ${fileWord}, ${formatNumber(totalLines)} ${lineWord}`,
    );
    if (onDemandNote) console.log(onDemandNote);

    // Ad-hoc bundles stay local: uploading work-in-progress to Drive is not
    // what --staged asks for, and `upload.exclude` can't name a bundle the
    // config doesn't declare. Configure a named bundle to publish changes.
    if (config.upload && upload && !adHoc) {
      const uploads = Array.isArray(config.upload)
        ? config.upload
        : [config.upload];

      for (const uploadConfig of uploads) {
        if (isGdriveConfigured(uploadConfig)) {
          await handleGdriveUpload(uploadConfig, outputs);
        }
      }
    }
  }
}

function isGdriveConfigured(config: UploadConfig): boolean {
  return (
    config.provider === "gdrive" &&
    Boolean(config.clientId) &&
    Boolean(config.clientSecret)
  );
}

async function runLogin(): Promise<void> {
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    if (error instanceof ConfigError && error.message.includes("upload")) {
      printUploadConfigHelp();
      process.exit(1);
    }
    throw error;
  }

  if (!config) {
    console.error(
      "No configuration found. Run `npx srcpack init` to create one.",
    );
    process.exit(1);
  }

  if (!config.upload) {
    printUploadConfigHelp();
    process.exit(1);
  }

  const uploads = Array.isArray(config.upload)
    ? config.upload
    : [config.upload];
  const gdriveConfig = uploads.find((u) => u.provider === "gdrive");

  if (!gdriveConfig) {
    console.error('No upload config with provider: "gdrive" found.');
    process.exit(1);
  }

  try {
    console.log("Opening browser for authentication...");
    await login(gdriveConfig);
    console.log("Login successful.");
  } catch (error) {
    if (error instanceof OAuthError) {
      console.error(`OAuth error: ${error.error}`);
      if (error.error_description) {
        console.error(`  ${error.error_description}`);
      }
      process.exit(1);
    }
    throw error;
  }
}

function printUploadConfigHelp(): void {
  console.error("Upload configuration incomplete or missing.");
  console.error("Add to srcpack.config.ts:");
  console.error(`
  upload: {
    provider: "gdrive",
    folderId: "...",      // optional - Google Drive folder ID
    clientId: "...",      // required - OAuth 2.0 client ID
    clientSecret: "...",  // required - OAuth 2.0 client secret
  }
`);
}

async function handleGdriveUpload(
  uploadConfig: UploadConfig,
  outputs: ResolvedBundle[],
): Promise<void> {
  // Filter out excluded bundles and empty ones (never written to disk)
  const excludeSet = new Set(uploadConfig.exclude ?? []);
  const toUpload = outputs.filter(
    (o) => !excludeSet.has(o.plan.name) && o.text.index.length > 0,
  );

  if (toUpload.length === 0) {
    console.log("\nNo bundles to upload.");
    return;
  }

  try {
    await ensureAuthenticated(uploadConfig);

    const uploadSpinner = ora({
      text: `Uploading to Google Drive...`,
      color: "cyan",
    }).start();

    const results: UploadResult[] = [];

    try {
      for (let i = 0; i < toUpload.length; i++) {
        const { plan } = toUpload[i]!;
        uploadSpinner.text = `Uploading ${plan.name}... (${i + 1}/${toUpload.length})`;
        const result = await uploadFile(plan.text.outfile, uploadConfig);
        results.push(result);
      }
    } finally {
      uploadSpinner.stop();
    }

    // Print upload summary
    console.log();
    const uploadWord = plural(results.length, "file");
    console.log(`Uploaded: ${results.length} ${uploadWord} to Google Drive`);

    for (const result of results) {
      if (result.webViewLink) {
        console.log(`  ${result.name} → ${result.webViewLink}`);
      } else {
        console.log(`  ${result.name}`);
      }
    }
  } catch (error) {
    if (error instanceof OAuthError) {
      console.error(`\nOAuth error: ${error.error}`);
      if (error.error_description) {
        console.error(`  ${error.error_description}`);
      }
      // A failed upload must not report success — CI depends on the exit code
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

main().catch((err) => {
  // Usage, config, git and Linear failures are user-facing; a stack trace adds noise
  console.error(
    err instanceof UsageError ||
      err instanceof ConfigError ||
      err instanceof GitError ||
      err instanceof LinearError
      ? err.message
      : err,
  );
  process.exit(1);
});
