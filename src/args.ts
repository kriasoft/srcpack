// SPDX-License-Identifier: MIT

import { parseArgs } from "node:util";
import type { BundleConfig } from "./config.ts";

/** A mistake on the command line: reported without a stack trace. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * One-off bundle from a `git:` source or a URL instead of a configured one.
 * Needs no config file — reviewing what you just wrote, or how a page looks on
 * a phone, is throwaway and not worth committing.
 */
export interface AdHocBundle {
  name: string;
  source: BundleConfig;
}

export interface CliArgs {
  /** Bundle names, in the order given. Empty for a full run. */
  bundles: string[];
  adHoc: AdHocBundle | null;
  dryRun: boolean;
  /** Set only by a flag; `undefined` leaves the decision to config. */
  emptyOutDir: boolean | undefined;
  upload: boolean;
}

/**
 * Every option the CLI accepts; `strict` rejects the rest. A typo that gets
 * quietly dropped is the dangerous kind: `--no-uplaod` uploads, `--dry-rnu`
 * writes, `--no-emptyOutdir` empties. Same rule as the config — a token that
 * changes what a run destroys or publishes is never a silent no-op.
 *
 * Negatives are declared literally rather than with `allowNegative`, which
 * negates every boolean and would make `--upload` valid by defining `upload`.
 */
const OPTIONS = {
  staged: { type: "boolean" },
  dirty: { type: "boolean" },
  // Valued options are `multiple` so a repeat is seen and rejected rather
  // than last-one-wins
  since: { type: "string", multiple: true },
  screenshot: { type: "string", multiple: true },
  viewport: { type: "string", multiple: true },
  "dry-run": { type: "boolean" },
  emptyOutDir: { type: "boolean" },
  "no-emptyOutDir": { type: "boolean" },
  "no-upload": { type: "boolean" },
} as const;

const AD_HOC_FLAGS = ["staged", "dirty", "since", "screenshot"] as const;

const MISSING_VALUE = {
  since: "Missing revision: --since <rev> (e.g. --since main)",
  screenshot:
    "Missing URL: --screenshot <url> (e.g. --screenshot localhost:5173)",
  viewport: "Missing viewport: --viewport <desktop|mobile>",
};

const VIEWPORTS = ["desktop", "mobile"] as const;

/**
 * Parse everything after `srcpack` except `--help`, `--version` and the
 * `init`/`login` subcommands, which the CLI handles before this.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  // parseArgs accepts `--` as a terminator even when strict, which would turn
  // a stray `srcpack --` into a full run that empties and uploads
  if (argv.includes("--")) throw unknownOption("--");

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw toUsageError(error as NodeJS.ErrnoException);
  }
  const { values, positionals } = parsed;

  // Both flags set both values, so parseArgs can't reject this on its own
  if (values.emptyOutDir && values["no-emptyOutDir"]) {
    throw new UsageError("Cannot combine --emptyOutDir with --no-emptyOutDir.");
  }

  const adHocFlags = AD_HOC_FLAGS.filter((flag) => values[flag] !== undefined);
  if (adHocFlags.length > 1) {
    throw new UsageError(
      `Cannot combine ${adHocFlags.map((flag) => `--${flag}`).join(" and ")}.`,
    );
  }
  for (const flag of Object.keys(
    MISSING_VALUE,
  ) as (keyof typeof MISSING_VALUE)[]) {
    const given = values[flag] ?? [];
    if (given.length > 1) {
      throw new UsageError(
        `--${flag} takes one value; got ${given.map((v) => `"${v}"`).join(" and ")}.`,
      );
    }
  }
  const [viewport] = values.viewport ?? [];
  if (viewport !== undefined && !values.screenshot) {
    throw new UsageError("--viewport applies to --screenshot <url>.");
  }
  const adHoc = toAdHocBundle(adHocFlags[0], {
    since: values.since?.[0],
    screenshot: values.screenshot?.[0],
    viewport,
  });
  if (adHoc && positionals.length) {
    throw new UsageError(`Cannot combine --${adHoc.name} with named bundles.`);
  }

  return {
    bundles: positionals,
    adHoc,
    dryRun: values["dry-run"] ?? false,
    emptyOutDir: values.emptyOutDir
      ? true
      : values["no-emptyOutDir"]
        ? false
        : undefined,
    upload: !values["no-upload"],
  };
}

function toAdHocBundle(
  flag: (typeof AD_HOC_FLAGS)[number] | undefined,
  value: { since?: string; screenshot?: string; viewport?: string },
): AdHocBundle | null {
  switch (flag) {
    case "staged":
      return { name: "staged", source: ["git:staged"] };
    case "dirty":
      return { name: "dirty", source: ["git:dirty"] };
    case "since": {
      const rev = value.since;
      // `--since=` parses as an empty value rather than a missing one
      if (!rev) throw new UsageError(MISSING_VALUE.since);
      // A range pins both endpoints, so it would silently drop the uncommitted
      // work --since promises. Ranges belong in a config `git:` source.
      if (rev.includes("..")) {
        throw new UsageError(
          `--since takes a revision, not a range: "${rev}". Use a git: source in your config for ranges.`,
        );
      }
      // `git diff` can't see untracked files, but a new file written on this
      // branch is part of "what changed since <rev>"
      return { name: "since", source: [`git:${rev}`, "git:untracked"] };
    }
    case "screenshot": {
      if (!value.screenshot) throw new UsageError(MISSING_VALUE.screenshot);
      // Typed at a prompt, `localhost:5173` means http. Config URLs must carry
      // the scheme, since there they are written once and read by others.
      const url = value.screenshot.includes("://")
        ? value.screenshot
        : `http://${value.screenshot}`;
      if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
        throw new UsageError(
          `--screenshot takes an http(s) URL, got "${value.screenshot}".`,
        );
      }
      const viewport = value.viewport ?? "desktop";
      if (!(VIEWPORTS as readonly string[]).includes(viewport)) {
        throw new UsageError(
          `--viewport must be "desktop" or "mobile", got "${viewport}".`,
        );
      }
      return {
        name: "screenshot",
        source: {
          screenshot: {
            url,
            viewport: viewport as (typeof VIEWPORTS)[number],
          },
        },
      };
    }
    default:
      return null;
  }
}

function unknownOption(option: string): UsageError {
  return new UsageError(
    `Unknown option: ${option}\nRun \`srcpack --help\` to see the available options.`,
  );
}

/**
 * Restate parseArgs errors in srcpack's words. Its messages explain `--`
 * escaping and `--opt=-value` spellings, which answer a question nobody
 * mistyping `--no-upload` is asking.
 */
function toUsageError(error: NodeJS.ErrnoException): Error {
  switch (error.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return unknownOption(
        /'([^']+)'/.exec(error.message)?.[1] ?? error.message,
      );
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE": {
      // Missing (`--since`) or swallowed by the next flag (`--since -x`)
      const flag = /^Option '--([\w-]+)/.exec(error.message)?.[1];
      return new UsageError(
        flag && Object.hasOwn(MISSING_VALUE, flag)
          ? MISSING_VALUE[flag as keyof typeof MISSING_VALUE]
          : error.message,
      );
    }
    default:
      return error;
  }
}
