# ADR 005: On-demand bundles

**Status:** Accepted — 2026-09-13

## Context

Some bundles are not worth rebuilding on every `srcpack`: a Linear bundle costs a network round trip and a token, and a screenshot bundle needs a running dev server. Without a way to opt out, they either slow every run or fail it, and users drop them from the config — losing the "define once, rerun by name" workflow.

## Decision

A bundle may set `onDemand: true`. A full run (`srcpack`) skips it and prints `On demand: <names>`; naming it (`srcpack home`) builds it. `--dry-run` previews the same selection as the command it accompanies. If every bundle is on demand, a full run prints that line and exits 0.

The rule is the same for every source. Screenshot bundles are not on demand implicitly: a default that depends on source type is one more rule to learn.

Emptying does not change. A full run still empties `outDir`, which removes on-demand output; the workflow is `srcpack`, then `srcpack home`.

## Alternatives

- **`enabled: false`** — "disabled, unless named" contradicts itself.
- **Preserving on-demand output across full runs** — turns `emptyDirectory` into a growing list of exceptions, and custom outfiles make those exceptions paths rather than names. If it proves essential, an ownership manifest is the cleaner answer.

## Consequences

A full run no longer means "every configured bundle". Output of an on-demand bundle does not survive a full run, which is visible (the file is gone) rather than stale.
