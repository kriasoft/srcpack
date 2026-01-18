// SPDX-License-Identifier: MIT

import * as p from "@clack/prompts";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "srcpack.config.ts";

type Bundle = {
  name: string;
  include: string[];
};

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, CONFIG_FILE);

  p.intro("Create srcpack.config.ts");

  if (existsSync(configPath)) {
    p.log.warn(`${CONFIG_FILE} already exists`);
    const overwrite = await p.confirm({
      message: "Overwrite existing config?",
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.outro("Cancelled");
      return;
    }
  }

  const bundles: Bundle[] = [];

  // Collect bundles in a loop
  const existingNames = new Set<string>();
  while (true) {
    const bundle = await promptBundle(bundles.length === 0, existingNames);
    if (!bundle) break;
    existingNames.add(bundle.name);
    bundles.push(bundle);

    const another = await p.confirm({
      message: "Add another bundle?",
      initialValue: false,
    });

    if (p.isCancel(another) || !another) break;
  }

  if (bundles.length === 0) {
    p.outro("No bundles configured");
    return;
  }

  // Ask for output directory
  const outDir = await p.text({
    message: "Output directory:",
    placeholder: ".srcpack",
    defaultValue: ".srcpack",
  });

  if (p.isCancel(outDir)) {
    p.outro("Cancelled");
    return;
  }

  const outDirValue = outDir.trim() || ".srcpack";

  // Generate and write config
  const config = generateConfig(bundles, outDirValue);
  await writeFile(configPath, config);

  // Add output directory to .gitignore
  await addToGitignore(cwd, outDirValue);

  p.outro(`Created ${CONFIG_FILE}`);
}

async function promptBundle(
  isFirst: boolean,
  existingNames: Set<string>,
): Promise<Bundle | null> {
  const name = await p.text({
    message: isFirst ? "Bundle name:" : "Next bundle name:",
    placeholder: "api",
    validate: (value) => {
      if (!value.trim()) return "Name is required";
      if (!/^[a-z][a-z0-9-]*$/.test(value)) {
        return "Use lowercase alphanumeric characters and hyphens";
      }
      if (existingNames.has(value.trim())) {
        return "Bundle name already exists";
      }
    },
  });

  if (p.isCancel(name)) return null;

  const includeInput = await p.text({
    message: "Include patterns (comma-separated):",
    placeholder: "src/**/*",
    validate: (value) => {
      if (!value.trim()) return "At least one pattern is required";
    },
  });

  if (p.isCancel(includeInput)) return null;

  const include = includeInput
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { name: name.trim(), include };
}

function generateConfig(bundles: Bundle[], outDir: string): string {
  const bundleEntries = bundles.map(({ name, include }) => {
    const value =
      include.length === 1 ? `"${include[0]}"` : JSON.stringify(include);
    return `    ${name}: ${value},`;
  });

  return `import { defineConfig } from "srcpack";

export default defineConfig({
  outDir: "${outDir}",
  bundles: {
${bundleEntries.join("\n")}
  },
});
`;
}

async function addToGitignore(cwd: string, outDir: string): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");

  if (!existsSync(gitignorePath)) return;

  const content = await readFile(gitignorePath, "utf-8");
  const entry = outDir.endsWith("/") ? outDir : `${outDir}/`;

  // Check if already present (with or without trailing slash)
  const lines = content.split("\n").map((l) => l.trim());
  if (lines.includes(outDir) || lines.includes(entry)) return;

  // Append with newline if file doesn't end with one
  const prefix = content.endsWith("\n") ? "" : "\n";
  await appendFile(gitignorePath, `${prefix}${entry}\n`);
}
