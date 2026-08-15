import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBundle, resolveEntries } from "../../src/bundle.ts";
import { ConfigError } from "../../src/config.ts";
import { LinearError, resolveLinearSource } from "../../src/linear.ts";

interface Call {
  query: string;
  variables: Record<string, unknown>;
  token?: string;
}

const realFetch = globalThis.fetch;
const realToken = process.env.LINEAR_API_KEY;

/** A full issue node — the query selects every field, so the stub must too. */
function issue(identifier: string, overrides: Record<string, unknown> = {}) {
  return {
    identifier,
    title: `Title of ${identifier}`,
    description: "Body text.",
    priority: 2,
    estimate: null,
    dueDate: null,
    url: `https://linear.app/acme/issue/${identifier}`,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-02-03T04:05:06.000Z",
    state: { name: "In Progress", type: "started" },
    labels: { nodes: [] },
    project: null,
    projectMilestone: null,
    parent: null,
    assignee: null,
    ...overrides,
  };
}

/**
 * Serve the two queries the module issues (scope, then issue pages) and record
 * what was asked, so tests can assert on the filter Linear actually receives.
 */
function stubLinear(options: {
  teams?: unknown[];
  projects?: { id: string }[];
  pages?: ReturnType<typeof issue>[][];
  status?: number;
  errors?: { message: string }[];
}): Call[] {
  const calls: Call[] = [];
  const pages = options.pages ?? [[]];
  let issueRequests = 0;

  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const call = JSON.parse(String(init.body)) as Call;
    call.token = (init.headers as Record<string, string>).authorization;
    calls.push(call);

    if (options.status && options.status !== 200) {
      return new Response("{}", { status: options.status });
    }
    if (options.errors) {
      return Response.json({ errors: options.errors });
    }

    if (call.query.includes("teams(")) {
      const teams = options.teams ?? [
        options.projects ? { projects: { nodes: options.projects } } : {},
      ];
      return Response.json({ data: { teams: { nodes: teams } } });
    }

    // Serve the page the cursor asks for, the way Linear would. A variable the
    // query never references is inert in GraphQL, so a query that drops
    // `after: $cursor` keeps getting page one however it fills its variables —
    // which is what makes the pagination test catch that mutation.
    const usesCursor = call.query.includes("after: $cursor");
    const cursor = usesCursor ? (call.variables.cursor as string | null) : null;
    const index = cursor ? Number(cursor.slice(1)) : 0;

    if (++issueRequests > pages.length) {
      return Response.json({
        errors: [{ message: "pagination did not advance past the first page" }],
      });
    }
    return Response.json({
      data: {
        issues: {
          nodes: pages[index] ?? [],
          pageInfo: {
            hasNextPage: index < pages.length - 1,
            endCursor: `c${index + 1}`,
          },
        },
      },
    });
  }) as typeof fetch;

  return calls;
}

beforeEach(() => {
  process.env.LINEAR_API_KEY = "lin_api_test";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = realToken;
});

