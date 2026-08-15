import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createBundle, resolvePatterns } from "../../src/bundle.ts";
import { ConfigError } from "../../src/config.ts";
import { GitError, isGitSource, resolveGitSource } from "../../src/git.ts";

const execFileAsync = promisify(execFile);

let repo: string;
let outside: string;

/** Run git with identity flags so the test doesn't depend on global config. */
function git(...args: string[]) {
  return execFileAsync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo },
  );
}

/** Content defaults to something unique — identical files trip git's rename
 * detection, which would turn a delete + add pair into a single R entry. */
function write(path: string, content = `// ${path}\n`) {
  return writeFile(join(repo, path), content);
}

/**
 * Build a repo covering every state a bundle has to handle:
 * committed, staged, unstaged, untracked, deleted, ignored, binary,
 * and a diverged branch for `git:<rev>`.
 */
beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "srcpack-git-"));

  await git("init", "-b", "main");
  await write(".gitignore", "ignored/\n*.log\n");
  await write("base.ts");
  await write("mod.ts");
  await write("gone.ts");
  await write("kept.ts");
  await mkdir(join(repo, "pkg/src"), { recursive: true });
  await write("pkg/src/deep.ts");
  await git("add", ".");
  await git("commit", "-m", "init");

  // Diverge: main gains a file and edits another. Neither is this branch's
  // work, so a merge-base comparison must report neither. (The added file
  // alone wouldn't prove it — it reads as a deletion, which ACMR filters.)
  await git("checkout", "-b", "feature");
  await git("checkout", "main");
  await write("theirs.ts");
  await write("kept.ts", "edited on main\n");
  await git("add", "theirs.ts", "kept.ts");
  await git("commit", "-m", "their work");
  await git("checkout", "feature");

  await write("committed-on-branch.ts");
  await git("add", "committed-on-branch.ts");
  await git("commit", "-m", "my work");

  await write("base.ts", "staged change\n");
  await write("pkg/src/deep.ts", "staged deep change\n");
  await git("add", "base.ts", "pkg/src/deep.ts");

  await write("mod.ts", "unstaged change\n");

  await write("new.ts");
  await write("notes.md"); // untracked non-.ts, so exclusion tests can't pass vacuously
  await write("pkg/src/fresh.ts"); // untracked inside a subdirectory

  await git("rm", "-q", "gone.ts");

  // Staged, then removed from the worktree before bundling
  await write("ghost.ts");
  await git("add", "ghost.ts");
  await rm(join(repo, "ghost.ts"));

  // Binary content is excluded regardless of git state
  await writeFile(join(repo, "bin.dat"), Buffer.from([0x41, 0x00, 0x42]));
  await git("add", "bin.dat");

  // A tracked symlink escaping the repo must not leak the target's contents
  outside = await mkdtemp(join(tmpdir(), "srcpack-outside-"));
  await writeFile(join(outside, "secret.txt"), "SECRET\n");
  await symlink(join(outside, "secret.txt"), join(repo, "leak.txt"));
  await git("add", "leak.txt");

  await mkdir(join(repo, "ignored"), { recursive: true });
  await write("ignored/secret.ts");
  await write("debug.log");
});

