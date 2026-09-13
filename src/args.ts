// SPDX-License-Identifier: MIT

import { parseArgs } from "node:util";

/** A mistake on the command line: reported without a stack trace. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * One-off bundle from a `git:` source instead of a configured one. Needs no
 * config file — reviewing what you just wrote is throwaway, not worth committing.
 */
export interface AdHocBundle {
  name: string;
  patterns: string[];
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
  // `multiple` so a repeat is seen and rejected rather than last-one-wins
  since: { type: "string", multiple: true },
  "dry-run": { type: "boolean" },
  emptyOutDir: { type: "boolean" },
  "no-emptyOutDir": { type: "boolean" },
  "no-upload": { type: "boolean" },
} as const;

const AD_HOC_FLAGS = ["staged", "dirty", "since"] as const;

const MISSING_REVISION = "Missing revision: --since <rev> (e.g. --since main)";

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
  const [rev, ...extraRevs] = values.since ?? [];
  if (extraRevs.length) {
    throw new UsageError(
      `--since takes one revision; got ${[rev, ...extraRevs].map((r) => `"${r}"`).join(" and ")}.`,
    );
  }
  const adHoc = toAdHocBundle(adHocFlags[0], rev);
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
  rev: string | undefined,
): AdHocBundle | null {
  switch (flag) {
    case "staged":
      return { name: "staged", patterns: ["git:staged"] };
    case "dirty":
      return { name: "dirty", patterns: ["git:dirty"] };
    case "since":
      // `--since=` parses as an empty value rather than a missing one
      if (!rev) throw new UsageError(MISSING_REVISION);
      // A range pins both endpoints, so it would silently drop the uncommitted
      // work --since promises. Ranges belong in a config `git:` source.
      if (rev.includes("..")) {
        throw new UsageError(
          `--since takes a revision, not a range: "${rev}". Use a git: source in your config for ranges.`,
        );
      }
      // `git diff` can't see untracked files, but a new file written on this
      // branch is part of "what changed since <rev>"
      return { name: "since", patterns: [`git:${rev}`, "git:untracked"] };
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
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      // Missing (`--since`) or swallowed by the next flag (`--since -x`)
      return new UsageError(
        error.message.startsWith("Option '--since")
          ? MISSING_REVISION
          : error.message,
      );
    default:
      return error;
  }
}
