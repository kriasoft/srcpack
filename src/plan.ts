// SPDX-License-Identifier: MIT

import { join, relative, resolve } from "node:path";
import { pathKey, type BundleResult } from "./bundle.ts";
import { ConfigError, type BundleConfig } from "./config.ts";
import { entryPath } from "./fs.ts";

// A run is split by phase. Selection, collision checks and own-output exclusion
// read `PlannedBundle`; writing, reporting and upload read `ResolvedBundle`.
// Destinations are derived once, and collisions fail before any source resolves.

/** Where a bundle writes, derived from config once. */
export interface PlannedBundle {
  name: string;
  source: BundleConfig;
  /** Absolute path of the text output. */
  text: { outfile: string };
}

/** What a bundle produced, ready to write. */
export interface ResolvedBundle {
  plan: PlannedBundle;
  text: BundleResult;
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
   * Absolute paths srcpack writes, never to be bundled: every configured
   * output and every active one, each in lexical and entry spelling. A glob
   * rooted at a symlink yields lexical paths, one rooted at the real directory
   * yields physical ones, and either can name a file the previous run wrote.
   */
  ownOutputs: string[];
}

function planBundle(
  name: string,
  source: BundleConfig,
  root: string,
  outDir: string,
): PlannedBundle {
  const outfile =
    typeof source === "object" && !Array.isArray(source) && source.outfile
      ? source.outfile
      : join(outDir, `${name}.txt`);
  return { name, source, text: { outfile: resolve(root, outfile) } };
}

/**
 * Derive where every bundle writes and reject two bundles sharing a file.
 *
 * Sharing is silent loss: the second write replaces the first, and upload then
 * sends the survivor twice under two names. Destinations are keyed by entry
 * path and folded with `pathKey` — `.srcpack/a.txt` and `alias/a.txt` are one
 * file once `alias` links to `.srcpack`, and so are `Web.txt` and `web.txt`
 * wherever the filesystem folds case.
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
  const writers = new Map<string, string>();

  const claim = async (plan: PlannedBundle, owner: string | undefined) => {
    const entry = await entryPath(plan.text.outfile);
    const key = pathKey(entry);
    const first = writers.get(key);
    if (first !== undefined && first !== owner) {
      throw new ConfigError(
        `Bundles "${first}" and "${plan.name}" both write to "${relative(root, plan.text.outfile) || plan.text.outfile}". ` +
          "Give one of them its own outfile.",
      );
    }
    writers.set(key, plan.name);
    ownOutputs.add(plan.text.outfile);
    ownOutputs.add(entry);
  };

  for (const [name, source] of Object.entries(configured)) {
    await claim(planBundle(name, source, root, outDir), undefined);
  }

  const bundles: PlannedBundle[] = [];
  for (const [name, source] of active) {
    const plan = planBundle(name, source, root, outDir);
    await claim(plan, name);
    bundles.push(plan);
  }

  return { bundles, ownOutputs: [...ownOutputs] };
}
