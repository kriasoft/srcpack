// Automated login tests (mocked, no real OAuth)
// For real interactive OAuth testing, see tests/manual/login.test.ts

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");

// Isolated temp directory for test credentials
const TEST_DIR = join(tmpdir(), "srcpack-test-" + Date.now());
const TEST_CREDENTIALS_PATH = join(TEST_DIR, "credentials.json");

async function runCli(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
  };
}

describe("login flow", () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("without authentication", () => {
    test.todo(
      "should prompt for login when upload is configured but no tokens exist",
      () => {},
    );
  });

  describe("with valid tokens", () => {
    test.todo("should skip login prompt when valid tokens exist", () => {});
  });

  describe("with expired tokens", () => {
    test.todo(
      "should refresh tokens automatically when refresh_token exists",
      () => {},
    );
    test.todo("should prompt for login when refresh fails", () => {});
  });

  describe("logout subcommand", () => {
    test.todo("should clear stored tokens", () => {});
  });
});
