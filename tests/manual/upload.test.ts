import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { uploadFile } from "../../src/gdrive.ts";
import type { UploadConfig } from "../../src/config.ts";

const FIXTURE_DIR = join(import.meta.dir, "fixtures/gdrive-project");
const CREDENTIALS_PATH = join(homedir(), ".config/srcpack/credentials.json");

const hasCredentials = !!(
  process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET
);

function getUploadConfig(): UploadConfig {
  return {
    provider: "gdrive",
    clientId: process.env.GDRIVE_CLIENT_ID!,
    clientSecret: process.env.GDRIVE_CLIENT_SECRET!,
    folderId: process.env.GDRIVE_FOLDER_ID,
  };
}

describe.skipIf(!hasCredentials)("gdrive upload", () => {
  test("should upload a file to Google Drive", async () => {
    const config = getUploadConfig();
    const filePath = join(FIXTURE_DIR, ".srcpack/main.txt");

    if (!existsSync(filePath)) {
      throw new Error(`Test file not found: ${filePath}`);
    }

    console.log("\n--- Upload Test ---");
    console.log(`Uploading: ${filePath}`);
    if (config.folderId) {
      console.log(`Target folder: ${config.folderId}`);
    }

    // If no cached tokens, this will open browser for OAuth
    if (!existsSync(CREDENTIALS_PATH)) {
      console.log("\nNo cached tokens. Browser will open for authentication.");
    }

    const result = await uploadFile(filePath, config);

    console.log("\nUpload result:");
    console.log(`  File ID: ${result.fileId}`);
    console.log(`  Name: ${result.name}`);
    if (result.webViewLink) {
      console.log(`  Link: ${result.webViewLink}`);
    }

    expect(result.fileId).toBeTruthy();
    expect(result.name).toBe("main.txt");
  }, 120_000); // 2 min timeout for potential OAuth flow

  test("should update existing file on re-upload", async () => {
    const config = getUploadConfig();
    const filePath = join(FIXTURE_DIR, ".srcpack/main.txt");

    console.log("\n--- Re-upload Test (should update, not create new) ---");

    const result = await uploadFile(filePath, config);

    console.log(`Updated file ID: ${result.fileId}`);

    expect(result.fileId).toBeTruthy();
    expect(result.name).toBe("main.txt");
  }, 30_000);
});
