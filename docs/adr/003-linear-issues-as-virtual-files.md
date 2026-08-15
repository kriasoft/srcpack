# ADR 003: Linear issues as virtual files, under a `linear` bundle key

**Status:** Accepted — 2026-08-15

## Context

A bundle answers questions about code. Many of those questions are really about intent — is this ticket implemented, does this code still match what we agreed — and the intent lives in an issue tracker, not the repo. Pasting both into a chat by hand is the workflow srcpack exists to remove.

[ADR 001](./001-git-source-tokens.md) closed by suggesting that "future non-glob sources can reuse the `scheme:` convention", which points at `"linear:ENG"`. That turns out to be the wrong precedent to follow here, for two reasons.

**`git:` names a closed set; Linear does not.** The git grammar is five words plus a rev, and it will never need a sixth. Linear has team, project, state, label, assignee, cycle, updated-since. The first person who wants "project X, excluding Done" forces `linear:ENG?state=open&project=roadmap` — a query DSL to parse, validate, document and keep compatible. That is the part that would not age.

**`git:` yields paths; Linear yields documents.** Every stage after `resolvePatterns()` — `lstat`, binary sniffing, `.gitignore`, `isOwnOutput` — assumes a file on disk. `git:` slots in because it still hands back worktree paths. Linear has no path to hand back.

## Decision

**Issues become virtual files.** Each issue is rendered to markdown and given a synthetic path, `linear/issues/ENG-123.md`. Internally an entry is:

```ts
interface Entry {
  path: string;
  content?: string; // present = virtual; absent = read from disk
}
```

Everything downstream then works unchanged: index numbering, `#==>` separators, line-range math, deterministic sort, and `!` exclusions all apply to issues exactly as they do to files. One file per issue, not one blob, so each issue earns its own index line and can be cited as `[2] ENG-123`.

**A roster leads the set, at `linear/issues.md`.** One file per issue makes each citable, but it also means the index — the thing a model reads first — becomes forty lines of `linear/issues/ENG-*.md`, which carry no information. For a code file the path _is_ the summary; for an issue the identifier is opaque. The roster restores that: a scope heading, a count per state, and a row per issue with state, priority and title.

It also carries the only sensible ordering. Entries sort by path as text, so `ENG-2` falls between `ENG-19` and `ENG-20`; natural-sorting the whole bundle to fix that would change ordering for every file in every bundle, which is a much larger claim than this needs. The roster is ordered by issue number instead, and the bodies keep the uniform path sort.

The path sits outside `linear/issues/` so it sorts ahead of the issues it describes (`.` precedes `/`), and it is an ordinary entry — the same collision check and `!` exclusions apply, so `!linear/issues.md` drops it.

**The surface is a `linear` key on the bundle, not a pattern token:**

```ts
bundles: {
  backlog: { linear: "ENG" },
  planning: {
    include: ["docs/**/*.md"],
    linear: { team: "ENG", project: "Roadmap" },
  },
}
```

This mirrors `upload.provider: "gdrive"` — srcpack already ships a first-party network integration, so an input provider is a shape the config already has. A zod object gives typed options and autocomplete with no grammar to invent.

Consequences of that choice, decided deliberately:

- **`include` becomes optional**, and a bundle is required to declare at least one source. A Linear-only bundle is a legitimate thing to want.
- **Auth reads `LINEAR_API_KEY` from the environment**, and is not a config field. Config files are committed; `package.json` config cannot express `process.env` at all. This differs from the `gdrive` precedent, which requires its credentials in config — that precedent is not worth copying. It also keeps the whole `linear` key expressible as plain JSON.
- **Closed config objects are strict**, and not only this one. A stripped-through `projet` would widen the query from one project to the entire team — exactly the failure the required `team` and the ambiguity check exist to prevent — but the same hazard was already there in `emptyOutdir` and `upload.exlude`, the second of which now decides whether issue text reaches Google Drive. Unknown keys are rejected across the whole config rather than in `linear` alone.
- **`team` is required.** A workspace-wide fetch reads as innocuous in config and can pull thousands of issues into a context window.
- **A project name is resolved to an id within the team**, and must match exactly one project. Names are neither unique nor stable, and filtering issues by name would silently union two projects that happen to share one.
- **Unknown team or project is an error, not an empty result.** Linear answers an unknown team key with an empty issue list, so without a preflight check a typo produces a bundle that looks successful and contains nothing.
- **A real file colliding with a synthetic path is an error.** Two entries with one name is not a coin worth flipping.
- **`--dry-run` hits the network.** A dry run answers "what would this produce right now", which it cannot do offline. No cache, no `--no-remote`.

## Alternatives

- **`"linear:ENG"` pattern token** — smallest surface today, but the filter grammar problem above makes it the worst option in a year. It holds no advantage in `package.json` config: keeping auth in the environment means the chosen `linear` key is plain JSON too.
- **A typed function in `include`** (`linear({ team: "ENG" })`) — most powerful, and it would let users write their own sources. It freezes a public plugin contract for exactly one consumer, and breaks `package.json` config. `Entry` is deliberately kept internal: it is the foundation such an API would need, if a second and third integration ever justify one.
- **A separate `srcpack-linear` package** — keeps core lean, but core is not lean in that sense already (`@googleapis/drive` is a dependency), and it costs users a second install plus a version matrix.
- **A top-level `sources` section** referenced by name from bundles — two places to configure one bundle, for no gain at one provider.

## Consequences

The bundle object gains a second axis: it now takes files, issues, or both. Each future integration would add another key rather than composing, and that is the accepted cost — if a third one arrives, the `sources: [{ provider }]` shape that `upload` already demonstrates is the natural generalization, and 0.x can take that break.

Bundling is no longer purely local for bundles that declare `linear`: those runs require network and a valid token, and their output changes when tickets change. Bundles without a `linear` key issue no requests at all.

That also forced a fix to the run order. `outDir` was emptied before bundles were resolved, so any resolution failure left the directory empty and the previous run's output gone. With a purely local source that needed a rare filesystem error; with a remote one an expired token or a rate limit does it on an ordinary afternoon. Emptying now happens after every bundle has resolved and immediately before the writes — resolution never needed the files removed, since `ownOutputs` already keeps srcpack from bundling its own output.

That makes a run resolution-safe, not atomic: a failure during the writes themselves can still leave `outDir` partially rewritten. Making that atomic wants a temp directory and a swap, which is a separate change and not one this feature forces.
