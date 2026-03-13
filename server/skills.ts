import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { completeJsonDetailed } from "./llm";
import type { LlmRuntimeConfig } from "./llm";
import type {
  CharacterRecord,
  InstalledSkillRecord,
  SkillCatalogItem,
  StoreShape,
} from "../src/types";
import {
  bundledSkillsPath,
  characterSkillsPath,
  localSkillPaths,
} from "./project-paths";

type ChatCommand =
  | { type: "none" }
  | { type: "list-skills" }
  | { type: "install-skill"; skillId: string }
  | { type: "detach-skill"; skillId: string }
  | { type: "use-skill"; skillId: string; task: string }
  | { type: "search"; query: string }
  | { type: "compact"; instructions?: string };

type SkillSource = "workspace" | "local" | "bundled";
const execFileAsync = promisify(execFile);
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
const EXTERNAL_SEARCH_CACHE_TTL_MS = 30_000;

type ResolvedSkill = SkillCatalogItem & {
  skillDir?: string;
  skillFile?: string;
};

const CATALOG_CACHE_TTL_MS = 30_000;
let cachedCatalog: ResolvedSkill[] = [];
let cachedAt = 0;
const externalSearchCache = new Map<string, { createdAt: number; skills: ResolvedSkill[] }>();

type SkillSearchPlan = {
  queries: string[];
};

function looksLikeExternalPackageRef(input: string) {
  const value = String(input || "").trim();
  return value.includes("/") && value.includes("@");
}

function skillIdFromPackageRef(packageRef: string) {
  const trimmed = String(packageRef || "").trim();
  const skillId = trimmed.split("@").pop() || trimmed;
  return skillId.trim();
}

function stripAnsi(input: string) {
  return String(input || "").replace(ANSI_ESCAPE_PATTERN, "");
}

function parseFrontmatter(raw: string) {
  if (!raw.startsWith("---\n")) return { attributes: {}, body: raw };
  const endIndex = raw.indexOf("\n---\n", 4);
  if (endIndex === -1) return { attributes: {}, body: raw };

  const header = raw.slice(4, endIndex).trim();
  const body = raw.slice(endIndex + 5);
  const attributes: Record<string, string> = {};

  for (const line of header.split(/\r?\n/)) {
    const divider = line.indexOf(":");
    if (divider <= 0) continue;
    const key = line.slice(0, divider).trim();
    const value = line.slice(divider + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) attributes[key] = value;
  }

  return { attributes, body };
}

async function walkForSkillFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkForSkillFiles(absolute)));
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      results.push(absolute);
    }
  }

  return results;
}

function buildSkillId(skillFile: string) {
  return path.basename(path.dirname(skillFile)).trim();
}

async function parseSkillFile(skillFile: string, source: SkillSource): Promise<ResolvedSkill | null> {
  const raw = await fs.readFile(skillFile, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  const { attributes, body } = parseFrontmatter(raw);

  const id = buildSkillId(skillFile);
  const description =
    String(attributes.description || "")
      .trim()
      .replace(/\s+/g, " ") ||
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ||
    "Skill without description";

  return {
    id,
    name: String(attributes.name || id).trim(),
    level: "advanced",
    description,
    tags: [],
    source,
    sourcePath: path.dirname(skillFile),
    skillDir: path.dirname(skillFile),
    skillFile,
  };
}

function parseExternalSearchOutput(output: string): ResolvedSkill[] {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ResolvedSkill[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([^\s]+@[^\s]+)(?:\s+(\d+)\s+installs?)?$/i);
    if (!match) continue;

    const packageRef = match[1];
    const installUrl = lines[index + 1]?.startsWith("└ ")
      ? lines[index + 1].slice(2).trim()
      : undefined;
    const skillId = skillIdFromPackageRef(packageRef);

    results.push({
      id: skillId,
      name: skillId,
      level: "external",
      description: `Installable external skill from ${packageRef.split("@")[0]}.`,
      tags: [],
      source: "external",
      sourcePath: packageRef,
      packageRef,
      installUrl,
      installs: match[2] ? Number(match[2]) : undefined,
    });
  }

  return results;
}

