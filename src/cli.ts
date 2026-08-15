#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import ora from "ora";
import { bundleOne, pathKey, type BundleResult } from "./bundle.ts";
import {
  ConfigError,
  loadConfig,
  parseConfig,
  type BundleConfig,
  type UploadConfig,
} from "./config.ts";
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

interface BundleOutput {
  name: string;
  outfile: string;
  result: BundleResult;
}

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
 * Where a path physically is, with symlinks resolved. Destructive decisions are
 * made on this rather than the lexical path: `.srcpack -> ../shared` is inside
 * the project by name and somewhere else in fact, and it is the somewhere else
 * whose contents `rm` would take.
 *
 * Resolves as much of the path as exists, however deep that is. Stopping at the
 * immediate parent would call `.srcpack/nested/x.txt` and `alias/nested/x.txt`
 * different files until `mkdir -p` runs, which is one step too late to still be
 * a check: aliasing is a property of the ancestors, not of when they were made.
 */
async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    // dirname("/") === "/": nothing above the filesystem root left to resolve
    if (parent === path) return path;
    return join(await physicalPath(parent), basename(path));
  }
}

/**
 * Where `rename` puts a directory entry: ancestors resolved, the entry itself
 * left alone. Writing replaces the entry instead of following it, so a bundle
 * whose output is a symlink is identified as the link rather than its target —
 * two bundles writing over one link's target are still two separate files.
 */
async function entryPath(path: string): Promise<string> {
  return join(await physicalPath(dirname(path)), basename(path));
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  // Compare against ".." as a whole segment — "..cache/x" is a child, not an escape
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Write a bundle by replacing the directory entry rather than the file behind
 * it. Writing in place follows a symlink sitting at the output path, so
 * `.srcpack/web.txt -> ~/.ssh/config` would be written through; rename replaces
 * the link itself. It also makes each file appear whole or not at all.
 *
 * The temp name carries the pid so two runs can't rename each other's file.
 */
async function writeBundle(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, content);
    await rename(temp, path);
  } finally {
    // A failed write or rename would otherwise leave a partial file behind:
    // stale inside outDir, and bundled by the next run beside a custom outfile.
    await rm(temp, { force: true });
  }
}

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

/**
 * One-off bundle from a `git:` source instead of a configured one. Needs no
 * config file — reviewing what you just wrote is throwaway, not worth committing.
 */
interface AdHocBundle {
  name: string;
  patterns: string[];
}

const AD_HOC_FLAGS = ["--staged", "--dirty", "--since"] as const;

/**
 * Every option the CLI accepts. Anything else is a typo, and a typo that gets
 * quietly dropped is the dangerous kind: `--no-uplaod` uploads, `--dry-rnu`
 * writes, `--no-emptyOutdir` empties. Same rule as the config — a token that
 * changes what a run destroys or publishes is never a silent no-op.
 */
const KNOWN_FLAGS = new Set([
  ...AD_HOC_FLAGS,
  "--dry-run",
  "--emptyOutDir",
  "--no-emptyOutDir",
  "--no-upload",
  "--help",
  "-h",
  "--version",
  "-v",
]);

function assertKnownFlags(args: string[]): void {
  const unknown = args.find(
    (arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg),
  );
  if (unknown) {
    console.error(`Unknown option: ${unknown}`);
    console.error("Run `srcpack --help` to see the available options.");
    process.exit(1);
  }
  if (args.includes("--emptyOutDir") && args.includes("--no-emptyOutDir")) {
    console.error("Cannot combine --emptyOutDir with --no-emptyOutDir.");
    process.exit(1);
  }
}

