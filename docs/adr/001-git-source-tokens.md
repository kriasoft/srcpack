# ADR 001: `git:` source tokens in the pattern language

**Status:** Accepted — 2026-08-15

## Context

Bundling "what I'm currently changing" is the most common ad-hoc need: hand an
LLM your staged diff, or everything on this branch, for review. Globs can't
express it — the file set comes from git, not from the filesystem layout.

The obvious-looking API spreads a resolved list into the pattern array:

```ts
review: [...$staged, "!bun.lock"];
```

It reads well and it's wrong. A spread forces `$staged` to be concrete at
config **import** time, which means git runs when the module loads (even for
`srcpack docs`), the config stops being inspectable data, `package.json` config
becomes impossible, and import-time `cwd` may differ from the resolved `root`.
Worst of all, concrete paths land in an array that is later matched as globs,
so a staged file named `src/[id].tsx` silently matches nothing.

## Decision

A pattern may be a `git:` source instead of a glob, resolved lazily inside
`resolvePatterns()` alongside globs:

```ts
review: ["git:staged", "!bun.lock"];
```

Sources: `git:staged`, `git:unstaged`, `git:untracked`, `git:dirty`, and
`git:<rev>` for any revision or range.

CLI flags `--staged`, `--dirty`, and `--since <rev>` build a one-off bundle from
the same tokens, and work with no config file at all.

Supporting decisions:

- **Deleted and unmerged entries are filtered** (`--diff-filter=ACMR`), and
  every candidate is stat-checked before bundling. Git lists paths; only some
  of them are readable regular files (submodules, or a file deleted after git
  listed it).
- **`git:<rev>` uses `git diff --merge-base`** for a single revision. `git:main`
  on a branch that has fallen behind main would otherwise report other people's
  commits. For an ancestor like `HEAD~3` the merge base is the revision itself,
  so this is a no-op — one rule that's right in both cases. Ranges pass through
  verbatim.
- **A source selects paths; content always comes from the worktree.** Reading
  staged blobs would put content in the bundle that doesn't match the files on
  disk — confusing when the LLM's answer cites a line.
- **`.gitignore` does not apply** to git sources. Anything git reports is either
  tracked (possibly force-added past `.gitignore`, and deliberately so) or was
  filtered by `--exclude-standard` already.
- **`!git:...` and `+git:...` are errors.** Exclusion has no clear meaning, and
  force-include is already implied. Failing loudly beats a silent no-op.
- **Empty bundles are not written**, and a previous run's file is removed.
  "Nothing staged" is routine, and a stale bundle that then gets uploaded to
  Drive is worse than no file.
- **Symlinks are never followed** (`lstat`, not `stat`). Git happily tracks a
  link pointing anywhere; following one would bundle a file from outside the
  project under an innocuous in-repo name.
- **Ad-hoc CLI bundles are never uploaded.** The user configured upload for the
  bundles they declared, and `upload.exclude` cannot name a bundle that only
  exists for one run.
- **`outDir` and every configured `outfile` are excluded from every bundle.**
  Ad-hoc runs don't empty `outDir`, so `git:untracked` reports the last run's
  bundle and each rerun nests it one level deeper.

## Alternatives

- **Typed helpers** (`[staged(), "!bun.lock"]`) — real autocomplete, but the
  array becomes `(string | Source)[]`, it can't work in `package.json`, and it
  adds permanent public exports.
- **A `from` field** (`{ from: "staged", include: "src/**" }`) — conceptually
  cleaner (a source isn't a glob), but adds a second axis plus an `exclude`
  field, giving two ways to say the same thing.
- **An async resolver** (`include: async ({ git }) => …`) — maximum power, but
  the config is no longer data and `git.*` becomes an API to maintain.

## Consequences

The pattern array gains a second kind of entry, so `git:` is now reserved as a
scheme (a branch named `staged` needs `git:refs/heads/staged`). In exchange
there is no new config shape, no new export, and the feature composes with `!`
exclusions and globs for free. Future non-glob sources can reuse the
`scheme:` convention.
