#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ora from "ora";
import { bundleOne, type BundleResult } from "./bundle.ts";
import {
  ConfigError,
  loadConfig,
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
import { runInit } from "./init.ts";

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

function isOutDirInsideRoot(outDir: string, root: string): boolean {
  const absoluteOutDir = isAbsolute(outDir) ? outDir : resolve(root, outDir);
  const rel = relative(root, absoluteOutDir);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Empty a directory while preserving specified entries (e.g., `.git`).
 * Uses `force: true` to handle read-only or in-use files.
 */
async function emptyDirectory(dir: string, skip: string[] = []): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // Directory doesn't exist, nothing to empty
  }
  const skipSet = new Set(skip);
  await Promise.all(
    entries
      .filter((entry) => !skipSet.has(entry))
      .map((entry) => rm(join(dir, entry), { recursive: true, force: true })),
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
srcpack - Bundle and upload tool

Usage:
  npx srcpack              Bundle all, upload if configured
  npx srcpack web api      Bundle specific bundles only
  npx srcpack --dry-run    Preview bundles without writing files
  npx srcpack --no-upload  Bundle only, skip upload
  npx srcpack init         Interactive config setup
  npx srcpack login        Authenticate with Google Drive

Options:
  --dry-run        Preview bundles without writing files
  --emptyOutDir    Empty output directory before bundling
  --no-emptyOutDir Keep existing files in output directory
  --no-upload      Skip uploading to cloud storage
  -h, --help       Show this help message
`);
    return;
  }

  if (args.includes("init")) {
    await runInit();
    return;
  }

  if (args.includes("login")) {
    await runLogin();
    return;
  }

  const dryRun = args.includes("--dry-run");
  const noUpload = args.includes("--no-upload");
  // CLI flags: --emptyOutDir forces true, --no-emptyOutDir forces false
  const emptyOutDirFlag = args.includes("--emptyOutDir")
    ? true
    : args.includes("--no-emptyOutDir")
      ? false
      : undefined;
  const subcommands = ["init", "login"];
  const requestedBundles = args.filter(
    (arg) => !arg.startsWith("-") && !subcommands.includes(arg),
  );

  const config = await loadConfig();

  if (!config) {
    console.error(
      "No configuration found. Run `npx srcpack init` to create one.",
    );
    process.exit(1);
  }

  // Determine which bundles to process
  const bundleNames = requestedBundles.length
    ? requestedBundles
    : Object.keys(config.bundles);

  // Validate requested bundle names exist
  for (const name of bundleNames) {
    if (!(name in config.bundles)) {
      console.error(`Unknown bundle: ${name}`);
      process.exit(1);
    }
  }

  if (bundleNames.length === 0) {
    console.log("No bundles configured.");
    return;
  }

  const root = config.root;

  // Resolve emptyOutDir: CLI flag > config > auto (true if inside root)
  const outDirInsideRoot = isOutDirInsideRoot(config.outDir, root);
  const emptyOutDir = emptyOutDirFlag ?? config.emptyOutDir ?? outDirInsideRoot;

  // Warn if outDir is outside root and emptyOutDir is not explicitly set
  if (
    !outDirInsideRoot &&
    emptyOutDirFlag === undefined &&
    config.emptyOutDir === undefined
  ) {
    console.warn(
      `Warning: outDir "${config.outDir}" is outside project root. ` +
        "Use --emptyOutDir to suppress this warning and empty the directory.",
    );
  }

  // Empty outDir before bundling (unless dry-run)
  if (emptyOutDir && !dryRun) {
    const outDirPath = isAbsolute(config.outDir)
      ? config.outDir
      : resolve(root, config.outDir);
    await emptyDirectory(outDirPath, [".git"]);
  }

  const outputs: BundleOutput[] = [];

  // Process all bundles with progress
  const bundleSpinner = ora({
    text: `Bundling ${bundleNames[0]}...`,
    color: "cyan",
  }).start();

  for (let i = 0; i < bundleNames.length; i++) {
    const name = bundleNames[i]!;
    bundleSpinner.text = `Bundling ${name}... (${i + 1}/${bundleNames.length})`;
    const bundleConfig = config.bundles[name]!;
    const result = await bundleOne(name, bundleConfig, root);
    const outfile = getOutfile(bundleConfig, name, config.outDir);
    outputs.push({ name, outfile, result });
  }

  bundleSpinner.stop();

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
    const outPath = join(root, outfile);

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
    } else {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, result.content);
      console.log(
        `  ${nameCol}  ${filesCol} ${plural(fileCount, "file")}  ${linesCol} ${plural(lineCount, "line")}  → ${outfile}`,
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

    // Handle upload if configured and not disabled
    if (config.upload && !noUpload) {
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

function getGdriveConfig(config: {
  upload?: UploadConfig | UploadConfig[];
}): UploadConfig | null {
  if (!config.upload) return null;
  const uploads = Array.isArray(config.upload)
    ? config.upload
    : [config.upload];
  return uploads.find(isGdriveConfigured) ?? null;
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
  // Filter out excluded bundles
  const excludeSet = new Set(uploadConfig.exclude ?? []);
  const toUpload = outputs.filter((o) => !excludeSet.has(o.name));

  if (toUpload.length === 0) {
    console.log("\nNo bundles to upload (all excluded).");
    return;
  }

  try {
    await ensureAuthenticated(uploadConfig);

    const uploadSpinner = ora({
      text: `Uploading to Google Drive...`,
      color: "cyan",
    }).start();

    const results: UploadResult[] = [];

    for (let i = 0; i < toUpload.length; i++) {
      const output = toUpload[i]!;
      const filePath = join(root, output.outfile);
      uploadSpinner.text = `Uploading ${output.name}... (${i + 1}/${toUpload.length})`;
      const result = await uploadFile(filePath, uploadConfig);
      results.push(result);
    }

    uploadSpinner.stop();

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
  console.error(err);
  process.exit(1);
});
