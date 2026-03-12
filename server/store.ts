import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type {
  AutomationRecord,
  AutomationRunRecord,
  CharacterRecord,
  ConversationRecord,
  DeploymentRecord,
  InstalledSkillRecord,
  ProviderSettings,
  StoreShape,
} from "../src/types";
import { storeFilePath } from "./project-paths";

export const DEFAULT_GLM_MODEL = "glm-4-flash-250414";

function trimValue(value: unknown) {
  return String(value || "").trim();
}

function hasOpenAiOverrides(input?: Partial<ProviderSettings>) {
  return Boolean(
    trimValue(input?.openaiApiKey) ||
      trimValue(input?.openaiBaseUrl) ||
      trimValue(input?.openaiModel),
  );
}

export function normalizeProviderSettings(
  input?: Partial<ProviderSettings>,
): ProviderSettings {
  const openaiApiKey = trimValue(input?.openaiApiKey);
  const openaiBaseUrl = trimValue(input?.openaiBaseUrl);
  const openaiModel = trimValue(input?.openaiModel);
  const providerMode =
    input?.providerMode === "glm-main" || input?.providerMode === "openai-compatible"
      ? input.providerMode
      : hasOpenAiOverrides(input)
        ? "openai-compatible"
        : "glm-main";

  return {
    providerMode,
    glmModel: trimValue(input?.glmModel) || DEFAULT_GLM_MODEL,
    openaiApiKey,
    openaiBaseUrl,
    openaiModel,
  };
}

export const defaultProviderSettings = (): ProviderSettings =>
  normalizeProviderSettings();

const defaultStore: StoreShape = {
  characters: [],
  conversations: [],
  deployments: [],
  installedSkills: [],
  automations: [],
  automationRuns: [],
  settings: {
    provider: defaultProviderSettings(),
  },
};

async function ensureStoreDir() {
  await fs.mkdir(path.dirname(storeFilePath), { recursive: true });
}

function cloneStore(source: StoreShape): StoreShape {
  return JSON.parse(JSON.stringify(source)) as StoreShape;
}

export async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(storeFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    const characters = Array.isArray(parsed.characters)
      ? parsed.characters.map((item) => ({
          ...item,
          skillIds: Array.isArray(item.skillIds)
            ? item.skillIds.map((skillId) => String(skillId || "").trim()).filter(Boolean)
            : [],
        }))
      : [];

    const installedSkills = Array.isArray(parsed.installedSkills)
      ? parsed.installedSkills.map((item) => ({
          skillId: String(item.skillId || "").trim(),
          installedAt: Number(item.installedAt || Date.now()),
          enabled: item.enabled !== false,
          source:
            item.source === "workspace" || item.source === "local" || item.source === "bundled"
              ? item.source
              : ("workspace" as const),
        }))
      : [];

    const automations = Array.isArray(parsed.automations)
      ? parsed.automations.map((item) => ({
          ...item,
          name: String(item.name || "").trim(),
          prompt: String(item.prompt || "").trim(),
          intervalMinutes: Math.max(1, Number(item.intervalMinutes || 60)),
          enabled: item.enabled !== false,
        }))
      : [];

    const automationRuns = Array.isArray(parsed.automationRuns)
      ? parsed.automationRuns.map((item) => ({
          ...item,
          prompt: String(item.prompt || "").trim(),
          reply: String(item.reply || "").trim(),
          status: item.status === "error" ? "error" : "success",
        }))
      : [];

    return {
      ...defaultStore,
      ...parsed,
      characters,
      installedSkills,
      automations,
      automationRuns,
      settings: {
        provider: normalizeProviderSettings(parsed.settings?.provider || {}),
      },
    } as StoreShape;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return cloneStore(defaultStore);
    }
    throw error;
  }
}

export async function writeStore(store: StoreShape) {
  await ensureStoreDir();
  await fs.writeFile(storeFilePath, JSON.stringify(store, null, 2), "utf8");
}

export async function updateStore<T>(mutator: (store: StoreShape) => T | Promise<T>) {
  const store = await readStore();
  const result = await mutator(store);
  await writeStore(store);
  return result;
}

export function randomId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function slugify(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export function upsertCharacter(store: StoreShape, character: CharacterRecord) {
  const index = store.characters.findIndex((item) => item.id === character.id);
  if (index >= 0) {
    store.characters[index] = character;
    return;
  }
  store.characters.unshift(character);
}

export function upsertConversation(store: StoreShape, conversation: ConversationRecord) {
  const index = store.conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) {
    store.conversations[index] = conversation;
    return;
  }
  store.conversations.unshift(conversation);
}

export function upsertDeployment(store: StoreShape, deployment: DeploymentRecord) {
  const index = store.deployments.findIndex((item) => item.id === deployment.id);
  if (index >= 0) {
    store.deployments[index] = deployment;
    return;
  }
  store.deployments.unshift(deployment);
}

export function upsertInstalledSkill(store: StoreShape, skill: InstalledSkillRecord) {
  const index = store.installedSkills.findIndex((item) => item.skillId === skill.skillId);
  if (index >= 0) {
    store.installedSkills[index] = skill;
    return;
  }
  store.installedSkills.unshift(skill);
}

export function upsertAutomation(store: StoreShape, automation: AutomationRecord) {
  const index = store.automations.findIndex((item) => item.id === automation.id);
  if (index >= 0) {
    store.automations[index] = automation;
    return;
  }
  store.automations.unshift(automation);
}

export function appendAutomationRun(store: StoreShape, run: AutomationRunRecord) {
  store.automationRuns.unshift(run);
  store.automationRuns = store.automationRuns.slice(0, 120);
}
