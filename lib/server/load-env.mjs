import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

let hasLoadedLocalEnv = false;

function parseEnvFile(filePath) {
  const entries = {};
  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    entries[key] = value.replace(/\\n/g, "\n");
  }

  return entries;
}

export function loadLocalEnv() {
  if (hasLoadedLocalEnv) {
    return;
  }

  hasLoadedLocalEnv = true;

  const mergedEntries = {};

  for (const relativePath of [".env", ".env.local"]) {
    const filePath = path.join(projectRoot, relativePath);

    if (!existsSync(filePath)) {
      continue;
    }

    Object.assign(mergedEntries, parseEnvFile(filePath));
  }

  for (const [key, value] of Object.entries(mergedEntries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
