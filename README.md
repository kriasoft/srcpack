# Srcpack

Zero-config CLI for bundling code into LLM-optimized context files.

**Requirements:** Node.js 20+ or Bun

## Quick Start

```bash
npx srcpack init         # Create config interactively
npx srcpack              # Bundle all
```

## Why

LLM context fails when codebases are large, noisy, or poorly organized. Srcpack lets you split code into semantic bundles (e.g., `web`, `api`, `docs`) with clear file boundaries and an index header—optimized for ChatGPT, Claude, Gemini, etc.

## Configuration

Create `srcpack.config.ts` in your project root:

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

| Option    | Default    | Description                      |
| --------- | ---------- | -------------------------------- |
| `outDir`  | `.srcpack` | Output directory for bundles     |
| `bundles` | —          | Named bundles with glob patterns |
| `upload`  | —          | Upload destination(s)            |

### Bundle Config

```typescript
// Simple glob
"src/**/*"

// Array with exclusions (! prefix)
["src/**/*", "!src/**/*.test.ts"]

// Force-include gitignored files (+ prefix)
["docs/**/*", "+docs/**/*.local.md"]

// Full options
{
  include: "src/**/*",
  outfile: "~/Downloads/bundle.txt",   // custom output path
  index: true                          // include index header (default)
}
```

Patterns follow glob syntax. Prefix with `!` to exclude, `+` to force-include (bypasses `.gitignore`). Binary files are excluded.

### Google Drive Upload

To upload bundles to Google Drive, add OAuth credentials to your config:

```typescript
export default defineConfig({
  bundles: {
    /* ... */
  },
  upload: {
    provider: "gdrive",
    folderId: "1ABC...", // Google Drive folder ID (from URL)
    clientId: "...",
    clientSecret: "...",
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
npx srcpack              # Bundle all, upload if configured
npx srcpack web api      # Bundle specific bundles only
npx srcpack --dry-run    # Preview without writing files
npx srcpack --no-upload  # Bundle only, skip upload
npx srcpack init         # Interactive config setup
npx srcpack login        # Authenticate with Google Drive
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
