# Architecture Decisions

Records of the decisions that shaped srcpack: what was chosen, what was
rejected, and the reasoning at the time. Written when the decision is made,
so they capture the trade-offs rather than a tidied-up version of them.

A record is never rewritten once accepted. When a decision is reversed, a new
record supersedes it.

| ADR                                            | Decision                                                    | Status              |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------------- |
| [001](./001-git-source-tokens.md)              | `git:` source tokens in the pattern language                | Accepted 2026-08-15 |
| [002](./002-minimum-node-version.md)           | Node 22.18 as the minimum runtime                           | Accepted 2026-08-15 |
| [003](./003-linear-issues-as-virtual-files.md) | Linear issues as virtual files, under a `linear` bundle key | Accepted 2026-08-15 |
| [004](./004-path-boundaries.md)                | What srcpack may read, delete and overwrite                 | Accepted 2026-08-15 |
