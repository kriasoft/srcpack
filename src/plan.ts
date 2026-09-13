// SPDX-License-Identifier: MIT

import { ConfigError, type BundleConfig } from "./config.ts";

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
