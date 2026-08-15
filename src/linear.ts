// SPDX-License-Identifier: MIT

import type { LinearSourceInput } from "./config.ts";

const API_URL = "https://api.linear.app/graphql";

/** A stalled connection shouldn't leave the CLI hanging with a spinner up. */
const TIMEOUT_MS = 30_000;

/** Personal API key: Linear → Settings → Security & access → Personal API keys. */
const TOKEN_ENV = "LINEAR_API_KEY";

/**
 * Linear charges query complexity as page size × selected fields, and the issue
 * selection below is wide enough that asking for its 250 maximum is rejected
 * outright as "Query too complex".
 */
const PAGE = 50;

/**
 * Terminal workflow state types, excluded unless asked for. `duplicate` is easy
 * to miss — it is a state type of its own, not a state name under `canceled`,
 * so omitting it leaks duplicates into a bundle meant to be non-terminal.
 */
const CLOSED_STATES = ["completed", "canceled", "duplicate"];

/** Linear encodes priority as 0-4; 0 sorts as "no priority", not "lowest". */
const PRIORITY = ["None", "Urgent", "High", "Medium", "Low"];

export class LinearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearError";
  }
}

interface Issue {
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: { name: string; type: string };
  labels: { nodes: { name: string; parent: { name: string } | null }[] };
  project: { name: string } | null;
  projectMilestone: { name: string } | null;
  parent: { identifier: string } | null;
  assignee: { name: string } | null;
}

interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

