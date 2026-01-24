# Google Drive Upload

Srcpack can automatically upload bundles to Google Drive, making them accessible from any device or shareable with your team.

## Setup

### 1. Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable the **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Select **Desktop app**
6. Copy the **Client ID** and **Client Secret**

### 2. Configure Srcpack

Add the upload config to `srcpack.config.ts`:

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  bundles: {
    web: "apps/web/**/*",
    api: "apps/api/**/*",
    local: "local/**/*", // local-only bundle
  },
  upload: {
    provider: "gdrive",
    folderId: "1ABC...", // From Drive folder URL
    clientId: "...",
    clientSecret: "...",
    exclude: ["local"], // skip these bundles
  },
});
```

**Upload options:**

| Option         | Type       | Description                                      |
| -------------- | ---------- | ------------------------------------------------ |
| `provider`     | `"gdrive"` | Upload provider (currently only gdrive)          |
| `folderId`     | `string`   | Google Drive folder ID (optional, defaults root) |
| `clientId`     | `string`   | OAuth 2.0 client ID                              |
| `clientSecret` | `string`   | OAuth 2.0 client secret                          |
| `exclude`      | `string[]` | Bundle names to skip during upload               |

**Finding your folder ID:**

Open the target folder in Google Drive. The URL looks like:

```
https://drive.google.com/drive/folders/1ABCxyz123...
                                        └─────────┘
                                         folder ID
```

### 3. Authenticate

Run the login command:

::: code-group

```sh [npm]
npx srcpack login
```

```sh [bun]
bunx srcpack login
```

```sh [pnpm]
pnpm dlx srcpack login
```

```sh [yarn]
yarn dlx srcpack login
```

:::

This opens a browser window to authorize access. Tokens are stored locally and refreshed automatically.

## Usage

Once configured, `npx srcpack` uploads bundles after bundling:

```
✓ web  →  .srcpack/web.txt  (24 files, 8.2 KB)
✓ api  →  .srcpack/api.txt  (18 files, 5.1 KB)
↑ Uploaded to Google Drive
```

### Exclude Bundles

To skip specific bundles from upload, use the `exclude` option:

```ts
upload: {
  provider: "gdrive",
  clientId: "...",
  clientSecret: "...",
  exclude: ["local", "debug"], // these bundles won't upload
}
```

This is useful for local-only bundles that shouldn't be shared.

### Skip Upload

To bundle without uploading:

::: code-group

```sh [npm]
npx srcpack --no-upload
```

```sh [bun]
bunx srcpack --no-upload
```

```sh [pnpm]
pnpm dlx srcpack --no-upload
```

```sh [yarn]
yarn dlx srcpack --no-upload
```

:::

### Upload Specific Bundles

::: code-group

```sh [npm]
npx srcpack web
```

```sh [bun]
bunx srcpack web
```

```sh [pnpm]
pnpm dlx srcpack web
```

```sh [yarn]
yarn dlx srcpack web
```

:::

## Environment Variables

::: warning
Never commit `clientId` and `clientSecret` directly in your config file. Use environment variables for shared or public repositories.
:::

For CI/CD or shared configs, use environment variables:

```ts
export default defineConfig({
  bundles: {
    /* ... */
  },
  upload: {
    provider: "gdrive",
    folderId: process.env.GDRIVE_FOLDER_ID,
    clientId: process.env.GDRIVE_CLIENT_ID,
    clientSecret: process.env.GDRIVE_CLIENT_SECRET,
  },
});
```

## Sharing with Your Team

Once uploaded, bundles appear in your Google Drive folder. You can:

1. **Share the folder** with team members
2. **Open in ChatGPT/Claude** — use the Google Drive integration
3. **Download** — grab the latest bundle from any device

## Troubleshooting

::: details "Access denied" error
Re-run the login command to refresh authentication.
:::

::: details "Folder not found" error
Verify the folder ID is correct and you have write access to the folder.
:::

::: details Tokens expired
Srcpack automatically refreshes tokens. If issues persist, delete `~/.config/srcpack/credentials.json` and run the login command again.
:::
