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
  MarketListingRecord,
  ProviderSettings,
  StoreShape,
  WorkRunRecord,
} from "../src/types";
import { getProviderCatalogItem } from "../src/types";
import { storeFilePath } from "./project-paths";

export const DEFAULT_GLM_MODEL = "glm-4-flash-250414";

function trimValue(value: unknown) {
  return String(value || "").trim();
}

function hasProviderOverrides(
  input?: Partial<ProviderSettings> & {
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    openaiModel?: string;
  },
) {
  return Boolean(
    trimValue(input?.apiKey) ||
      trimValue(input?.baseUrl) ||
      trimValue(input?.model) ||
      trimValue(input?.openaiApiKey) ||
      trimValue(input?.openaiBaseUrl) ||
      trimValue(input?.openaiModel),
  );
}

export function normalizeProviderSettings(
  input?: Partial<ProviderSettings> & {
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    openaiModel?: string;
  },
): ProviderSettings {
  const providerMode =
    input?.providerMode && getProviderCatalogItem(input.providerMode).id === input.providerMode
      ? input.providerMode
      : hasProviderOverrides(input)
        ? "openai-compatible"
        : "glm-main";
  const preset = getProviderCatalogItem(providerMode);

  return {
    providerMode,
    glmModel: trimValue(input?.glmModel) || DEFAULT_GLM_MODEL,
    apiKey: trimValue(input?.apiKey) || trimValue(input?.openaiApiKey),
    baseUrl:
      trimValue(input?.baseUrl) || trimValue(input?.openaiBaseUrl) || preset.defaultBaseUrl || "",
    model: trimValue(input?.model) || trimValue(input?.openaiModel) || preset.defaultModel || "",
    anthropicVersion: trimValue(input?.anthropicVersion) || "2023-06-01",
    googleApiVersion: trimValue(input?.googleApiVersion) || "v1beta",
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
  workRuns: [],
  marketListings: [],
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

    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations.map((item) => ({
          ...item,
          messages: Array.isArray(item.messages) ? item.messages : [],
          compaction: item.compaction && typeof item.compaction === "object"
            ? {
                summary: String(item.compaction.summary || "").trim(),
                updatedAt: Number(item.compaction.updatedAt || item.updatedAt || Date.now()),
                sourceMessageCount: Math.max(
                  0,
                  Number(item.compaction.sourceMessageCount || 0),
                ),
                count: Math.max(0, Number(item.compaction.count || 0)),
                instructions: String(item.compaction.instructions || "").trim() || undefined,
              }
            : null,
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

    const workRuns = Array.isArray(parsed.workRuns)
      ? parsed.workRuns.map((item) => ({
          ...item,
          title: String(item.title || "").trim(),
          summary: String(item.summary || "").trim(),
          objective: String(item.objective || "").trim(),
          userMessage: String(item.userMessage || "").trim(),
          taskType:
            item.taskType === "spec" || item.taskType === "delivery"
              ? item.taskType
              : ("analysis" as const),
          executionPath:
            item.executionPath === "planned_runtime" || item.executionPath === "grouped_work"
              ? item.executionPath
              : ("direct_runtime" as const),
          status:
            item.status === "queued"
              || item.status === "running"
              || item.status === "completed"
              || item.status === "failed"
              ? item.status
              : ("queued" as const),
          qaStatus:
            item.qaStatus === "passed" || item.qaStatus === "failed"
              ? item.qaStatus
              : ("pending" as const),
          publicationCandidate: item.publicationCandidate === true,
          stageNotes: Array.isArray(item.stageNotes)
            ? item.stageNotes.map((note) => String(note || "").trim()).filter(Boolean)
            : [],
          artifacts: Array.isArray(item.artifacts)
            ? item.artifacts.map((artifact) => ({
                ...artifact,
                title: String(artifact.title || "").trim(),
                content: String(artifact.content || ""),
                kind:
                  artifact.kind === "plan"
                  || artifact.kind === "delivery"
                  || artifact.kind === "qa"
                  || artifact.kind === "repair"
                  || artifact.kind === "publication"
                    ? artifact.kind
                    : ("brief" as const),
                status:
                  artifact.status === "accepted" || artifact.status === "rejected"
                    ? artifact.status
                    : ("created" as const),
                notes: Array.isArray(artifact.notes)
                  ? artifact.notes.map((note) => String(note || "").trim()).filter(Boolean)
                  : undefined,
              }))
            : [],
        }))
      : [];

    const marketListings = Array.isArray(parsed.marketListings)
      ? parsed.marketListings.map((item) => ({
          ...item,
          title: String(item.title || "").trim(),
          summary: String(item.summary || "").trim(),
          artifactKind:
            item.artifactKind === "plan"
            || item.artifactKind === "delivery"
            || item.artifactKind === "qa"
            || item.artifactKind === "repair"
            || item.artifactKind === "publication"
              ? item.artifactKind
              : ("brief" as const),
          status: item.status === "published" ? "published" : "draft",
          tags: Array.isArray(item.tags)
            ? item.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
            : [],
        }))
      : [];

    return {
      ...defaultStore,
      ...parsed,
      characters,
      conversations,
      installedSkills,
      automations,
      automationRuns,
      workRuns,
      marketListings,
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

export function upsertWorkRun(store: StoreShape, workRun: WorkRunRecord) {
  const index = store.workRuns.findIndex((item) => item.id === workRun.id);
  if (index >= 0) {
    store.workRuns[index] = workRun;
    return;
  }
  store.workRuns.unshift(workRun);
  store.workRuns = store.workRuns.slice(0, 120);
}

export function upsertMarketListing(store: StoreShape, listing: MarketListingRecord) {
  const index = store.marketListings.findIndex((item) => item.id === listing.id);
  if (index >= 0) {
    store.marketListings[index] = listing;
    return;
  }
  store.marketListings.unshift(listing);
  store.marketListings = store.marketListings.slice(0, 120);
}
