// SPDX-License-Identifier: MIT

import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, basename } from "node:path";
import { drive as createDrive, type drive_v3 } from "@googleapis/drive";
import { OAuth2Client } from "google-auth-library";
import { getAuthCode, OAuthError } from "oauth-callback";
import type { UploadConfig } from "./config.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const REDIRECT_URI = "http://localhost:3000/callback";
const CREDENTIALS_PATH = join(
  homedir(),
  ".config",
  "srcpack",
  "credentials.json",
);

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // Unix timestamp in ms
  token_type: string;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// Credentials keyed by provider, then by clientId for multi-destination support
interface CredentialsFile {
  gdrive?: Record<string, Tokens>;
}

async function readCredentials(): Promise<CredentialsFile> {
  try {
    const data = await readFile(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(data) as CredentialsFile;
  } catch {
    return {};
  }
}

async function writeCredentials(creds: CredentialsFile): Promise<void> {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

/**
 * Loads stored tokens for a specific OAuth client.
 * Returns null if no tokens exist or they cannot be read.
 */
export async function loadTokens(config: UploadConfig): Promise<Tokens | null> {
  const creds = await readCredentials();
  return creds.gdrive?.[config.clientId] ?? null;
}

/**
 * Saves tokens for a specific OAuth client.
 */
async function saveTokens(tokens: Tokens, config: UploadConfig): Promise<void> {
  const creds = await readCredentials();
  creds.gdrive ??= {};
  creds.gdrive[config.clientId] = tokens;
  await writeCredentials(creds);
}

/**
 * Removes stored tokens for a specific OAuth client.
 */
export async function clearTokens(config: UploadConfig): Promise<void> {
  const creds = await readCredentials();
  if (creds.gdrive?.[config.clientId]) {
    delete creds.gdrive[config.clientId];
    await writeCredentials(creds);
  }
}

/**
 * Checks if tokens are expired or about to expire (within 5 minutes).
 */
function isExpired(tokens: Tokens): boolean {
  if (!tokens.expires_at) return false;
  const buffer = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= tokens.expires_at - buffer;
}

/**
 * Refreshes an expired access token using the refresh token.
 */
async function refreshAccessToken(
  refreshToken: string,
  config: UploadConfig,
): Promise<Tokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: refreshToken, // Keep existing refresh token
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };

  await saveTokens(tokens, config);
  return tokens;
}

/**
 * Gets valid tokens, refreshing if necessary.
 * Returns null if no tokens exist or refresh fails.
 */
export async function getValidTokens(
  config: UploadConfig,
): Promise<Tokens | null> {
  const tokens = await loadTokens(config);
  if (!tokens) return null;

  if (isExpired(tokens) && tokens.refresh_token) {
    try {
      return await refreshAccessToken(tokens.refresh_token, config);
    } catch {
      return null; // Refresh failed, need to re-login
    }
  }

  return tokens;
}

/**
 * Performs OAuth login flow - opens browser for user consent.
 * Stores tokens on success for future use.
 */
export async function login(config: UploadConfig): Promise<Tokens> {
  const authUrl =
    GOOGLE_AUTH_URL +
    "?" +
    new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
    });

  const result = await getAuthCode({
    authorizationUrl: authUrl,
    port: 3000,
    timeout: 300000, // 5 minutes
  });

  if (!result.code) {
    throw new Error("No authorization code received");
  }

  // Exchange code for tokens
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: result.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };

  await saveTokens(tokens, config);
  return tokens;
}

/**
 * Ensures we have valid tokens - loads existing or triggers login.
 */
export async function ensureAuthenticated(
  config: UploadConfig,
): Promise<Tokens> {
  const tokens = await getValidTokens(config);
  if (tokens) return tokens;

  console.log("Authentication required. Opening browser...");
  return login(config);
}

/**
 * Creates an authenticated OAuth2 client from tokens.
 */
function createAuthClient(tokens: Tokens, config: UploadConfig): OAuth2Client {
  const client = new OAuth2Client(config.clientId, config.clientSecret);
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  return client;
}

/**
 * Creates an authenticated Google Drive client.
 */
function createDriveClient(
  tokens: Tokens,
  config: UploadConfig,
): drive_v3.Drive {
  const auth = createAuthClient(tokens, config);
  return createDrive({ version: "v3", auth });
}

/**
 * Finds a file by name in a specific folder (or root).
 * Returns the file ID if found, null otherwise.
 */
async function findFile(
  drive: drive_v3.Drive,
  name: string,
  folderId?: string,
): Promise<string | null> {
  const parent = folderId ?? "root";
  const query = `name = '${name}' and '${parent}' in parents and trashed = false`;

  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
  });

  return res.data.files?.[0]?.id ?? null;
}

export interface UploadResult {
  fileId: string;
  name: string;
  webViewLink?: string;
}

/**
 * Uploads a file to Google Drive. Updates existing file if found with same name.
 */
export async function uploadFile(
  filePath: string,
  config: UploadConfig,
): Promise<UploadResult> {
  const tokens = await ensureAuthenticated(config);
  const drive = createDriveClient(tokens, config);
  const fileName = basename(filePath);

  // Check if file already exists in target folder
  const existingId = await findFile(drive, fileName, config.folderId);

  const media = {
    mimeType: "text/plain",
    body: createReadStream(filePath),
  };

  let res: { data: drive_v3.Schema$File };

  if (existingId) {
    // Update existing file
    res = await drive.files.update({
      fileId: existingId,
      media,
      fields: "id, name, webViewLink",
    });
  } else {
    // Create new file
    const requestBody: drive_v3.Schema$File = {
      name: fileName,
    };

    if (config.folderId) {
      requestBody.parents = [config.folderId];
    }

    res = await drive.files.create({
      requestBody,
      media,
      fields: "id, name, webViewLink",
    });
  }

  return {
    fileId: res.data.id!,
    name: res.data.name!,
    webViewLink: res.data.webViewLink ?? undefined,
  };
}

/**
 * Uploads multiple files to Google Drive.
 */
export async function uploadFiles(
  filePaths: string[],
  config: UploadConfig,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const filePath of filePaths) {
    const result = await uploadFile(filePath, config);
    results.push(result);
  }
  return results;
}

export { OAuthError };
