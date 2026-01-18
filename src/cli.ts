#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  --dry-run     Preview bundles without writing files
  --no-upload   Skip uploading to cloud storage
  -h, --help    Show this help message
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

  const cwd = process.cwd();
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
    const result = await bundleOne(name, bundleConfig, cwd);
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
    const outPath = join(cwd, outfile);

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
          await handleGdriveUpload(uploadConfig, outputs, cwd);
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
  cwd: string,
): Promise<void> {
  try {
    await ensureAuthenticated(uploadConfig);

    const uploadSpinner = ora({
      text: `Uploading to Google Drive...`,
      color: "cyan",
    }).start();

    const results: UploadResult[] = [];

    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i]!;
      const filePath = join(cwd, output.outfile);
      uploadSpinner.text = `Uploading ${output.name}... (${i + 1}/${outputs.length})`;
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
