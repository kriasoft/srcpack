// SPDX-License-Identifier: MIT

import { basename, dirname, join, relative, resolve } from "node:path";
import type { BundleResult } from "./bundle.ts";
import { ConfigError, type BundleConfig } from "./config.ts";
import { entryPath, pathKey, physicalPath } from "./fs.ts";
import {
  isImageOf,
  toScreenshotTarget,
  type CapturedPage,
  type ScreenshotTarget,
} from "./screenshot.ts";

// Check output destinations before resolving sources or launching a browser.
// Retain each active plan through writing, reporting and upload.

/** Where a bundle writes. */
export interface PlannedBundle {
  name: string;
  source: BundleConfig;
  /** Absolute path of the text output. Absent for a screenshot-only bundle. */
  text?: { outfile: string };
  /** Page to capture into `<dir>/<name>-NN.png`. */
  images?: { target: ScreenshotTarget; dir: string };
}

/** What a bundle produced, ready to write. */
export interface ResolvedBundle {
  plan: PlannedBundle;
  text?: BundleResult;
  images?: CapturedPage;
}

export interface BundleSelection {
  /** Bundles this run builds, in the order named or configured. */
  names: string[];
  /** On-demand bundles a full run left out. Empty when bundles are named. */
  skipped: string[];
}

function isOnDemand(config: BundleConfig): boolean {
  return (
    typeof config === "object" &&
    !Array.isArray(config) &&
    config.onDemand === true
  );
}

/**
 * Pick the bundles a run builds. Naming a bundle always builds it; a full run
 * builds everything not marked `onDemand`.
 */
export function selectBundles(
  bundles: Record<string, BundleConfig>,
  requested: string[],
): BundleSelection {
  for (const name of requested) {
    // hasOwn, not `in`: `srcpack toString` would otherwise find Object.prototype
    if (!Object.hasOwn(bundles, name)) {
      throw new ConfigError(`Unknown bundle: ${name}`);
    }
  }
  if (requested.length) {
    return { names: [...new Set(requested)], skipped: [] };
  }

  const names: string[] = [];
  const skipped: string[] = [];
  for (const [name, config] of Object.entries(bundles)) {
    (isOnDemand(config) ? skipped : names).push(name);
  }
  return { names, skipped };
}

export interface OutputPlan {
  /** The bundles this run builds, in order. */
  bundles: PlannedBundle[];
  /**
   * Absolute paths srcpack writes, never to be bundled: every configured text
   * output and every active one, each in lexical and entry spelling. A glob
   * rooted at a symlink yields lexical paths, one rooted at the real directory
   * yields physical ones, and either can name a file the previous run wrote.
   *
   * Image families need no entry: they always live in outDir, which the CLI
   * excludes, and when outDir holds the root a PNG is skipped as binary anyway.
   */
  ownOutputs: string[];
}

function planBundle(
  name: string,
  source: BundleConfig,
  root: string,
  outDir: string,
): PlannedBundle {
  const object =
    typeof source === "object" && !Array.isArray(source) ? source : undefined;
  const plan: PlannedBundle = { name, source };
  // Every bundle writes text unless a screenshot is all it declares
  if (!object || object.include || object.linear) {
    const outfile = object?.outfile ?? join(outDir, `${name}.txt`);
    plan.text = { outfile: resolve(root, outfile) };
  }
  // Keep image cleanup within outDir, independent of any text outfile.
  if (object?.screenshot) {
    plan.images = {
      target: toScreenshotTarget(object.screenshot),
      dir: resolve(root, outDir),
    };
  }
  return plan;
}

/**
 * A claim on a destination: a text file, or an image family — a directory
 * plus a name prefix. Compared folded (`pathKey`) and physically.
 *
 * A text file's directory is its entry path's parent, as for any output. A
 * family's directory resolves fully: it is an ancestor of every PNG, and
 * `rename` replaces only the last component (ADR 004).
 */