async function searchExternalSkills(query: string): Promise<ResolvedSkill[]> {
  const normalized = String(query || "").trim();
  if (!normalized) return [];

  const cacheKey = normalized.toLowerCase();
  const cached = externalSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < EXTERNAL_SEARCH_CACHE_TTL_MS) {
    return cached.skills;
  }

  const { stdout = "", stderr = "" } = await execFileAsync(
    "npx",
    ["skills", "find", normalized],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );

  const skills = parseExternalSearchOutput(`${stdout}\n${stderr}`);
  externalSearchCache.set(cacheKey, {
    createdAt: Date.now(),
    skills,
  });
  return skills;
}

function fallbackSkillSearchQueries(query: string): SkillSearchPlan {
  const raw = String(query || "").trim();
  const normalized = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = normalized.split(" ").slice(0, 5).join(" ").trim();
  return {
    queries: Array.from(
      new Set([compact || normalized || raw, raw].map((item) => item.trim()).filter(Boolean)),
    ).slice(0, 2),
  };
}

async function buildSkillSearchPlan(
  query: string,
  config?: LlmRuntimeConfig,
): Promise<SkillSearchPlan> {
  if (looksLikeExternalPackageRef(query)) {
    return { queries: [query] };
  }

  const result = await completeJsonDetailed<SkillSearchPlan>(
    [
      {
        role: "system",
        content: [
          "You convert a user's software capability request into short search queries for the skills.sh ecosystem.",
          "Return strict JSON only: {\"queries\":[\"query 1\",\"query 2\",\"query 3\"]}.",
          "Rules:",
          "- Produce 1 to 3 concise queries.",
          "- Prefer English search terms because most skill listings are in English.",
          "- Focus on software capability, workflow, framework, or domain keywords.",
          "- Do not explain. Do not add extra keys.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Need: ${query}`,
      },
    ],
    () => fallbackSkillSearchQueries(query),
    config,
  );

  const planned = Array.isArray(result.value?.queries)
    ? result.value.queries.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (planned.length === 0) {
    return fallbackSkillSearchQueries(query);
  }
  return {
    queries: Array.from(new Set(planned)).slice(0, 3),
  };
}

async function scanSourceDirs(
  source: SkillSource,
  roots: string[],
  seen: Set<string>,
): Promise<ResolvedSkill[]> {
  const results: ResolvedSkill[] = [];
  for (const root of roots) {
    const files = await walkForSkillFiles(root);
    for (const skillFile of files) {
      const skill = await parseSkillFile(skillFile, source);
      if (!skill) continue;
      const key = skill.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(skill);
    }
  }
  return results;
}

async function scanCatalog() {
  const now = Date.now();
  if (cachedCatalog.length > 0 && now - cachedAt < CATALOG_CACHE_TTL_MS) {
    return cachedCatalog;
  }

  const seen = new Set<string>();
  const local = await scanSourceDirs("local", localSkillPaths, seen);
  const bundled = await scanSourceDirs("bundled", [bundledSkillsPath], seen);
  cachedCatalog = [...local, ...bundled];
  cachedAt = now;
  return cachedCatalog;
}

export async function listSkillCatalog(query?: string, config?: LlmRuntimeConfig) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return [];

  const plan = await buildSkillSearchPlan(normalized, config);
  const merged = new Map<string, ResolvedSkill>();
  for (const plannedQuery of plan.queries) {
    const skills = await searchExternalSkills(plannedQuery);
    for (const skill of skills) {
      const key = skill.packageRef || skill.id;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, skill);
        continue;
      }
      if ((skill.installs || 0) > (existing.installs || 0)) {
        merged.set(key, skill);
      }
    }
  }

  return Array.from(merged.values()).sort((left, right) => {
    const installGap = (right.installs || 0) - (left.installs || 0);
    if (installGap !== 0) return installGap;
    return left.name.localeCompare(right.name);
  });
}

async function resolveWorkspaceSkill(characterId: string, skillId: string): Promise<ResolvedSkill | null> {
  const skillFile = path.join(characterSkillsPath(characterId), skillId, "SKILL.md");
  return parseSkillFile(skillFile, "workspace");
}

