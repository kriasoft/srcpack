// SPDX-License-Identifier: MIT

import { cosmiconfig } from "cosmiconfig";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
 * A name typed by a human and handed to a remote API. Trimmed, because a key
 * pasted with a stray space fails as "not found" or "not authorized", which
 * reads like the wrong key rather than the wrong whitespace.
 */
const IdentifierSchema = z.string().trim().min(1);

/**
 * A bundle name, which is also a filename: the default output is
 * `<outDir>/<name>.txt`. Unconstrained, `"../report"` writes outside `outDir`
 * entirely, and a leading `-` names a bundle the CLI can never be asked for.
 */
const BundleNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Bundle name must start with a letter or digit and contain only letters, digits, dot, underscore or hyphen",
  );

// Every closed object below is strict. Zod strips unknown keys by default, and
// a stripped key is a typo that changes behaviour without saying so: `liner`
// drops a bundle's issues, `emptyOutdir` hands the decision back to the
// automatic default, `exlude` uploads the bundle it was meant to hold back.
// Config files are edited by hand and read by a machine — the failure has to be
// loud. Adding a key is a minor version either way, so nothing is lost.

/**
 * Linear issues as a bundle source. Each issue becomes a virtual file at
 * `linear/issues/<identifier>.md`, so it gets its own index entry and line
 * range and can be filtered with ordinary `!` exclusions.
 *
 * Authentication reads `LINEAR_API_KEY` from the environment. It is
 * deliberately not a config field: config files are committed, and the
 * `package.json` config form cannot express `process.env`.
 *
 * `team` is required. A workspace-wide fetch is a footgun — it looks innocuous
 * and can pull thousands of issues into a context window.
 *
 * @example
 * ```ts
 * bundles: {
 *   backlog: { linear: "ENG" },
 *   roadmap: { linear: { team: "ENG", project: "Roadmap" } },
 * }
 * ```
 */
const LinearSourceSchema = z.union([
  /** Shorthand for `{ team: "<key>" }`. */
  IdentifierSchema,
  z.strictObject({
    /** Team key — the `ENG` in issue identifier `ENG-123`. */
    team: IdentifierSchema,
    /** Project name. Must name exactly one project within the team. */
    project: IdentifierSchema.optional(),
    /** Include completed, canceled and duplicate issues. Defaults to false. */
    includeClosed: z.boolean().default(false),
  }),
]);

/**
 * Bundle configuration. Accepts a string pattern, array of patterns, or object.
 * Patterns prefixed with `!` are exclusions. Patterns prefixed with `+` force
 * inclusion (bypass .gitignore).
 *
 * A pattern may also be a git source instead of a glob: `git:staged`,
 * `git:unstaged`, `git:untracked`, `git:dirty`, or `git:<rev>` (e.g.
 * `git:main`, `git:HEAD~3`).
 *
 * The object form takes files (`include`), Linear issues (`linear`), or both.
 *
 * @example
 * ```ts
 * bundles: {
 *   review: ["git:staged", "!bun.lock"],
 *   planning: { include: ["docs/**"], linear: { team: "ENG" } },
 * }
 * ```
 */
const BundleConfigSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
  z
    .strictObject({
      /** Glob patterns to include in the bundle. */
      include: PatternsSchema.optional(),
      /** Linear issues to include in the bundle. */
      linear: LinearSourceSchema.optional(),
      /** Custom output file path. Defaults to `<outDir>/<bundleName>.txt`. */
      outfile: z.string().min(1).optional(),
      /** Include file index header in output. Defaults to true. */
      index: z.boolean().default(true),
      /** Text to prepend to bundle (e.g., review instructions for LLMs). */
      prompt: z.string().optional(),
    })
    .refine((bundle) => bundle.include || bundle.linear, {
      message: 'Bundle needs a source: "include" patterns, "linear", or both',
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
const UploadConfigSchema = z.strictObject({
  /** Upload provider. Currently only "gdrive" is supported. */
  provider: z.literal("gdrive"),
  /** Google Drive folder ID to upload files to. If omitted, uploads to root. */
  folderId: IdentifierSchema.optional(),
  /** OAuth 2.0 client ID from Google Cloud Console. */
  clientId: IdentifierSchema,
  /** OAuth 2.0 client secret from Google Cloud Console. */
  clientSecret: IdentifierSchema,
  /** Bundle names to skip during upload. Supports exact names only. */
  exclude: z.array(z.string()).optional(),
});

/** Root configuration for srcpack. */
const ConfigSchema = z
  .strictObject({
    /**
     * Project root directory. Can be absolute or relative to CWD.
     * @default process.cwd()
     */
    root: z.string().default(""),
    /** Output directory for bundle files (relative to root). Defaults to ".srcpack". */
    outDir: z.string().default(".srcpack"),
    /** Empty outDir before writing. Automatic only for the default `.srcpack`. */
    emptyOutDir: z.boolean().optional(),
    /** Upload configuration for cloud storage. Single destination or array. */
    upload: z
      .union([UploadConfigSchema, z.array(UploadConfigSchema).min(1)])
      .optional(),
    /** Named bundles mapping bundle name to glob patterns or config object. */
    bundles: z.record(BundleNameSchema, BundleConfigSchema),
  })
  .superRefine((config, ctx) => {
    // `upload.exclude` is the only thing keeping a bundle off Google Drive, so a
    // name that matches nothing uploads the bundle it was meant to hold back —
    // the one failure mode where a typo is worse than a missing line. A stale
    // entry left over from a deleted bundle is cheap to fix by comparison.
    const uploads = config.upload
      ? Array.isArray(config.upload)
        ? config.upload
        : [config.upload]
      : [];
    const names = new Set(Object.keys(config.bundles));

    uploads.forEach((upload, i) => {
      const path = Array.isArray(config.upload)
        ? ["upload", i, "exclude"]
        : ["upload", "exclude"];
      for (const name of upload.exclude ?? []) {
        if (!names.has(name)) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `Unknown bundle "${name}"`,
          });
        }
      }
    });
  });

export type UploadConfig = z.infer<typeof UploadConfigSchema>;
export type LinearSourceInput = z.input<typeof LinearSourceSchema>;
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

/** A zod issue, plus the nested issues a union or a bad record key carries. */
interface Issue {
  code: string;
  message: string;
  path: PropertyKey[];
  /** One entry per union branch. */
  errors?: Issue[][];
  /** Why a record key was rejected. */
  issues?: Issue[];
}

/**
 * Reduce an issue to the leaves that actually explain it. Both wrappers say
 * nothing on their own — "Invalid input", "Invalid key in record" — while the
 * reason sits one level down.
 */
function flatten(issue: Issue, prefix: PropertyKey[] = []): Issue[] {
  const path = [...prefix, ...issue.path];
  const nested =
    issue.code === "invalid_union"
      ? issue.errors?.flat()
      : issue.code === "invalid_key"
        ? issue.issues
        : undefined;
  return nested?.length
    ? nested.flatMap((child) => flatten(child, path))
    : [{ ...issue, path }];
}

/**
 * Describe the most specific reason a config failed.
 *
 * Bundle and upload configs are unions, and a union reports one failure per
 * branch. Reporting the first would surface "expected string" from a branch
 * that never applied, burying the branch that nearly matched — so prefer a
 * leaf that says something other than "wrong type", deepest path first.
 */
function describe(issues: Issue[]): string {
  const leaves = issues.flatMap((issue) => flatten(issue));
  const specific = leaves.filter((leaf) => leaf.code !== "invalid_type");
  const best = (specific.length ? specific : leaves).reduce((a, b) =>
    b.path.length > a.path.length ? b : a,
  );
  const path = best.path.join(".");
  return path ? `${path}: ${best.message}` : best.message;
}

export function parseConfig(value: unknown): Config {
  const result = ConfigSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigError(describe(result.error.issues as unknown as Issue[]));
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
    "srcpack.config.ts", // Primary: works in an ESM project ("type": "module")
    "srcpack.config.mts", // Unconditionally ESM, so it also loads in CommonJS
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
