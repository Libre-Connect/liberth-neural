import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function isProjectRoot(candidate: string) {
  const pkgPath = path.join(candidate, "package.json");
  const srcPath = path.join(candidate, "src", "App.tsx");
  if (!fs.existsSync(pkgPath) || !fs.existsSync(srcPath)) return false;

  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name === "liberth-neural";
  } catch {
    return false;
  }
}

function resolveProjectRoot() {
  let cursor = currentDir;
  for (let step = 0; step < 8; step += 1) {
    if (isProjectRoot(cursor)) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path.resolve(currentDir, "..");
}

export const projectRoot = resolveProjectRoot();
export const storeFilePath = path.join(projectRoot, "data", "store.json");
export const clientDistPath = path.join(projectRoot, "dist", "client");
export const agentsDataRoot = path.join(projectRoot, "data", "agents");
export const bundledSkillsPath = path.join(projectRoot, "skills");
export const localSkillPaths = [
  path.join(os.homedir(), ".openclaw", "skills"),
  path.join(os.homedir(), ".codex", "skills"),
  path.join(os.homedir(), ".agents", "skills"),
];

export function characterWorkspaceRoot(characterId: string) {
  return path.join(agentsDataRoot, characterId);
}

export function characterBootstrapPath(characterId: string) {
  return path.join(characterWorkspaceRoot(characterId), "workspace");
}

export function characterSkillsPath(characterId: string) {
  return path.join(characterWorkspaceRoot(characterId), "skills");
}