function parseAdHocBundle(args: string[]): AdHocBundle | null {
  const flags = AD_HOC_FLAGS.filter((flag) => args.includes(flag));

  if (flags.length > 1) {
    console.error(`Cannot combine ${flags.join(" and ")}.`);
    process.exit(1);
  }

  switch (flags[0]) {
    case "--staged":
      return { name: "staged", patterns: ["git:staged"] };
    case "--dirty":
      return { name: "dirty", patterns: ["git:dirty"] };
    case "--since": {
      const rev = args[args.indexOf("--since") + 1];
      if (!rev || rev.startsWith("-")) {
        console.error("Missing revision: --since <rev> (e.g. --since main)");
        process.exit(1);
      }
      // A range pins both endpoints, so it would silently drop the uncommitted
      // work --since promises. Ranges belong in a config `git:` source.
      if (rev.includes("..")) {
        console.error(
          `--since takes a revision, not a range: "${rev}". Use a git: source in your config for ranges.`,
        );
        process.exit(1);
      }
      // `git diff` can't see untracked files, but a new file written on this
      // branch is part of "what changed since <rev>"
      return { name: "since", patterns: [`git:${rev}`, "git:untracked"] };
    }
    default:
      return null;
  }
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

  assertKnownFlags(args);

  const dryRun = args.includes("--dry-run");
  const noUpload = args.includes("--no-upload");
  // CLI flags: --emptyOutDir forces true, --no-emptyOutDir forces false
  const emptyOutDirFlag = args.includes("--emptyOutDir")
    ? true
    : args.includes("--no-emptyOutDir")
      ? false
      : undefined;
  const adHoc = parseAdHocBundle(args);
  const sinceIndex = args.indexOf("--since");
  const sinceValueIndex = sinceIndex === -1 ? -1 : sinceIndex + 1;
  const requestedBundles = args.filter(
    (arg, i) => !arg.startsWith("-") && i !== sinceValueIndex,
  );

  if (adHoc && requestedBundles.length) {
    console.error(`Cannot combine --${adHoc.name} with named bundles.`);
    process.exit(1);
  }

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

  // Determine which bundles to process
  const bundleNames = requestedBundles.length
    ? requestedBundles
    : Object.keys(bundles);

  // Validate requested bundle names exist
  for (const name of bundleNames) {
    // hasOwn, not `in`: `srcpack toString` would otherwise find Object.prototype
    if (!Object.hasOwn(bundles, name)) {
      console.error(`Unknown bundle: ${name}`);
      process.exit(1);
    }
  }

  if (bundleNames.length === 0) {
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

  // srcpack never bundles what srcpack writes. Every configured outfile is
  // named explicitly; outDir covers stale bundles from renamed config entries
  // too, but not when it holds the root — that would exclude the whole project.
  //
  // Both spellings of every output are recorded. A glob rooted at a symlink
  // yields lexical paths, one rooted at the real directory yields physical
  // ones, and either can name a file the previous run wrote.
  const ownOutputs = new Set<string>();
  const writers = new Map<string, string>();
  for (const [name, bundleConfig] of Object.entries(config.bundles)) {
    const outfile = resolve(
      root,
      getOutfile(bundleConfig, name, config.outDir),
    );
    // Two bundles sharing one file is silent loss: the second write replaces the
    // first, and the upload step then sends the survivor twice under two names.
    // Keyed by destination entry — `.srcpack/a.txt` and `alias/a.txt` are two
    // spellings of one file as soon as `alias` links to `.srcpack`, and so are
    // `Web.txt` and `web.txt` wherever the filesystem folds case.
    const entry = await entryPath(outfile);
    const key = pathKey(entry);
    const first = writers.get(key);
    if (first) {
      throw new ConfigError(
        `Bundles "${first}" and "${name}" both write to "${relative(root, outfile) || outfile}". ` +
          "Give one of them its own outfile.",
      );
    }
    writers.set(key, name);
    ownOutputs.add(outfile);
    ownOutputs.add(entry);
  }
  if (!outDirHoldsRoot) {
    ownOutputs.add(outDirPath);
    ownOutputs.add(outDirPhysical);
  }
  const outputPaths = [...ownOutputs];

  const outputs: BundleOutput[] = [];

  // Process all bundles with progress
  const bundleSpinner = ora({
    text: `Bundling ${bundleNames[0]}...`,
    color: "cyan",
  }).start();

  try {
    for (let i = 0; i < bundleNames.length; i++) {
      const name = bundleNames[i]!;
      bundleSpinner.text = `Bundling ${name}... (${i + 1}/${bundleNames.length})`;
      const bundleConfig = bundles[name]!;
      let result: BundleResult;
      try {
        result = await bundleOne(bundleConfig, root, outputPaths);
      } catch (error) {
        // A config can declare many bundles; the underlying message says what
        // broke but not which bundle asked for it.
        if (
          error instanceof ConfigError ||
          error instanceof GitError ||
          error instanceof LinearError
        ) {
          error.message = `Bundle "${name}": ${error.message}`;
        }
        throw error;
      }
      const outfile = getOutfile(bundleConfig, name, config.outDir);
      outputs.push({ name, outfile, result });
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

  // Calculate column widths for aligned output
  const maxNameLen = Math.max(...outputs.map((o) => o.name.length));
  const maxFilesLen = Math.max(
    ...outputs.map((o) => formatNumber(o.result.index.length).length),
  );
  const maxLinesLen = Math.max(
    ...outputs.map((o) => formatNumber(sumLines(o.result)).length),
  );

  // Print each bundle
  console.log();
  for (const { name, outfile, result } of outputs) {
    const fileCount = result.index.length;
    const lineCount = sumLines(result);
    const outPath = resolve(root, outfile);

    const nameCol = name.padEnd(maxNameLen);
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
      await writeBundle(outPath, result.content);
      const displayPath = relative(process.cwd(), outPath);
      console.log(
        `  ${nameCol}  ${filesCol} ${plural(fileCount, "file")}  ${linesCol} ${plural(lineCount, "line")}  → ${displayPath}`,
      );
    }
  }

  // Print summary
  const totalFiles = outputs.reduce((sum, o) => sum + o.result.index.length, 0);
  const totalLines = outputs.reduce((sum, o) => sum + sumLines(o.result), 0);
  const bundleWord = plural(outputs.length, "bundle");
  const fileWord = plural(totalFiles, "file");
  const lineWord = plural(totalLines, "line");

  console.log();
  if (dryRun) {
    console.log(
      `Dry run: ${outputs.length} ${bundleWord}, ${formatNumber(totalFiles)} ${fileWord}, ${formatNumber(totalLines)} ${lineWord}`,
    );
  } else {
    console.log(
      `Bundled: ${outputs.length} ${bundleWord}, ${formatNumber(totalFiles)} ${fileWord}, ${formatNumber(totalLines)} ${lineWord}`,
    );

    // Ad-hoc bundles stay local: uploading work-in-progress to Drive is not
    // what --staged asks for, and `upload.exclude` can't name a bundle the
    // config doesn't declare. Configure a named bundle to publish changes.
    if (config.upload && !noUpload && !adHoc) {
      const uploads = Array.isArray(config.upload)
        ? config.upload
        : [config.upload];

      for (const uploadConfig of uploads) {
        if (isGdriveConfigured(uploadConfig)) {
          await handleGdriveUpload(uploadConfig, outputs, root);
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
  outputs: BundleOutput[],
  root: string,
): Promise<void> {
  // Filter out excluded bundles and empty ones (never written to disk)
  const excludeSet = new Set(uploadConfig.exclude ?? []);
  const toUpload = outputs.filter(
    (o) => !excludeSet.has(o.name) && o.result.index.length > 0,
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
        const output = toUpload[i]!;
        const filePath = resolve(root, output.outfile);
        uploadSpinner.text = `Uploading ${output.name}... (${i + 1}/${toUpload.length})`;
        const result = await uploadFile(filePath, uploadConfig);
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

function getOutfile(
  bundleConfig: BundleConfig,
  name: string,
  outDir: string,
): string {
  if (
    typeof bundleConfig === "object" &&
    !Array.isArray(bundleConfig) &&
    bundleConfig.outfile
  ) {
    return bundleConfig.outfile;
  }
  return join(outDir, `${name}.txt`);
}

main().catch((err) => {
  // Config, git and Linear failures are user-facing; a stack trace adds noise
  console.error(
    err instanceof ConfigError ||
      err instanceof GitError ||
      err instanceof LinearError
      ? err.message
      : err,
  );
  process.exit(1);
});