function requireToken(): string {
  // Trimmed: a key read from a file or piped through shell tooling arrives with
  // a trailing newline, which Linear answers with a bare "not authorized".
  const token = process.env[TOKEN_ENV]?.trim();
  if (!token) {
    throw new LinearError(
      `${TOKEN_ENV} is not set. Create a personal API key in Linear ` +
        "(Settings → Security & access → Personal API keys).",
    );
  }
  return token;
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout arrives as a DOMException, whose message ("The operation was
    // aborted due to timeout") reads like an internal error rather than advice
    if ((error as Error).name === "TimeoutError") {
      throw new LinearError(
        `Linear API request timed out after ${TIMEOUT_MS / 1000}s.`,
      );
    }
    throw new LinearError(
      `Cannot reach the Linear API: ${(error as Error).message}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new LinearError(
      `${TOKEN_ENV} was rejected by Linear (not authorized).`,
    );
  }

  let body: { data?: T; errors?: { message: string }[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new LinearError(`Linear API returned ${response.status}.`);
  }

  // Linear answers 200 with an `errors` array, so status alone proves nothing.
  if (body.errors?.length) {
    throw new LinearError(body.errors.map((e) => e.message).join("; "));
  }
  if (!response.ok || !body.data) {
    throw new LinearError(`Linear API returned ${response.status}.`);
  }
  return body.data;
}

/** Fill in the shorthand form and the `includeClosed` default. */
function normalize(source: LinearSourceInput): {
  team: string;
  project?: string;
  includeClosed: boolean;
} {
  if (typeof source === "string") {
    return { team: source, includeClosed: false };
  }
  return {
    team: source.team,
    project: source.project,
    includeClosed: source.includeClosed ?? false,
  };
}

/**
 * Confirm the team exists and resolve the project name to a single id.
 *
 * Linear answers an unknown team key with an empty issue list rather than an
 * error, so without this a typo yields a silently empty bundle — the one
 * failure mode that looks like success. Project names are neither unique nor
 * stable, so they are resolved to an id within the team and required to match
 * exactly one project; filtering issues by name would silently union two.
 */
async function resolveScope(
  team: string,
  project: string | undefined,
  token: string,
): Promise<{ projectId?: string }> {
  const projects = project
    ? "projects(filter: { name: { eq: $project } }, first: 2) { nodes { id } }"
    : "";
  const query = `
    query ($team: String!${project ? ", $project: String!" : ""}) {
      teams(filter: { key: { eq: $team } }, first: 1) {
        nodes { key ${projects} }
      }
    }
  `;
  const data = await graphql<{
    teams: { nodes: { projects?: { nodes: { id: string }[] } }[] };
  }>(query, project ? { team, project } : { team }, token);

  const found = data.teams.nodes[0];
  if (!found) {
    throw new LinearError(
      `Team "${team}" not found in this Linear workspace. ` +
        "Use the team key shown in issue identifiers (the ENG in ENG-123).",
    );
  }
  if (!project) return {};

  const matches = found.projects?.nodes ?? [];
  if (matches.length === 0) {
    throw new LinearError(`Project "${project}" not found in team "${team}".`);
  }
  if (matches.length > 1) {
    throw new LinearError(
      `Project "${project}" is ambiguous: team "${team}" has more than one project with that name.`,
    );
  }
  return { projectId: matches[0]!.id };
}

async function fetchIssues(
  filter: Record<string, unknown>,
  token: string,
): Promise<Issue[]> {
  // Ordered by `createdAt`, not the `updatedAt` default: a cursor walk is only
  // stable while the sort key is. An issue edited mid-run reorders an
  // `updatedAt` list under the cursor, dropping or repeating its neighbours.
  const query = `
    query ($cursor: String, $filter: IssueFilter) {
      issues(first: ${PAGE}, after: $cursor, filter: $filter, orderBy: createdAt) {
        nodes {
          identifier
          title
          description
          priority
          estimate
          dueDate
          url
          createdAt
          updatedAt
          state { name type }
          # A deliberate cap, not pagination: 50 labels is far past what an
          # issue carries, and each nested page multiplies query complexity
          labels(first: 50) { nodes { name parent { name } } }
          project { name }
          projectMilestone { name }
          parent { identifier }
          assignee { name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const issues: Issue[] = [];
  let cursor: string | null = null;
  do {
    const data: { issues: Page<Issue> } = await graphql<{
      issues: Page<Issue>;
    }>(query, { cursor, filter }, token);
    issues.push(...data.issues.nodes);
    cursor = data.issues.pageInfo.hasNextPage
      ? data.issues.pageInfo.endCursor
      : null;
  } while (cursor);

  return issues;
}

/**
 * Issue mentions arrive as ordinary markdown links and need no handling.
 * Attachments do: an embedded image or video is one long `<linear-embed>` tag
 * carrying an upload URL and a JSON blob, which burns context for nothing.
 */
function stripEmbeds(markdown: string): string {
  return markdown
    .replace(/<linear-embed\b[^>]*>.*?<\/linear-embed>/gs, "[embed]")
    .replace(/<linear-embed\b[^>]*\/?>/g, "[embed]")
    .trimEnd();
}

function labelNames(issue: Issue): string[] {
  return issue.labels.nodes.map((l) =>
    l.parent ? `${l.parent.name}/${l.name}` : l.name,
  );
}

/** Render one issue as markdown: a title, an aligned field block, the body. */
function render(issue: Issue): string {
  const field = (name: string, value: string | null | undefined) =>
    `${name.padEnd(10)} ${value?.length ? value : "—"}`;

  const description = issue.description?.trim()
    ? stripEmbeds(issue.description)
    : "(no description)";

  return [
    `# ${issue.identifier}  ${issue.title}`,
    "",
    field("State", `${issue.state.name} (${issue.state.type})`),
    field("Priority", PRIORITY[issue.priority] ?? String(issue.priority)),
    field("Estimate", issue.estimate === null ? null : String(issue.estimate)),
    field("Labels", labelNames(issue).join(", ")),
    field("Project", issue.project?.name),
    field("Milestone", issue.projectMilestone?.name),
    field("Parent", issue.parent?.identifier),
    field("Assignee", issue.assignee?.name),
    field("Due", issue.dueDate),
    field("Created", issue.createdAt.slice(0, 10)),
    field("Updated", issue.updatedAt.slice(0, 10)),
    field("URL", issue.url),
    "",
    description,
  ].join("\n");
}

/**
 * Resolve a `linear` bundle source to one virtual file per issue.
 *
 * Paths are namespaced under `linear/issues/` so they sort together, read as
 * files in the index, and can be filtered with ordinary `!` exclusions.
 *
 * The return type is structural rather than `Entry` from `bundle.ts`: a source
 * shouldn't depend on the module that orchestrates it.
 */
export async function resolveLinearSource(
  source: LinearSourceInput,
): Promise<{ path: string; content: string }[]> {
  const { team, project, includeClosed } = normalize(source);
  const token = requireToken();

  const { projectId } = await resolveScope(team, project, token);

  const filter: Record<string, unknown> = { team: { key: { eq: team } } };
  if (projectId) filter.project = { id: { eq: projectId } };
  if (!includeClosed) filter.state = { type: { nin: CLOSED_STATES } };

  const issues = await fetchIssues(filter, token);

  return issues.map((issue) => ({
    path: `linear/issues/${issue.identifier}.md`,
    content: render(issue),
  }));
}
