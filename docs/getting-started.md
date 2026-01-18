# Getting Started

Bundle your codebase into LLM-optimized context files. Get precise, grounded answers from ChatGPT, Claude, Gemini, and other AI tools.

## Prerequisites

- Node.js 20+ or Bun
- A codebase you want to share with AI

## Quick Start

::: code-group

```sh [npm]
npx srcpack init
```

```sh [bun]
bunx srcpack init
```

```sh [pnpm]
pnpm dlx srcpack init
```

```sh [yarn]
yarn dlx srcpack init
```

:::

This creates a `srcpack.config.ts` file with bundles based on your project structure.

Then run:

::: code-group

```sh [npm]
npx srcpack
```

```sh [bun]
bunx srcpack
```

```sh [pnpm]
pnpm dlx srcpack
```

```sh [yarn]
yarn dlx srcpack
```

:::

Your bundles are now in `.srcpack/` — ready to upload to any AI chat.

## Your First Bundle

Create `srcpack.config.ts` in your project root:

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  bundles: {
    app: "src/**/*",
  },
});
```

Run the bundle command and you'll see:

```
✓ app  →  .srcpack/app.txt  (12 files, 2.4 KB)
```

## Understanding the Output

Srcpack generates an indexed bundle optimized for AI consumption:

```text
# Index (3 files)
# [1]   src/index.ts  L1-L42
# [2]   src/utils.ts  L43-L89
# [3]   src/api.ts    L90-L150

#==> [1] src/index.ts <==
import { utils } from "./utils";
...

#==> [2] src/utils.ts <==
export function utils() {
...
```

**Why this format matters:**

- **Numbered index** — AI can reference `[2] src/utils.ts` in responses
- **Line numbers** — Answers include exact locations like `L43-L89`
- **`#` prefix** — Safe to paste inside markdown code blocks

When you ask "How does the auth flow work?", AI responds with:

> The auth flow starts in `[3] src/api.ts:L92` where...

## Using with AI

1. Open [ChatGPT](https://chat.openai.com), [Claude](https://claude.ai), or your preferred AI
2. Upload `.srcpack/app.txt` or paste its contents
3. Ask questions about your code

**Example prompts:**

- "Explain how the main entry point works"
- "Find where errors are handled"
- "What would break if I renamed the `User` type?"

The AI answers are grounded in your actual code, with file and line references.

## Configuration Patterns

### Multiple Bundles

Split your codebase into semantic domains:

```ts
export default defineConfig({
  bundles: {
    web: "apps/web/**/*",
    api: "apps/api/**/*",
    shared: "packages/shared/**/*",
  },
});
```

### Exclusions

Use `!` prefix to exclude patterns:

```ts
export default defineConfig({
  bundles: {
    api: ["src/**/*", "!src/**/*.test.ts", "!src/**/*.spec.ts"],
  },
});
```

### Custom Output Path

```ts
export default defineConfig({
  bundles: {
    docs: {
      include: "docs/**/*.md",
      outfile: "~/Downloads/docs-bundle.txt",
    },
  },
});
```

## CLI Reference

::: code-group

```sh [npm]
npx srcpack              # Bundle all
npx srcpack web api      # Bundle specific bundles only
npx srcpack --dry-run    # Preview without writing
npx srcpack --no-upload  # Skip upload even if configured
```

```sh [bun]
bunx srcpack              # Bundle all
bunx srcpack web api      # Bundle specific bundles only
bunx srcpack --dry-run    # Preview without writing
bunx srcpack --no-upload  # Skip upload even if configured
```

```sh [pnpm]
pnpm dlx srcpack              # Bundle all
pnpm dlx srcpack web api      # Bundle specific bundles only
pnpm dlx srcpack --dry-run    # Preview without writing
pnpm dlx srcpack --no-upload  # Skip upload even if configured
```

```sh [yarn]
yarn dlx srcpack              # Bundle all
yarn dlx srcpack web api      # Bundle specific bundles only
yarn dlx srcpack --dry-run    # Preview without writing
yarn dlx srcpack --no-upload  # Skip upload even if configured
```

:::

## Next Steps

- [Configuration Reference](./configuration.md) — All options explained
- [Google Drive Upload](./upload.md) — Auto-sync bundles to the cloud
- [CLI Reference](./cli.md) — Full command documentation
- [Discord](https://discord.com/invite/aG83xEb6RX) — Questions and discussion
