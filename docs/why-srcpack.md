# Why Srcpack

AI assistants are transforming how we work with code, but they hit a wall when your codebase doesn't fit in a single prompt. Srcpack solves this by turning your code into organized, indexed bundles that any AI can understand.

## The Problem

When you paste code into ChatGPT, Claude, or Gemini, several things go wrong:

- **Context limits** — Large codebases exceed token limits, forcing you to cherry-pick files
- **Lost structure** — Flat file dumps lose the semantic relationships between modules
- **No references** — AI answers mention "that function" but can't point to exact locations
- **Manual work** — Every conversation requires re-copying the same files

Teams waste time reformatting code for AI instead of getting answers.

## Who Benefits

### Team Leads and CTOs

Share your codebase with stakeholders who need precise answers:

- "What's the status of the payment integration?"
- "How complete is the new auth system?"
- "What would it take to add multi-tenancy?"

Upload your bundles once. Anyone with access can query the code without setting up a dev environment or reading source files directly.

### Developers

Stop manually copying files into chat windows:

- **Code reviews** — Upload a bundle, ask "Find potential bugs in the checkout flow"
- **Refactoring** — "What would break if I renamed `UserService` to `AccountService`?"
- **Debugging** — "Where does this error originate and how does it propagate?"
- **Architecture** — "How do these modules interact? Draw the dependency graph"

### New Team Members

Onboard faster by querying the codebase directly:

- "How does authentication work in this project?"
- "Where are database migrations defined?"
- "What's the pattern for adding new API endpoints?"

::: tip
The indexed output means AI answers include exact file and line references, not vague descriptions.
:::

### Technical Writers

Generate documentation grounded in actual code:

- "Document the public API of this module"
- "Write a getting-started guide based on the example code"
- "Create a changelog from recent changes"

## Use Cases

### Project Status and Planning

Bundle your codebase and share it with project managers or executives:

```
Upload: .srcpack/app.txt

"Analyze this codebase. What features are implemented vs stubbed out?
What areas have the most technical debt? Estimate complexity to add OAuth."
```

::: info
AI gives answers based on real code, not guesses.
:::

### Cross-Team Knowledge Sharing

When another team needs to understand your service:

```
Upload: .srcpack/api.txt

"We need to integrate with your user service. What endpoints are available?
What authentication does it expect? Show example request/response."
```

::: tip
No meetings required. The code explains itself.
:::

### Security Reviews

Have AI audit your code for vulnerabilities:

```
Upload: .srcpack/auth.txt

"Review this authentication code. Check for:
- SQL injection
- Missing input validation
- Insecure token handling
- OWASP Top 10 issues"
```

### Legacy Code Understanding

Before touching unfamiliar code:

```
Upload: .srcpack/legacy.txt

"This is legacy code I need to modify. Explain:
- What does this system do?
- What are the main entry points?
- What would break if I change the User class?"
```

### Estimation and Scoping

Get AI help with technical estimates:

```
Upload: .srcpack/app.txt

"We need to add real-time notifications. Based on this codebase:
- What existing patterns should I follow?
- What modules need changes?
- What's the rough scope of work?"
```

## Why Not Just Copy Files?

You could paste files manually, but srcpack provides:

| Manual Copy                 | Srcpack                                   |
| --------------------------- | ----------------------------------------- |
| Cherry-pick files each time | Define bundles once, reuse forever        |
| Flat text dump              | Indexed with file numbers and line ranges |
| AI says "in that file"      | AI says "[3] src/auth.ts:L42"             |
| Includes junk files         | Respects .gitignore, skips binaries       |
| Different format each time  | Consistent output format                  |
| Local only                  | Optional cloud upload for team sharing    |

## Getting Started

::: code-group

```sh [npm]
npx srcpack init    # Create config from your project
npx srcpack         # Generate bundles
```

```sh [bun]
bunx srcpack init
bunx srcpack
```

```sh [pnpm]
pnpm dlx srcpack init
pnpm dlx srcpack
```

```sh [yarn]
yarn dlx srcpack init
yarn dlx srcpack
```

:::

Your bundles are ready in `.srcpack/` — upload them to any AI and start asking questions.

See the [Getting Started](./getting-started.md) guide for full setup instructions.
