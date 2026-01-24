import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");
const FIXTURE_DIR = join(import.meta.dir, "fixtures/gdrive-project");

// Test output directory - isolated per run
const TEST_OUTPUT_DIR = join(tmpdir(), "srcpack-manual-" + Date.now());

// Default credentials path (same as production)
const CREDENTIALS_PATH = join(homedir(), ".config/srcpack/credentials.json");

async function runCli(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    cwd: options?.cwd ?? FIXTURE_DIR,
    env: { ...process.env, ...options?.env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const timeoutMs = options?.timeout ?? 120_000; // 2 min default for OAuth
  const timeout = setTimeout(() => proc.kill(), timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timeout);

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
  };
}

const hasCredentials = !!(
  process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET
);

describe.skipIf(!hasCredentials)("real login flow", () => {
  beforeAll(async () => {
    await mkdir(TEST_OUTPUT_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
  });

  test("should complete OAuth flow via login command", async () => {
    console.log("\n--- MANUAL TEST: OAuth Flow ---");
    console.log("A browser will open for Google authentication.");
    console.log("Complete the login to continue the test.\n");

    const result = await runCli(["login"], {
      env: {
        GDRIVE_CLIENT_ID: process.env.GDRIVE_CLIENT_ID!,
        GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET!,
      },
      timeout: 180_000, // 3 min for manual auth
    });

    console.log("stdout:", result.stdout);
    if (result.stderr) console.log("stderr:", result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/login successful/i);

    // Verify credentials were saved
    expect(existsSync(CREDENTIALS_PATH)).toBe(true);
  }, 180_000);

  test("should reuse cached tokens without opening browser", async () => {
    const clientId = process.env.GDRIVE_CLIENT_ID!;

    // Skip if no tokens from previous test
    if (!existsSync(CREDENTIALS_PATH)) {
      console.log("Skipping: no cached tokens (run first test)");
      return;
    }

    console.log("\n--- Testing cached token reuse ---");
    console.log("This should NOT open a browser.\n");

    const result = await runCli(["--dry-run"], {
      env: {
        GDRIVE_CLIENT_ID: clientId,
        GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET!,
      },
      timeout: 30_000, // Should be fast with cached tokens
    });

    console.log("stdout:", result.stdout);
    if (result.stderr) console.log("stderr:", result.stderr);

    expect(result.exitCode).toBe(0);

    // Tokens may be refreshed but should still exist
    expect(existsSync(CREDENTIALS_PATH)).toBe(true);
  });

  test("should refresh expired tokens automatically", async () => {
    const clientId = process.env.GDRIVE_CLIENT_ID!;

    if (!existsSync(CREDENTIALS_PATH)) {
      console.log("Skipping: no cached tokens");
      return;
    }

    console.log("\n--- Testing token refresh ---");

    // Read current credentials
    const creds = JSON.parse(await readFile(CREDENTIALS_PATH, "utf8"));
    const tokens = creds.gdrive?.[clientId];

    if (!tokens) {
      console.log("Skipping: no tokens for this clientId");
      return;
    }

    // Expire the access token (keep refresh token)
    creds.gdrive[clientId] = {
      ...tokens,
      access_token: "expired_token",
      expires_at: Date.now() - 1000, // Already expired
    };

    await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));

    // Must run without --dry-run to trigger authentication
    const result = await runCli([], {
      env: {
        GDRIVE_CLIENT_ID: clientId,
        GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET!,
      },
      timeout: 30_000,
    });

    console.log("stdout:", result.stdout);
    if (result.stderr) console.log("stderr:", result.stderr);

    // Should succeed by refreshing the token
    expect(result.exitCode).toBe(0);

    // Verify tokens were refreshed
    const newCreds = JSON.parse(await readFile(CREDENTIALS_PATH, "utf8"));
    expect(newCreds.gdrive?.[clientId]?.access_token).not.toBe("expired_token");
  });
});