afterAll(async () => {
  await rm(outside, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe("isGitSource", () => {
  test("should detect the git: prefix", () => {
    expect(isGitSource("git:staged")).toBe(true);
    expect(isGitSource("src/**/*.ts")).toBe(false);
  });
});

describe("resolveGitSource", () => {
  test("should list staged files", async () => {
    const files = await resolveGitSource("git:staged", repo);

    expect(files).toContain("base.ts");
    expect(files).not.toContain("mod.ts");
    expect(files).not.toContain("new.ts");
  });

  test("should omit staged deletions", async () => {
    const files = await resolveGitSource("git:staged", repo);

    expect(files).not.toContain("gone.ts");
  });

  test("should list unstaged files only", async () => {
    const files = await resolveGitSource("git:unstaged", repo);

    expect(files).toContain("mod.ts");
    expect(files).not.toContain("base.ts");
    expect(files).not.toContain("new.ts");
  });

  test("should list untracked files, respecting .gitignore", async () => {
    const files = await resolveGitSource("git:untracked", repo);

    expect(files).toContain("new.ts");
    expect(files).not.toContain("ignored/secret.ts");
    expect(files).not.toContain("debug.log");
  });

  test("should union all three for dirty", async () => {
    const files = await resolveGitSource("git:dirty", repo);

    expect(files).toContain("base.ts");
    expect(files).toContain("mod.ts");
    expect(files).toContain("new.ts");
    expect(files).not.toContain("kept.ts");
  });

  test("should not duplicate a file staged and modified again", async () => {
    await write("base.ts", "staged, then modified again\n");
    let files: string[];
    try {
      files = await resolveGitSource("git:dirty", repo);
    } finally {
      // Restore even on failure — later tests share this repo
      await write("base.ts", "staged change\n");
    }

    expect(files.filter((f) => f === "base.ts")).toHaveLength(1);
  });

  test("should compare a revision against the merge base", async () => {
    const files = await resolveGitSource("git:main", repo);

    expect(files).toContain("committed-on-branch.ts");
    expect(files).toContain("base.ts"); // uncommitted work counts
    // Changed on main after the branch point, so not this branch's work.
    // Without --merge-base, kept.ts would show as modified.
    expect(files).not.toContain("kept.ts");
    expect(files).not.toContain("theirs.ts");
  });

  test("should scope results to a subdirectory", async () => {
    // Matches a monorepo config whose `root` is one package
    const files = await resolveGitSource("git:staged", join(repo, "pkg"));

    expect(files).toContain("src/deep.ts"); // relative to the subdirectory
    expect(files).not.toContain("base.ts"); // outside it
    expect(files).not.toContain("pkg/src/deep.ts");
  });

  test("should scope untracked files to a subdirectory", async () => {
    const files = await resolveGitSource("git:untracked", join(repo, "pkg"));

    expect(files).toContain("src/fresh.ts");
    expect(files).not.toContain("pkg/src/fresh.ts");
    expect(files).not.toContain("new.ts");
  });

  test("should pass ranges through to git", async () => {
    const files = await resolveGitSource("git:HEAD~1..HEAD", repo);

    expect(files).toEqual(["committed-on-branch.ts"]);
  });

  test("should reject an empty source", async () => {
    await expect(resolveGitSource("git:", repo)).rejects.toThrow(
      /Empty git source/,
    );
  });

  test("should reject a revision that git would read as a flag", async () => {
    await expect(resolveGitSource("git:--exit-code", repo)).rejects.toThrow(
      /starts with "-"/,
    );
  });

  test("should report an unknown revision", async () => {
    // git's own wording, not a generic failure
    await expect(resolveGitSource("git:no-such-ref", repo)).rejects.toThrow(
      /no-such-ref/,
    );
  });

  test("should report a directory that is not a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "srcpack-plain-"));
    try {
      // git diff falls back to --no-index here and prints usage, so the
      // message must come from the repository check instead
      await expect(resolveGitSource("git:staged", plain)).rejects.toThrow(
        /Not a git repository/,
      );
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  test("should surface a GitError type for callers", async () => {
    await expect(resolveGitSource("git:", repo)).rejects.toBeInstanceOf(
      GitError,
    );
  });
});

describe("resolvePatterns with git sources", () => {
  test("should resolve a git source to files", async () => {
    const files = await resolvePatterns("git:staged", repo);

    expect(files).toContain("base.ts");
  });

  test("should skip files git listed but the worktree no longer has", async () => {
    const files = await resolvePatterns("git:staged", repo);

    expect(files).toContain("base.ts"); // guards against a vacuous pass
    expect(files).not.toContain("ghost.ts");
  });

  test("should skip binary files", async () => {
    const files = await resolvePatterns("git:staged", repo);

    expect(files).toContain("base.ts");
    expect(files).not.toContain("bin.dat");
  });

  test("should not follow a symlink out of the repository", async () => {
    const files = await resolvePatterns("git:staged", repo);
    const bundle = await createBundle(
      files.map((path) => ({ path })),
      repo,
    );

    expect(files).toContain("base.ts");
    expect(files).not.toContain("leak.txt");
    expect(bundle.content).not.toContain("SECRET");
  });

  test("should apply ! exclusions to git sources", async () => {
    const files = await resolvePatterns(["git:dirty", "!*.ts"], repo);

    expect(files).toContain("notes.md");
    expect(files).not.toContain("base.ts");
    expect(files).not.toContain("new.ts");
  });

  test("should combine git sources with globs", async () => {
    const files = await resolvePatterns(["git:staged", "kept.ts"], repo);

    expect(files).toContain("base.ts");
    expect(files).toContain("kept.ts");
  });

  test("should ignore .gitignore for git sources", async () => {
    // Tracked despite matching .gitignore — git reports it, so it belongs
    await git("add", "-f", "debug.log");
    let files: string[];
    try {
      files = await resolvePatterns("git:staged", repo);
    } finally {
      await git("rm", "-q", "--cached", "debug.log");
    }

    expect(files).toContain("debug.log");
  });

  test("should sort and deduplicate across overlapping sources", async () => {
    const files = await resolvePatterns(["git:staged", "git:dirty"], repo);

    expect(files.length).toBeGreaterThan(1);
    expect(files).toEqual([...new Set(files)].sort());
  });

  test("should reject a git source with the ! prefix", async () => {
    await expect(
      resolvePatterns(["src/**", "!git:staged"], repo),
    ).rejects.toThrow(ConfigError);
  });

  test("should reject a git source with the + prefix", async () => {
    await expect(resolvePatterns(["+git:staged"], repo)).rejects.toThrow(
      ConfigError,
    );
  });
});