describe("resolveLinearSource", () => {
  test("maps issues to virtual entries under linear/issues/", async () => {
    stubLinear({ pages: [[issue("ENG-1"), issue("ENG-2")]] });

    const entries = await resolveLinearSource("ENG");

    expect(entries.map((e) => e.path)).toEqual([
      "linear/issues.md",
      "linear/issues/ENG-1.md",
      "linear/issues/ENG-2.md",
    ]);
    expect(entries[1]!.content).toContain("# ENG-1  Title of ENG-1");
    expect(entries[1]!.content).toContain("State      In Progress (started)");
    expect(entries[1]!.content).toContain("Priority   High");
    expect(entries[1]!.content).toContain("Body text.");
  });

  test("leads with a roster ordered by issue number", async () => {
    // The bundle index lists paths, and `linear/issues/ENG-10.md` says nothing
    // about ENG-10 — the roster is what makes the set readable at a glance.
    stubLinear({
      pages: [
        [
          issue("ENG-10"),
          issue("ENG-2", { state: { name: "Backlog", type: "backlog" } }),
        ],
      ],
    });

    const [summary] = await resolveLinearSource("ENG");

    expect(summary!.path).toBe("linear/issues.md");
    expect(summary!.content).toContain("# ENG — 2 issues");
    expect(summary!.content).toContain("In Progress 1 · Backlog 1");
    // Numeric, not the lexical order the index is stuck with
    expect(summary!.content.indexOf("| ENG-2 |")).toBeLessThan(
      summary!.content.indexOf("| ENG-10 |"),
    );
  });

  test("names the project in the roster when the source is scoped", async () => {
    stubLinear({ pages: [[issue("ENG-1")]], projects: [{ id: "proj_123" }] });

    const [summary] = await resolveLinearSource({
      team: "ENG",
      project: "Roadmap",
    });

    expect(summary!.content).toContain("# ENG / Roadmap — 1 issue");
  });

  test("escapes a pipe in a title so the roster table survives", async () => {
    stubLinear({ pages: [[issue("ENG-1", { title: "Parse a | b" })]] });

    const [summary] = await resolveLinearSource("ENG");

    expect(summary!.content).toContain("Parse a \\| b");
  });

  test("emits no roster when the team has no issues", async () => {
    stubLinear({ pages: [[]] });

    expect(await resolveLinearSource("ENG")).toEqual([]);
  });

  test("renders missing fields as em dashes, not undefined", async () => {
    stubLinear({ pages: [[issue("ENG-1", { description: null })]] });

    const [, entry] = await resolveLinearSource("ENG");

    expect(entry!.content).toContain("Assignee   —");
    expect(entry!.content).toContain("(no description)");
    expect(entry!.content).not.toContain("undefined");
  });

  test("strips linear-embed tags from descriptions", async () => {
    stubLinear({
      pages: [
        [
          issue("ENG-1", {
            description:
              'Before <linear-embed href="x" {"a":1}>junk\nmore</linear-embed> after',
          }),
        ],
      ],
    });

    const [, entry] = await resolveLinearSource("ENG");

    expect(entry!.content).toContain("Before [embed] after");
    expect(entry!.content).not.toContain("linear-embed");
  });

  test("follows pagination until the cursor runs out", async () => {
    const calls = stubLinear({
      pages: [[issue("ENG-1")], [issue("ENG-2")], [issue("ENG-3")]],
    });

    const entries = await resolveLinearSource("ENG");

    expect(entries).toHaveLength(4); // roster + one issue per page
    // Counting entries alone would still pass if `after: $cursor` were dropped,
    // so assert each page was requested with the cursor the previous one returned
    expect(
      calls
        .filter((c) => c.query.includes("issues("))
        .map((c) => c.variables.cursor),
    ).toEqual([null, "c1", "c2"]);
    // A cursor walk is only stable while its sort key is: on the `updatedAt`
    // default, an issue edited mid-run reorders the list under the cursor
    expect(calls.at(-1)!.query).toContain("orderBy: createdAt");
  });

  test("excludes every closed state type by default", async () => {
    const calls = stubLinear({});

    await resolveLinearSource("ENG");

    const filter = calls.at(-1)!.variables.filter as Record<string, unknown>;
    // `duplicate` is its own state type, not a state named "Duplicate" under
    // `canceled` — leaving it out leaks duplicates into an open-issues bundle
    expect(filter).toEqual({
      team: { key: { eq: "ENG" } },
      state: { type: { nin: ["completed", "canceled", "duplicate"] } },
    });
  });

  test("includeClosed drops the state filter", async () => {
    const calls = stubLinear({});

    await resolveLinearSource({ team: "ENG", includeClosed: true });

    const filter = calls.at(-1)!.variables.filter as Record<string, unknown>;
    expect(filter).toEqual({ team: { key: { eq: "ENG" } } });
  });

  test("filters by resolved project id, not by name", async () => {
    const calls = stubLinear({ projects: [{ id: "proj_123" }] });

    await resolveLinearSource({ team: "ENG", project: "Roadmap" });

    expect(calls[0]!.variables).toEqual({ team: "ENG", project: "Roadmap" });
    const filter = calls.at(-1)!.variables.filter as Record<string, unknown>;
    expect(filter).toMatchObject({ project: { id: { eq: "proj_123" } } });
  });

  test("rejects an unknown team instead of returning an empty bundle", async () => {
    stubLinear({ teams: [] });

    await expect(resolveLinearSource("NOPE")).rejects.toThrow(
      /Team "NOPE" not found/,
    );
  });

  test("rejects an unknown project", async () => {
    stubLinear({ projects: [] });

    await expect(
      resolveLinearSource({ team: "ENG", project: "Ghost" }),
    ).rejects.toThrow(/Project "Ghost" not found in team "ENG"/);
  });

  test("rejects an ambiguous project name", async () => {
    stubLinear({ projects: [{ id: "a" }, { id: "b" }] });

    await expect(
      resolveLinearSource({ team: "ENG", project: "Roadmap" }),
    ).rejects.toThrow(/ambiguous/);
  });

  test("reports a missing API key without calling the network", async () => {
    const calls = stubLinear({});

    for (const value of [undefined, "   "]) {
      if (value === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = value;

      await expect(resolveLinearSource("ENG")).rejects.toThrow(
        /LINEAR_API_KEY is not set/,
      );
    }
    expect(calls).toHaveLength(0);
  });

  test("trims the API key", async () => {
    // A key read from a file or piped through shell tooling carries a newline,
    // which Linear answers with a bare "not authorized"
    process.env.LINEAR_API_KEY = " lin_api_test\n";
    const calls = stubLinear({});

    await resolveLinearSource("ENG");

    expect(calls[0]!.token).toBe("lin_api_test");
  });

  test("reports a rejected API key", async () => {
    stubLinear({ status: 401 });

    await expect(resolveLinearSource("ENG")).rejects.toThrow(/not authorized/);
  });

  test("surfaces GraphQL errors returned with status 200", async () => {
    stubLinear({ errors: [{ message: "Query too complex" }] });

    await expect(resolveLinearSource("ENG")).rejects.toThrow(
      /Query too complex/,
    );
  });

  test("reports a timeout as advice, not as an AbortError", async () => {
    globalThis.fetch = (() => {
      // What AbortSignal.timeout() produces once the deadline passes
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      return Promise.reject(error);
    }) as unknown as typeof fetch;

    const failure = resolveLinearSource("ENG");
    await expect(failure).rejects.toThrow(LinearError);
    await expect(failure).rejects.toThrow(/timed out after 30s/);
    await expect(failure).rejects.not.toThrow(/abort/i);
  });

  test("reports an unreachable API", async () => {
    globalThis.fetch = (() => {
      throw new TypeError("getaddrinfo ENOTFOUND api.linear.app");
    }) as unknown as typeof fetch;

    await expect(resolveLinearSource("ENG")).rejects.toThrow(LinearError);
  });
});

describe("resolveEntries with a linear source", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "srcpack-linear-"));
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs/readme.md"), "# Readme\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("merges files and issues into one sorted list", async () => {
    stubLinear({ pages: [[issue("ENG-1")]] });

    const entries = await resolveEntries(
      { include: "docs/**", linear: "ENG" },
      dir,
    );

    expect(entries.map((e) => e.path)).toEqual([
      "docs/readme.md",
      "linear/issues.md",
      "linear/issues/ENG-1.md",
    ]);
    // Files stay lazy; only the virtual entries carry content
    expect(entries[0]!.content).toBeUndefined();
    expect(entries[2]!.content).toContain("# ENG-1");
  });

  test("applies ! exclusions to issues as well as files", async () => {
    stubLinear({ pages: [[issue("ENG-1"), issue("ENG-2")]] });

    const entries = await resolveEntries(
      { include: ["docs/**", "!linear/issues/ENG-1.md"], linear: "ENG" },
      dir,
    );

    expect(entries.map((e) => e.path)).toEqual([
      "docs/readme.md",
      "linear/issues.md",
      "linear/issues/ENG-2.md",
    ]);
  });

  test("bundles a linear-only bundle without touching the filesystem", async () => {
    stubLinear({ pages: [[issue("ENG-1")]] });

    const entries = await resolveEntries({ linear: "ENG" }, dir);

    expect(entries.map((e) => e.path)).toEqual([
      "linear/issues.md",
      "linear/issues/ENG-1.md",
    ]);
  });

  test("errors when a real file collides with an issue path", async () => {
    stubLinear({ pages: [[issue("ENG-1")]] });
    await mkdir(join(dir, "linear/issues"), { recursive: true });
    await writeFile(join(dir, "linear/issues/ENG-1.md"), "not the issue\n");

    await expect(
      resolveEntries({ include: "**/*.md", linear: "ENG" }, dir),
    ).rejects.toThrow(ConfigError);
  });

  test("catches a collision reached through an absolute pattern", async () => {
    stubLinear({ pages: [[issue("ENG-1")]] });
    await mkdir(join(dir, "linear/issues"), { recursive: true });
    await writeFile(join(dir, "linear/issues/ENG-1.md"), "not the issue\n");

    // The same file, spelled absolutely — comparing path strings would miss it
    await expect(
      resolveEntries(
        { include: join(dir, "linear/issues/*.md"), linear: "ENG" },
        dir,
      ),
    ).rejects.toThrow(/collides with the file/);
  });

  test("keeps an empty issue description from falling back to disk", async () => {
    // `??` not `||`: an empty virtual entry must not be read from the filesystem
    stubLinear({ pages: [[issue("ENG-1")]] });
    const [, entry] = await resolveEntries({ linear: "ENG" }, dir);
    const empty = { path: entry!.path, content: "" };

    const bundle = await createBundle([empty], dir);

    expect(bundle.index[0]!.lines).toBe(0);
    expect(bundle.content).toContain("#==> [1] linear/issues/ENG-1.md <==");
  });

  test("makes no network call when no linear source is declared", async () => {
    const calls = stubLinear({});

    const entries = await resolveEntries({ include: "docs/**" }, dir);

    expect(entries.map((e) => e.path)).toEqual(["docs/readme.md"]);
    expect(calls).toHaveLength(0);
  });
});
