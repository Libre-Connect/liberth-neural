import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { projectRoot } from "./project-paths";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const envFiles = [process.cwd(), projectRoot, currentDir].flatMap((dirPath) => [
  path.join(dirPath, ".env.local"),
  path.join(dirPath, ".env"),
]);

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalIndex = trimmed.indexOf("=");
  if (equalIndex <= 0) return null;

  const key = trimmed.slice(0, equalIndex).trim();
  if (!key) return null;

  let value = trimmed.slice(equalIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  value = value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");

  return { key, value };
}

for (const filePath of envFiles) {
  if (!fs.existsSync(filePath)) continue;
  const source = fs.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (typeof process.env[parsed.key] === "string" && process.env[parsed.key]?.length) {
      continue;
    }
    process.env[parsed.key] = parsed.value;
  }
}

const [nodeMajor = 0, nodeMinor = 0] = process.versions.node
  .split(".")
  .map((value) => Number.parseInt(value, 10));

if (nodeMajor < 18 || (nodeMajor === 18 && nodeMinor < 18)) {
  throw new Error(
    `Liberth Neural requires Node 18.18+ or newer. Current runtime: ${process.version}.`,
  );
}

if (typeof globalThis.fetch !== "function") {
  throw new Error(
    `Liberth Neural requires a Node runtime with global fetch support. Current runtime: ${process.version}.`,
  );
}
