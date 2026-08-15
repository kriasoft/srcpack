# Configuration

Srcpack looks for configuration in the following order:

1. `srcpack.config.ts` (recommended)
2. `srcpack.config.mts`
3. `srcpack.config.js`
4. `srcpack` field in `package.json`

## Config File Format

Node decides a `.ts` file's module format from the nearest `package.json`, so
in a CommonJS project — the `npm init` default — the `import` line in a
`.ts` config fails to parse. Use `.mts` there: it is unconditionally ESM and
loads in both kinds of project.

`srcpack init` picks the right extension for you. If you are writing the file
by hand:

| Your `package.json`      | Use                  |
| ------------------------ | -------------------- |
| `"type": "module"`       | `srcpack.config.ts`  |
| no `type`, or `commonjs` | `srcpack.config.mts` |

Config files are type-stripped, not compiled, so they must use erasable syntax
— type annotations and `import type` are fine, `enum` and `namespace` are not.

## Basic Structure

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  outDir: ".srcpack",
  bundles: {
    // bundle definitions
  },
  upload: {
    // optional upload config
  },
});
```

## Options

| Option        | Type      | Default         | Description                           |
| ------------- | --------- | --------------- | ------------------------------------- |
| `root`        | `string`  | `process.cwd()` | Project root directory                |
| `outDir`      | `string`  | `.srcpack`      | Output directory (relative to root)   |
| `emptyOutDir` | `boolean` | `true`\*        | Empty output directory before writing |
| `bundles`     | `object`  | —               | Named bundles (required)              |
| `upload`      | `object`  | —               | Upload destination                    |

\*Only for the default `.srcpack`. Any other `outDir` defaults to `false` and must opt in with `emptyOutDir: true` — srcpack deletes nothing it doesn't own by convention.

An unknown key anywhere in the config is an error rather than an ignored line. A silently dropped `emptyOutdir` or `exlude` would keep the default in force and read as if it had been set.

### root

Project root directory where files are bundled from. Can be absolute or relative to CWD.

```ts
export default defineConfig({
  root: "./packages/app", // bundle from subdirectory
  bundles: {
    app: "src/**/*", // matches packages/app/src/**/*
  },
});
```

### outDir

Output directory for bundle files. Can be absolute or relative to project root.

```ts
export default defineConfig({
  root: "./packages/app",
  outDir: "dist", // writes to packages/app/dist/
  bundles: {
    app: "src/**/*",
  },
});
```

Only the default `.srcpack` is emptied automatically. It is srcpack's directory
by convention, so clearing it is safe; every other `outDir` is somewhere you
chose, and `outDir: "src"` would otherwise turn a bundling run into a wipe of
the sources it was asked to bundle. Set `emptyOutDir: true` to opt in, or clean
up yourself.

Ownership is decided by physical path. A `.srcpack` that turns out to be a
symlink somewhere else fails the run: the name claims one specific place, and
both the emptying and the writes would land somewhere it doesn't say. Name that
directory as `outDir` instead. Pointing `outDir` at the root (`"."`) with
`emptyOutDir: true` is refused for the same reason — it would delete the
project.

Emptying waits until every bundle has resolved, immediately before the new
files are written. A run that fails while resolving — an unreadable `.gitignore`, an expired
`LINEAR_API_KEY` — leaves the previous output intact.

Emptying only happens on a full run. `srcpack web` leaves the bundles it isn't
building in place, since it has no way to tell which of them are stale.

## Bundle Definitions

Each bundle can be defined in three ways:

### String (Simple Glob)

```ts
bundles: {
  app: "src/**/*",
}
```

### Array (Multiple Patterns)

Use `!` prefix to exclude:

```ts
bundles: {
  api: ["src/**/*", "!src/**/*.test.ts"],
}
```

### Object (Full Options)

```ts
bundles: {
  docs: {
    include: "docs/**/*.md",
    outfile: "~/Downloads/docs.txt",
    index: false,
  },
}
```

**Bundle options:**

| Option    | Type                 | Default               | Description                               |
| --------- | -------------------- | --------------------- | ----------------------------------------- |
| `include` | `string \| string[]` | —                     | Glob pattern(s)                           |
| `linear`  | `string \| object`   | —                     | Linear issues (see below)                 |
| `outfile` | `string`             | `{outDir}/{name}.txt` | Custom output path                        |
| `index`   | `boolean`            | `true`                | Include index header                      |
| `prompt`  | `string`             | —                     | Text or file path (`./`, `~/`) to prepend |

A bundle needs at least one source: `include`, `linear`, or both.

Two bundles may not write to the same file. Names that differ only by case, or
only in Unicode normalisation, count as the same file everywhere: on a
case-insensitive filesystem — the default on macOS and Windows — `Web.txt` and
`web.txt` are one directory entry, and APFS treats the two spellings of `Café`
the same way, so one bundle would silently overwrite the other.

## Pattern Syntax

Patterns follow standard glob syntax with special prefixes:

| Pattern          | Matches                            |
| ---------------- | ---------------------------------- |
| `src/**/*`       | All files under `src/`             |
| `*.ts`           | TypeScript files in root           |
| `**/*.ts`        | TypeScript files anywhere          |
| `!**/*.test.ts`  | Exclude test files                 |
| `+**/*.local.md` | Force-include, bypass `.gitignore` |
| `{src,lib}/**/*` | Files in `src/` or `lib/`          |
| `git:staged`     | Staged changes (see below)         |

### Force-Include (`+` prefix)

Use `+` to include files that would normally be excluded by `.gitignore`:

```ts
bundles: {
  docs: [
    "docs/**/*",           // all docs (respects .gitignore)
    "+docs/**/*.local.md", // force-include local notes
  ],
}
```

### Git Sources (`git:` prefix)

A pattern can name a set of changed files instead of a glob:

| Source          | Files                                                 |
| --------------- | ----------------------------------------------------- |
| `git:staged`    | Staged changes (index vs `HEAD`)                      |
| `git:unstaged`  | Unstaged changes to tracked files (worktree vs index) |
| `git:untracked` | New files not ignored by git                          |
| `git:dirty`     | All three combined                                    |
| `git:<rev>`     | Changes vs `<rev>` (e.g. `git:main`, `git:HEAD~3`)    |

```ts
bundles: {
  review: {
    include: ["git:staged", "!bun.lock"],
    prompt: "Review these changes for correctness.",
  },
}
```

Git sources mix freely with each other, with globs, and with `!` exclusions:

```ts
bundles: {
  pr: ["git:main", "git:untracked", "docs/architecture.md", "!**/*.snap"],
}
```

Notes:

- **A git source picks _which_ files to bundle; content always comes from the worktree.** If a file is staged and then edited again, `git:staged` bundles the current version on disk, not the staged blob.
- **`git:<rev>` compares against the merge base**, so a branch that has fallen behind `main` still reports only your own changes. Uncommitted edits to tracked files are included; untracked files are not — add `git:untracked` for those. Ranges (`git:main...HEAD`, `git:HEAD~3..HEAD`) pass through to git verbatim and cover committed changes only. Requires git 2.30+.
- **Deleted files are skipped** — there is nothing left to read. Same for binary files and submodules.
- **Symlinks are skipped**, in git sources and globs alike. A tracked link like `notes.txt -> ~/.ssh/id_rsa` would otherwise pull a file from outside the project into a bundle you might upload. Point a pattern at the real path instead.
- **`.gitignore` does not apply.** A file tracked despite `.gitignore` (force-added) is included; an ignored file is never reported by git in the first place.
- **A branch named `staged` is shadowed** by the named source. Use `git:refs/heads/staged` to disambiguate.
- **An empty result writes no file**, and clears a stale one from a previous run, so a bundle never holds changes you've since committed. A custom `outfile` outside `outDir` is left alone.
- `!git:...` and `+git:...` are errors: exclusion has no clear meaning, and force-include is already implied.

## Linear Issues

A bundle can pull issues from [Linear](https://linear.app) alongside your code. Each issue becomes a virtual file at `linear/issues/<identifier>.md`, so it gets its own index entry and line range:

```
# Index (4 files)
# [1]  docs/roadmap.md            L7-L92   (86 lines)
# [2]  linear/issues/ENG-123.md   L94-L121 (28 lines)
# [3]  linear/issues/ENG-148.md   L123-L158 (36 lines)
# [4]  src/board.ts               L160-L288 (129 lines)
```

That lets you ask an LLM things like _"does `[4] src/board.ts` actually implement `[2] ENG-123`?"_

### Setup

Create a personal API key in Linear (**Settings → Security & access → Personal API keys**) and export it:

```bash
export LINEAR_API_KEY=lin_api_...
```

The key is read from the environment, never from the config file — config files get committed.

### Usage

```ts
bundles: {
  // Shorthand: every non-terminal issue for team ENG
  backlog: { linear: "ENG" },

  // Code and the tickets that describe it, in one context file
  planning: {
    include: ["docs/**/*.md", "src/**/*.ts"],
    linear: { team: "ENG", project: "Roadmap" },
    prompt: "Which roadmap items are already implemented?",
  },
}
```

**Linear options:**

| Option          | Type      | Default | Description                                            |
| --------------- | --------- | ------- | ------------------------------------------------------ |
| `team`          | `string`  | —       | Required. Team key — the `ENG` in `ENG-123`            |
| `project`       | `string`  | —       | Project name. Must match exactly one project in `team` |
| `includeClosed` | `boolean` | `false` | Include completed, canceled and duplicate issues       |

The string form `linear: "ENG"` is shorthand for `{ team: "ENG" }`.

Notes:

- **The default is every non-terminal issue**, not "active" in Linear's sense. Triage, Backlog, Todo and In Progress are all included; only the `completed`, `canceled` and `duplicate` state types are left out.
- **`includeClosed` does not reach archived issues.** Linear omits archived resources from ordinary responses, and srcpack does not ask for them, so `includeClosed: true` means "terminal issues too", not "all history".
- **`team` is required.** A workspace-wide fetch looks harmless in config and can pull thousands of issues into a context window. Declare one bundle per team if you need several.
- **Issues obey `!` exclusions like any other entry**, so you can drop individual tickets: `include: ["!linear/issues/ENG-7.md"]`.
- **A typo fails loudly.** An unknown team or project raises an error rather than producing an empty bundle; a project name matching two projects is rejected as ambiguous rather than silently merging both; and an unknown option key (`projet`) is rejected rather than ignored, which would quietly widen the bundle to the whole team.
- **Labels are capped at 50 per issue**, a deliberate context budget rather than a paginated read.
- **Issues travel with the bundle.** Issue text is ordinary bundle content, so a configured upload sends it to Google Drive alongside your code. Add the bundle to [`upload.exclude`](#upload-configuration) to keep it local.
- **`--dry-run` still calls the API**, because it has to in order to answer "what would this produce right now". There is no cache; a run without network access fails. Requests time out after 30 seconds.
- **`linear/issues/` is reserved** once a bundle pulls issues. A file on disk at that path is an error: two entries would share one name, and an `!` exclusion drops both rather than choosing. Rename the file, or narrow the include patterns so it isn't matched.

## Automatic Exclusions

Srcpack skips:

- Files matching `.gitignore` — including `node_modules/`, build output, and
  secrets, since those are already ignored in any normal project. Nested
  `.gitignore` files count too, resolved the way git resolves them: the rule in
  the deepest directory wins, and nothing under an ignored directory is
  re-included. A monorepo's `packages/app/.gitignore` hides its `.env` here
  exactly as it does for git.
- Binary files (images, fonts, compiled assets), detected by content
- Symlinks, so a link can't pull in a file from outside the project — including
  symlinked directories, which are not walked into
- Its own output — `outDir` and every configured `outfile`. Otherwise a rerun
  would bundle the previous run's file, nesting it again each time.

Everything else matched by a pattern is included, so exclude what you don't
want explicitly: `["src/**/*", "!bun.lock"]`.

## Examples

### Monorepo

```ts
export default defineConfig({
  bundles: {
    web: "apps/web/**/*",
    api: "apps/api/**/*",
    shared: "packages/shared/**/*",
  },
});
```

### Frontend + Backend

```ts
export default defineConfig({
  bundles: {
    client: ["src/client/**/*", "src/shared/**/*"],
    server: ["src/server/**/*", "src/shared/**/*"],
  },
});
```

### Exclude Tests and Mocks

```ts
export default defineConfig({
  bundles: {
    app: [
      "src/**/*",
      "!src/**/*.test.ts",
      "!src/**/*.spec.ts",
      "!src/**/__mocks__/**",
    ],
  },
});
```

### Code Review Bundle

```ts
export default defineConfig({
  bundles: {
    review: {
      include: "src/**/*",
      prompt: "./prompts/review.md", // or inline: "Review this code..."
    },
  },
});
```

### Package.json Config

```json
{
  "srcpack": {
    "bundles": {
      "app": "src/**/*",
      "backlog": { "linear": "ENG" }
    }
  }
}
```

Every bundle option is plain JSON, Linear included — its API key comes from the
environment, so nothing here needs `process.env`.

## Upload Configuration

Configure cloud upload destinations. See [Google Drive Upload](/upload) for setup details.

```ts
export default defineConfig({
  bundles: {/* ... */},
  upload: {
    provider: "gdrive",
    folderId: "1ABC...",
    clientId: process.env.GDRIVE_CLIENT_ID,
    clientSecret: process.env.GDRIVE_CLIENT_SECRET,
    exclude: ["local"], // skip these bundles
  },
});
```

**Upload options:**

| Option         | Type       | Default | Description                        |
| -------------- | ---------- | ------- | ---------------------------------- |
| `provider`     | `"gdrive"` | —       | Upload provider (required)         |
| `folderId`     | `string`   | —       | Target folder ID (optional)        |
| `clientId`     | `string`   | —       | OAuth client ID (required)         |
| `clientSecret` | `string`   | —       | OAuth client secret (required)     |
| `exclude`      | `string[]` | —       | Bundle names to skip during upload |

Every name in `exclude` must match a configured bundle. A name that matches nothing is an error, since the alternative is uploading a bundle you meant to keep local.

## TypeScript Support

The `defineConfig` helper provides type checking and autocomplete:

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  // Full autocomplete here
});
```