interface Claim {
  owner: string;
  kind: "file" | "family";
  dir: string;
  /** Folded file name, or folded bundle name for a family. */
  name: string;
  /** Absolute path shown in a collision message. */
  display: string;
}

function overlaps(a: Claim, b: Claim): boolean {
  if (a.dir !== b.dir) return false;
  if (a.kind === b.kind) return a.name === b.name;
  const [file, family] = a.kind === "file" ? [a, b] : [b, a];
  return isImageOf(family.name, file.name);
}

/** `entry` is the text output's entry path, resolved once by the caller. */
async function claimsOf(
  plan: PlannedBundle,
  entry: string | undefined,
): Promise<Claim[]> {
  const claims: Claim[] = [];
  if (plan.text && entry) {
    claims.push({
      owner: plan.name,
      kind: "file",
      dir: pathKey(dirname(entry)),
      name: pathKey(basename(entry)),
      display: plan.text.outfile,
    });
  }
  if (plan.images) {
    claims.push({
      owner: plan.name,
      kind: "family",
      dir: pathKey(await physicalPath(plan.images.dir)),
      name: pathKey(plan.name),
      display: join(plan.images.dir, `${plan.name}-NN.png`),
    });
  }
  return claims;
}

function collision(first: Claim, second: Claim, root: string): ConfigError {
  // Name the later bundle's destination, unless only the earlier one is a file:
  // a file is what the user can change
  const { display } =
    first.kind === "file" && second.kind === "family" ? first : second;
  const where = relative(root, display) || display;
  if (first.owner === second.owner) {
    return new ConfigError(
      `Bundle "${first.owner}" writes its text and its images to "${where}". Give it another outfile.`,
    );
  }
  return new ConfigError(
    `Bundles "${first.owner}" and "${second.owner}" both write to "${where}". ` +
      (first.kind === "family" && second.kind === "family"
        ? "Rename one of them."
        : "Give one of them its own outfile."),
  );
}

/**
 * Derive where every bundle writes and reject two bundles sharing a file.
 *
 * Resolve directory aliases and compare destinations with `pathKey` to prevent
 * silent overwrites. Text files also collide with numbered images in the same
 * directory, including their own bundle's images.
 *
 * Configured bundles are checked against each other on every run, so a config
 * error doesn't depend on what was asked for. Active bundles — the ones `active`
 * names, ad-hoc included — are checked against configured bundles of a
 * different name: an ad-hoc bundle shadows a configured bundle of its own name
 * (`--staged` over a `staged` bundle) but never overwrites another's output.
 * Active bundles need no check among themselves: they are either configured,
 * and already checked, or a single ad-hoc bundle.
 */
export async function planOutputs(
  root: string,
  outDir: string,
  configured: Record<string, BundleConfig>,
  active: [name: string, source: BundleConfig][],
): Promise<OutputPlan> {
  const ownOutputs = new Set<string>();
  const claims: Claim[] = [];

  const claim = async (plan: PlannedBundle, shadowsOwnName: boolean) => {
    const entry = plan.text && (await entryPath(plan.text.outfile));
    for (const next of await claimsOf(plan, entry)) {
      const taken = claims.find(
        (prior) =>
          !(shadowsOwnName && prior.owner === next.owner) &&
          overlaps(prior, next),
      );
      if (taken) throw collision(taken, next, root);
      claims.push(next);
    }
    if (plan.text && entry) {
      ownOutputs.add(plan.text.outfile);
      ownOutputs.add(entry);
    }
  };

  for (const [name, source] of Object.entries(configured)) {
    await claim(planBundle(name, source, root, outDir), false);
  }

  const bundles: PlannedBundle[] = [];
  for (const [name, source] of active) {
    const plan = planBundle(name, source, root, outDir);
    await claim(plan, true);
    bundles.push(plan);
  }

  return { bundles, ownOutputs: [...ownOutputs] };
}
