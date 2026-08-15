# Srcpack

Zero-config CLI for bundling code into LLM-optimized context files.

**Requirements:** Node.js 22.18+ or Bun

## Quick Start

```bash
npx srcpack init         # Create config interactively
npx srcpack              # Bundle all
```

## Why

LLM context fails when codebases are large, noisy, or poorly organized. Srcpack lets you split code into semantic bundles (e.g., `web`, `api`, `docs`) with clear file boundaries and an index header—optimized for ChatGPT, Claude, Gemini, etc.

## Configuration

Create `srcpack.config.ts` in your project root (use `srcpack.config.mts` if your `package.json` lacks `"type": "module"` — `srcpack init` picks the right one):

```typescript
import { defineConfig } from "srcpack";

export default defineConfig({
  bundles: {
    web: "apps/web/**/*",
    api: ["apps/api/**/*", "!apps/api/**/*.test.ts"],
    docs: {
      include: "docs/**/*",
      index: false, // disable index header
    },
  },
});
```

Or add to `package.json`:

```json
{
  "srcpack": {
    "bundles": {
      "web": "apps/web/**/*"
    }
  }
}
```

### Options

| Option        | Default    | Description                           |
| ------------- | ---------- | ------------------------------------- |
| `outDir`      | `.srcpack` | Output directory for bundles          |
| `emptyOutDir` | `true`\*   | Empty output directory before writing |
| `bundles`     | —          | Named bundle definitions              |
| `upload`      | —          | Upload destination(s)                 |

\*Only the default `.srcpack` is emptied automatically — it's srcpack's directory by convention. Any other `outDir` needs an explicit `emptyOutDir: true`, so `outDir: "src"` can't quietly delete your sources. Emptying also happens only on a full run, so `npx srcpack web` leaves other bundles in place.

### Bundle Config

```typescript
// Simple glob
"src/**/*"

// Array with exclusions (! prefix)
["src/**/*", "!src/**/*.test.ts"]

// Force-include gitignored files (+ prefix)
["docs/**/*", "+docs/**/*.local.md"]

// Changed files instead of a glob (git: prefix)
["git:staged", "!bun.lock"]

// Full options
{
  include: "src/**/*",
  linear: { team: "ENG" },             // Linear issues as virtual files
  outfile: "~/Downloads/bundle.txt",   // custom output path
  index: true,                         // include index header (default)
  prompt: "./prompts/review.md"        // prepend from file (or inline text)
}
```

Patterns follow glob syntax. Prefix with `!` to exclude, `+` to force-include (bypasses `.gitignore`). Binary files are excluded.

A pattern can also name a set of changed files: `git:staged`, `git:unstaged`, `git:untracked`, `git:dirty`, or `git:<rev>` (e.g. `git:main`, `git:HEAD~3`). Deleted files are skipped, and `git:<rev>` compares against the merge base so a stale branch still reports only your own changes. See [Git sources](https://kriasoft.com/srcpack/configuration#git-sources-git-prefix).

### Linear Issues

A bundle can include [Linear](https://linear.app) issues next to your code. Each issue becomes a virtual file at `linear/issues/ENG-123.md`, so it gets its own index entry and line range — letting you ask whether `[4] src/board.ts` actually implements `[2] ENG-123`.

```typescript
bundles: {
  backlog: { linear: "ENG" },                       // non-terminal issues, team ENG
  planning: {
    include: ["docs/**/*.md"],
    linear: { team: "ENG", project: "Roadmap" },    // scoped to one project
  },
}
```

Authentication reads `LINEAR_API_KEY` from the environment (Linear → Settings → Security & access → Personal API keys), never from the config file. `team` is required, completed/canceled/duplicate issues are excluded by default, and issues obey `!` exclusions like any other entry. See [Linear issues](https://kriasoft.com/srcpack/configuration#linear-issues).

### Google Drive Upload

To upload bundles to Google Drive, add OAuth credentials to your config:

```typescript
export default defineConfig({
  bundles: {/* ... */},
  upload: {
    provider: "gdrive",
    folderId: "1ABC...", // Google Drive folder ID (from URL)
    clientId: "...",
    clientSecret: "...",
    exclude: ["local"], // skip specific bundles
  },
});
```

**Setup:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable the Google Drive API
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Select **Desktop app**, then copy the client ID and secret
6. Run `npx srcpack login` to authenticate

## Output Format

```text
# Index (3 files)
# [1]   src/index.ts  L1-L42 (42 lines)
# [2]   src/utils.ts  L43-L89 (47 lines)
# [3]   src/api.ts    L90-L150 (61 lines)

#==> [1] src/index.ts <==
import { utils } from "./utils";
...

#==> [2] src/utils.ts <==
export function utils() {
...
```

- Numbered entries for easy cross-reference in conversations
- Line ranges point to actual content lines
- `#` prefix keeps format safe inside code blocks

## CLI

```bash
npx srcpack                 # Bundle all, upload if configured
npx srcpack web api         # Bundle specific bundles only
npx srcpack --staged        # Bundle staged changes (no config needed)
npx srcpack --dirty         # Bundle staged + unstaged + untracked
npx srcpack --since main    # Bundle changes since main
npx srcpack --dry-run       # Preview without writing files
npx srcpack --emptyOutDir   # Empty output directory before writing
npx srcpack --no-emptyOutDir # Keep existing files in output directory
npx srcpack --no-upload     # Bundle only, skip upload
npx srcpack init            # Interactive config setup
npx srcpack login           # Authenticate with Google Drive
```

## API

```typescript
import { defineConfig, loadConfig } from "srcpack";

// In config files
export default defineConfig({
  bundles: { web: "apps/web/**/*" },
});

// Programmatic
const config = await loadConfig();
```

## LLM Context

- https://kriasoft.com/srcpack/llms.txt
- https://kriasoft.com/srcpack/llms-full.txt

## Community

- [Discord](https://discord.com/invite/aG83xEb6RX) — Questions, feedback, and discussion
- [GitHub Issues](https://github.com/kriasoft/srcpack/issues) — Bug reports and feature requests

New contributors and OSS maintainers are welcome — join us on Discord or open an issue / PR.

## Backers

<a href="https://reactstarter.com/b/1"><img src="https://reactstarter.com/b/1.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/2"><img src="https://reactstarter.com/b/2.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/3"><img src="https://reactstarter.com/b/3.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/4"><img src="https://reactstarter.com/b/4.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/5"><img src="https://reactstarter.com/b/5.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/6"><img src="https://reactstarter.com/b/6.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/7"><img src="https://reactstarter.com/b/7.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/8"><img src="https://reactstarter.com/b/8.png" height="60" /></a>

## License

MIT