export async function findSkillById(skillId: string, characterId?: string) {
  const normalized = String(skillId || "").trim().toLowerCase();
  if (!normalized) return null;

  if (characterId) {
    const workspaceSkill = await resolveWorkspaceSkill(characterId, normalized);
    if (workspaceSkill) return workspaceSkill;
  }

  const catalog = await scanCatalog();
  return catalog.find((item) => item.id.toLowerCase() === normalized) || null;
}

async function copySkillDirectoryToWorkspace(skill: ResolvedSkill, characterId: string) {
  if (!skill.skillDir) {
    throw new Error(`Skill is not installed locally yet: ${skill.id}`);
  }
  const targetDir = path.join(characterSkillsPath(characterId), skill.id);
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.cp(skill.skillDir, targetDir, { recursive: true });
  return targetDir;
}

async function installExternalSkill(packageRef: string): Promise<ResolvedSkill> {
  const normalizedRef = String(packageRef || "").trim();
  if (!looksLikeExternalPackageRef(normalizedRef)) {
    throw new Error(`Invalid external skill reference: ${packageRef}`);
  }

  await execFileAsync(
    "npx",
    ["skills", "add", normalizedRef, "-g", "-y"],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 4,
    },
  );

  cachedCatalog = [];
  cachedAt = 0;

  const skillId = skillIdFromPackageRef(normalizedRef);
  const installed = await findSkillById(skillId);
  if (!installed) {
    throw new Error(`Installed external skill could not be resolved locally: ${normalizedRef}`);
  }
  return installed;
}

export async function ensureSkillInstalled(
  store: StoreShape,
  skillId: string,
  characterId: string,
  packageRef?: string,
) {
  if (!String(characterId || "").trim()) {
    throw new Error("characterId is required to install a skill into a character workspace");
  }

  const externalRef = packageRef || (looksLikeExternalPackageRef(skillId) ? skillId : undefined);
  const requestedSkillId = externalRef ? skillIdFromPackageRef(externalRef) : skillId;

  let skill = await findSkillById(requestedSkillId, characterId);
  if (!skill && externalRef) {
    skill = await installExternalSkill(externalRef);
  }
  if (!skill) {
    throw new Error(`Unknown skill: ${skillId}`);
  }

  if (skill.source !== "workspace") {
    await copySkillDirectoryToWorkspace(skill, characterId);
  }

  const record: InstalledSkillRecord = {
    skillId: skill.id,
    installedAt: Date.now(),
    enabled: true,
    source: "workspace",
  };

  const existing = store.installedSkills.find((item) => item.skillId === skill.id);
  if (existing) {
    existing.enabled = true;
    existing.source = "workspace";
    return existing;
  }

  store.installedSkills.unshift(record);
  return record;
}

export async function attachSkillToCharacter(
  store: StoreShape,
  characterId: string,
  skillId: string,
) {
  const character = store.characters.find((item) => item.id === characterId);
  if (!character) throw new Error("Character not found");
  const record = await ensureSkillInstalled(store, skillId, characterId);
  if (!Array.isArray(character.skillIds)) {
    character.skillIds = [];
  }
  if (!character.skillIds.includes(record.skillId)) {
    character.skillIds.push(record.skillId);
  }
  character.updatedAt = Date.now();
  return character;
}

export function detachSkillFromCharacter(store: StoreShape, characterId: string, skillId: string) {
  const character = store.characters.find((item) => item.id === characterId);
  if (!character) throw new Error("Character not found");
  character.skillIds = (character.skillIds || []).filter((item) => item !== skillId);
  character.updatedAt = Date.now();
  if (!store.characters.some((item) => (item.skillIds || []).includes(skillId))) {
    store.installedSkills = store.installedSkills.filter((item) => item.skillId !== skillId);
  }
  return character;
}

