// SPDX-License-Identifier: MIT

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cosmiconfig } from "cosmiconfig";
import { z } from "zod";

export function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/** Glob patterns for file matching. Single pattern or array of patterns. */
const PatternsSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

/**
 * Bundle configuration. Accepts a string pattern, array of patterns, or object.
 * Patterns prefixed with `!` are exclusions. Patterns prefixed with `+` force
 * inclusion (bypass .gitignore).
 */
const BundleConfigSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
  z.object({
    /** Glob patterns to include in the bundle. */
    include: PatternsSchema,
    /** Custom output file path. Defaults to `<outDir>/<bundleName>.txt`. */
    outfile: z.string().optional(),
    /** Include file index header in output. Defaults to true. */
    index: z.boolean().default(true),
    /** Text to prepend to bundle (e.g., review instructions for LLMs). */
    prompt: z.string().optional(),
  }),
]);

/**
 * Upload destination configuration.
 *
 * @example
 * ```ts
 * upload: {
 *   provider: "gdrive",
 *   clientId: process.env.GDRIVE_CLIENT_ID,
 *   clientSecret: process.env.GDRIVE_CLIENT_SECRET,
 *   folderId: "1abc...",
 *   exclude: ["local", "debug"],
 * }
 * ```
 */
const UploadConfigSchema = z.object({
  /** Upload provider. Currently only "gdrive" is supported. */
  provider: z.literal("gdrive"),
  /** Google Drive folder ID to upload files to. If omitted, uploads to root. */
  folderId: z.string().optional(),
  /** OAuth 2.0 client ID from Google Cloud Console. */
  clientId: z.string().min(1),
  /** OAuth 2.0 client secret from Google Cloud Console. */
  clientSecret: z.string().min(1),
  /** Bundle names to skip during upload. Supports exact names only. */
  exclude: z.array(z.string()).optional(),
});

/** Root configuration for srcpack. */
const ConfigSchema = z.object({
  /**
   * Project root directory. Can be absolute or relative to CWD.
   * @default process.cwd()
   */
  root: z.string().default(""),
  /** Output directory for bundle files. Defaults to ".srcpack". */
  outDir: z.string().default(".srcpack"),
  /** Empty outDir before bundling. Auto-enabled when outDir is inside project root. */
  emptyOutDir: z.boolean().optional(),
  /** Upload configuration for cloud storage. Single destination or array. */
  upload: z
    .union([UploadConfigSchema, z.array(UploadConfigSchema).min(1)])
    .optional(),
  /** Named bundles mapping bundle name to glob patterns or config object. */
  bundles: z.record(z.string(), BundleConfigSchema),
});

export type UploadConfig = z.infer<typeof UploadConfigSchema>;
export type BundleConfig = z.infer<typeof BundleConfigSchema>;
export type BundleConfigInput = z.input<typeof BundleConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

export function defineConfig(config: ConfigInput): ConfigInput {
  return config;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseConfig(value: unknown): Config {
  const result = ConfigSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.join(".");
    const message = path ? `${path}: ${issue.message}` : issue.message;
    throw new ConfigError(message);
  }

  const config = result.data;
  // Resolve root: absolute path, relative to CWD, or CWD if empty/unset
  config.root = config.root ? resolve(expandPath(config.root)) : process.cwd();
  config.outDir = expandPath(config.outDir);

  for (const bundle of Object.values(config.bundles)) {
    if (
      typeof bundle === "object" &&
      !Array.isArray(bundle) &&
      bundle.outfile
    ) {
      bundle.outfile = expandPath(bundle.outfile);
    }
  }

  return config;
}

const explorer = cosmiconfig("srcpack", {
  searchPlaces: [
    "srcpack.config.ts", // Primary: full TypeScript support with Bun
    "srcpack.config.js", // Fallback for JS-only projects
    "package.json", // Zero-file option via "srcpack" field
  ],
});

export async function loadConfig(searchFrom?: string): Promise<Config | null> {
  const result = await explorer.search(searchFrom);
  if (!result) return null;
  return parseConfig(result.config);
}

export async function loadConfigFromFile(
  filepath: string,
): Promise<Config | null> {
  const result = await explorer.load(filepath);
  if (!result) return null;
  return parseConfig(result.config);
}
