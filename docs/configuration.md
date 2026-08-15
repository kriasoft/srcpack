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

| Option        | Type      | Default         | Description                            |
| ------------- | --------- | --------------- | -------------------------------------- |
| `root`        | `string`  | `process.cwd()` | Project root directory                 |
| `outDir`      | `string`  | `.srcpack`      | Output directory (relative to root)    |
| `emptyOutDir` | `boolean` | `true`\*        | Empty output directory before bundling |
| `bundles`     | `object`  | —               | Named bundles (required)               |
| `upload`      | `object`  | —               | Upload destination                     |

\*`emptyOutDir` defaults to `true` when `outDir` is inside project root.

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

`outDir` is emptied before bundling when it sits inside the project root, so
give srcpack a directory of its own. Pointing it at the root itself (`"."`)
is refused rather than emptied — that would delete the project.

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
| `outfile` | `string`             | `{outDir}/{name}.txt` | Custom output path                        |
| `index`   | `boolean`            | `true`                | Include index header                      |
| `prompt`  | `string`             | —                     | Text or file path (`./`, `~/`) to prepend |

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

## Automatic Exclusions

Srcpack skips:

- Files matching `.gitignore` — including `node_modules/`, build output, and
  secrets, since those are already ignored in any normal project
- Binary files (images, fonts, compiled assets), detected by content
- Symlinks, so a link can't pull in a file from outside the project
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
      "app": "src/**/*"
    }
  }
}
```

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

## TypeScript Support

The `defineConfig` helper provides type checking and autocomplete:

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  // Full autocomplete here
});
```