export async function removeWorkspaceSkill(characterId: string, skillId: string) {
  const targetDir = path.join(characterSkillsPath(characterId), skillId);
  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function resolveCharacterSkills(character?: CharacterRecord | null) {
  const skillIds = Array.isArray(character?.skillIds) ? character!.skillIds : [];
  const skills = await Promise.all(
    skillIds.map((skillId) => findSkillById(skillId, character?.id)),
  );
  return skills.filter((item): item is ResolvedSkill => Boolean(item));
}

export async function loadActiveSkill(
  character: CharacterRecord,
  skillId?: string,
): Promise<{ meta: ResolvedSkill; content: string } | null> {
  if (!skillId) return null;
  const skill = await findSkillById(skillId, character.id);
  if (!skill || !skill.skillFile) return null;
  const content = await fs.readFile(skill.skillFile, "utf8").catch(() => "");
  if (!content.trim()) return null;
  return { meta: skill, content };
}

export async function loadAttachedSkills(
  character?: CharacterRecord | null,
  options?: { limit?: number },
): Promise<Array<{ meta: ResolvedSkill; content: string }>> {
  const skills = await resolveCharacterSkills(character);
  const limit = Math.max(1, Number(options?.limit || skills.length || 1));
  const selected = skills.slice(0, limit);
  const loaded = await Promise.all(
    selected.map(async (skill) => {
      if (!skill.skillFile) return null;
      const content = await fs.readFile(skill.skillFile, "utf8").catch(() => "");
      if (!content.trim()) return null;
      return { meta: skill, content };
    }),
  );
  return loaded.filter((item): item is { meta: ResolvedSkill; content: string } => Boolean(item));
}

export async function formatSkillListReply(character?: CharacterRecord | null) {
  const skills = await resolveCharacterSkills(character);
  if (skills.length === 0) {
    return [
      "当前角色还没有附加 skills。",
      "可用命令：",
      "- /install-skill search-specialist",
      "- /install-skill brave-search",
      "- /use-skill search-specialist 帮我设计检索策略",
      "- /search OpenClaw skills runtime design",
    ].join("\n");
  }

  return [
    "当前角色已附加 skills：",
    ...skills.map(
      (skill) => `- ${skill.name} (${skill.id}) [${skill.source}]: ${skill.description}`,
    ),
  ].join("\n");
}

export function parseChatCommand(message: string): ChatCommand {
  const input = String(message || "").trim();
  if (!input) return { type: "none" };

  if (
    /^\/skills$/i.test(input) ||
    /^列出skills?$/i.test(input) ||
    /^查看skills?$/i.test(input)
  ) {
    return { type: "list-skills" };
  }

  const installMatch =
    input.match(/^\/install-skill\s+([a-z0-9-_.\/@]+)$/i) ||
    input.match(/^安装skills?\s+([a-z0-9-_.\/@]+)$/i);
  if (installMatch) {
    return { type: "install-skill", skillId: installMatch[1] };
  }

  const detachMatch =
    input.match(/^\/detach-skill\s+([a-z0-9-_.]+)$/i) ||
    input.match(/^移除skills?\s+([a-z0-9-_.]+)$/i);
  if (detachMatch) {
    return { type: "detach-skill", skillId: detachMatch[1] };
  }

  const useMatch =
    input.match(/^\/use-skill\s+([a-z0-9-_.]+)\s+([\s\S]+)$/i) ||
    input.match(/^使用skills?\s+([a-z0-9-_.]+)\s+([\s\S]+)$/i);
  if (useMatch) {
    return { type: "use-skill", skillId: useMatch[1], task: useMatch[2].trim() };
  }

  const searchMatch =
    input.match(/^\/search\s+([\s\S]+)$/i) ||
    input.match(/^(?:搜索|search)\s+([\s\S]+)$/i);
  if (searchMatch) {
    return { type: "search", query: searchMatch[1].trim() };
  }

  const compactMatch =
    input.match(/^\/compact(?:\s+([\s\S]+))?$/i) ||
    input.match(/^压缩会话(?:\s+([\s\S]+))?$/i);
  if (compactMatch) {
    return {
      type: "compact",
      instructions: String(compactMatch[1] || "").trim() || undefined,
    };
  }

  return { type: "none" };
}
