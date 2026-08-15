# ADR 004: What srcpack may read, delete and overwrite

**Status:** Accepted — 2026-08-15

## Context

A pre-release audit turned up five defects that look unrelated and are not:

- `outDir: "src"` deleted the sources the same config asked to bundle. Emptying was automatic for any `outDir` inside the project, and a source directory is inside the project.
- `.srcpack` as a symlink emptied the directory it pointed at, and wrote bundles into it. The check that called it "inside the project" was lexical; `rm` and `writeFile` are not.
- A symlinked directory was walked, and every file under it bundled. Symlinks were rejected only at the final path component, so `vendor/private/key.txt` passed — the leaf is an ordinary file and the escape happened at `vendor`.
- A nested `.gitignore` was never read. Only the root file was loaded, so a monorepo's `packages/app/.env` went into the bundle.
- `--no-uplaod` uploaded. Unknown flags were filtered out silently, which turns a typo in the safe command into the dangerous one.

Each was reproduced before being fixed. The common cause is treating a path as the string that names it, and treating a filter as best-effort. That is fine for "which files go in the bundle" and wrong for "which directory gets deleted" — and `.gitignore` had quietly become the second kind, because the docs promise it keeps secrets out.

## Decision

Three invariants, each enforced by a regression test that fails when reverted.

**Output ownership — srcpack deletes and writes only what it owns.** Automatic emptying applies to the conventional `.srcpack` and nothing else; any other `outDir` requires `emptyOutDir: true`. Ownership is decided on the physical path (`realpath`), so a symlink cannot redirect a deletion into a directory that merely looks like srcpack's — and because the name is a claim about a place, a `.srcpack` that resolves elsewhere fails the run rather than quietly writing there. Bundles are written to a temp file and renamed into position, which replaces the directory entry instead of following a link that sits on it.

A path therefore has two identities, and both are load-bearing. Its _entry_ identity — ancestors resolved, the entry itself left alone, because `rename` replaces it rather than following it — decides whether two bundles are the same file; resolution walks up to the deepest ancestor that exists, so an alias hidden behind a directory `mkdir -p` has yet to create is still caught. Its _lexical_ identity is what a glob rooted at a symlink produces. Excluding srcpack's own output from a bundle needs both, since either spelling can name the file the previous run wrote.

Both comparisons reduce a path to a canonical spelling — Unicode NFC, then case folded — on every platform. A case-insensitive filesystem, the default on macOS and Windows though neither is a reliable proxy for it, treats `Context.txt` and `context.txt` as one directory entry; APFS folds normalisation too, so `Café` written precomposed and decomposed is also one entry. Normalising before folding is what makes the comparison sound, since equal inputs then stay equal whether or not case folding preserves normalisation. `realpath` canonicalises an existing component to its on-disk spelling, which is why an existing `.SRCPACK` is caught as a redirected `.srcpack` rather than emptied; but it cannot help where the difference actually bites, since an output not yet written has no on-disk spelling and the destination entry is deliberately left unresolved. The rule does not vary by filesystem: a config that works in Linux CI and silently loses a bundle on the author's laptop is worse than one rejected identically everywhere.

Ownership stays an exact match, because folding there could only widen what gets deleted. A directory named `.SRCPACK` is consequently never the one srcpack clears unasked — refused as a redirected `.srcpack` where case folds, simply unrelated where it doesn't.

**Input boundary — a bundle cannot leave the project by accident.** Globs no longer follow symlinks at any level, and `.gitignore` is resolved the way git resolves it: per directory, deepest rule first, with no re-inclusion under an ignored directory. An unreadable ignore file fails the run rather than widening the source set — only a missing one means "no rules". Explicit external patterns (`../`, absolute, `+`) remain the deliberate way out.

**Intent boundary — a token that changes what a run destroys or publishes is never a silent no-op.** Unknown CLI flags, unknown config keys, bundle names that aren't filenames, and `upload.exclude` entries naming no bundle are all errors.

## Alternatives

- **An ownership manifest** — record what srcpack created and delete only that. Strictly safer, and it buys nothing over the convention: a directory named `.srcpack` that srcpack writes to is already an adequate claim, and a manifest is state to keep in sync.
- **A blacklist of dangerous directory names** (`src`, `docs`, …) — enumerating what must not be deleted never terminates. The question isn't which names are precious, it's which single directory is ours.
- **Keeping auto-empty for custom directories and warning instead** — a warning scrolls past in the same run that does the deleting.
- **Temp directory plus atomic swap for writes** — the right fix for the remaining gap (see below), but a separate change with its own failure modes.

## Consequences

`emptyOutDir` changes behaviour for anyone with a custom `outDir`: it no longer empties unless asked. Stale files are a nuisance; deleted sources are not, and 0.x is the time to take that break.

Per-directory ignore resolution costs one extra glob for `**/.gitignore`, pruned by the root file's own directory patterns. Bundles that relied on a symlinked directory need an explicit external pattern, which is the honest spelling.

Each file is now replaced atomically, but a run is not: `outDir` is emptied only after every bundle resolves, yet a failure partway through the writes can still leave some bundles new and others missing. A temp directory swapped in as a whole is the fix when that becomes worth doing.
