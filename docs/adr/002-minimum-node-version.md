# ADR 002: Node 22.18 as the minimum runtime

**Status:** Accepted — 2026-08-15

## Context

`srcpack.config.ts` is the primary config format — the first entry in
`searchPlaces`, and what `srcpack init` writes. Loading TypeScript at runtime
is therefore not optional, and until now cosmiconfig carried its own
`typescript` dependency to do it.

cosmiconfig 10 removes that dependency in favour of Node's built-in type
stripping, and requires `^22.18 || >=24`. Type stripping is enabled by default
from Node 22.18, so the loader works on any runtime cosmiconfig itself accepts —
but on Node 20 a `.ts` config now fails to load at all.

The declared floor was `>=18.0.0`, which had already drifted from reality:
Node 18 reached end-of-life 2025-04-30 and Node 20 followed on 2026-04-30.

## Decision

`engines.node` becomes `^22.18.0 || >=24`, matching cosmiconfig's own range
rather than inventing a looser one.

Pinning to the dependency's range is deliberate. A floor of `>=20` would install
cleanly and then fail at the first `srcpack.config.ts` — the failure would
surface as a confusing parse error rather than an unmet engine warning at
install time.

## Alternatives

- **Keep `>=18` and bundle a TypeScript parser** — restores Node 20 support at
  the cost of a heavyweight dependency for a runtime everyone's package manager
  already warns about.
- **Drop `.ts` config support below Node 22.18, keep the floor low** — two
  behaviours for one documented feature, discovered only at run time.

## Consequences

Config files must use erasable syntax only. Type annotations, `satisfies`, and
`import type` are fine; `enum` and `namespace` are not — Node strips types, it
does not compile them. `defineConfig` objects use none of the latter, so the
`init` template and every documented example are unaffected.

Node also derives a `.ts` file's module format from the nearest package.json
`type`, so in a CommonJS project the template's `import { defineConfig }` line
is a syntax error — the bundled TypeScript compiler used to hide this. So
`srcpack.config.mts` joins `searchPlaces`, and `init` writes it whenever the
project is not `"type": "module"`. `.mts` is unconditionally ESM and loads
either way; `.ts` stays the default for ESM projects because it is the name
the docs use.

The test suite runs on Bun, which loads either extension regardless of package
type and so cannot see this class of failure. CI installs the packed tarball
into a CommonJS project and runs the CLI under Node to cover it.

Both EOL runtimes are dropped in one step, so the next floor bump can wait for
a real forcing function rather than following each dependency's minor releases.
