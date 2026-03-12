import type {
  AutomationRecord,
  AutomationRunRecord,
  CharacterRecord,
  ProviderSettings,
} from "../src/types";
import {
  appendAutomationRun,
  randomId,
  readStore,
  updateStore,
  upsertAutomation,
} from "./store";
import { loadActiveSkill, loadAttachedSkills, resolveCharacterSkills } from "./skills";
import { buildRuntimeSystemPrompt, ensureCharacterWorkspace } from "./workspace";
import { runRoleAgentTurn } from "./agent-runtime";

type Dependencies = {
  resolveCharacter: (characterId: string) => Promise<CharacterRecord | null>;
  resolveProviderSettings: () => Promise<ProviderSettings>;
  providerToRuntimeConfig: (provider: ProviderSettings) => any;
};

type TimerHandle = ReturnType<typeof setTimeout>;

let schedulerDeps: Dependencies | null = null;
const timerMap = new Map<string, TimerHandle>();
let initialized = false;

function clearExistingTimer(id: string) {
  const timer = timerMap.get(id);
  if (timer) {
    clearTimeout(timer);
    timerMap.delete(id);
  }
}

function computeDelay(automation: AutomationRecord) {
  const now = Date.now();
  const intervalMs = Math.max(1, automation.intervalMinutes) * 60_000;
  const nextRunAt =
    automation.nextRunAt && automation.nextRunAt > now
      ? automation.nextRunAt
      : now + intervalMs;
  return Math.max(1_000, nextRunAt - now);
}

async function runAutomationTask(id: string): Promise<AutomationRunRecord> {
  if (!schedulerDeps) {
    throw new Error("Automation scheduler not initialized");
  }

  const store = await readStore();
  const automation = store.automations.find((item) => item.id === id);
  if (!automation) {
    throw new Error("Automation not found");
  }

  const character = await schedulerDeps.resolveCharacter(automation.characterId);
  if (!character) {
    throw new Error("Character not found");
  }

  const provider = await schedulerDeps.resolveProviderSettings();
  const prompt = automation.prompt.trim();
  if (!prompt) {
    throw new Error("Automation prompt is required");
  }

  await ensureCharacterWorkspace(character);
  const availableSkills = await resolveCharacterSkills(character);
  const attachedSkills = await loadAttachedSkills(character, { limit: 4 });
  const activeSkill = await loadActiveSkill(character);

  const result = await runRoleAgentTurn({
    character,
    systemPrompt: await buildRuntimeSystemPrompt({
      character,
      availableSkills,
      attachedSkills,
      activeSkill,
    }),
    history: [],
    userMessage: prompt,
    config: schedulerDeps.providerToRuntimeConfig(provider),
    allowMutatingTools: false,
  });

  const now = Date.now();
  const run: AutomationRunRecord = {
    id: randomId("run"),
    automationId: automation.id,
    characterId: automation.characterId,
    prompt,
    status: "success",
    reply: result.reply,
    createdAt: now,
    generation: result.generation,
  };

  await updateStore((draft) => {
    const target = draft.automations.find((item) => item.id === automation.id);
    if (target) {
      target.lastRunAt = now;
      target.nextRunAt = now + target.intervalMinutes * 60_000;
      target.updatedAt = now;
    }
    appendAutomationRun(draft, run);
  });

  return run;
}

async function runAutomationTaskSafely(id: string) {
  try {
    await runAutomationTask(id);
  } catch (error: any) {
    const store = await readStore();
    const automation = store.automations.find((item) => item.id === id);
    if (!automation) return;
    const now = Date.now();
    await updateStore((draft) => {
      const target = draft.automations.find((item) => item.id === id);
      if (target) {
        target.lastRunAt = now;
        target.nextRunAt = now + target.intervalMinutes * 60_000;
        target.updatedAt = now;
      }
      appendAutomationRun(draft, {
        id: randomId("run"),
        automationId: id,
        characterId: automation.characterId,
        prompt: automation.prompt,
        status: "error",
        reply: "",
        error: String(error?.message || error || "automation_failed"),
        createdAt: now,
      });
    });
  } finally {
    await syncAutomationScheduler();
  }
}

function scheduleOne(automation: AutomationRecord) {
  clearExistingTimer(automation.id);
  if (!automation.enabled) return;

  const delay = computeDelay(automation);
  const timer = setTimeout(() => {
    void runAutomationTaskSafely(automation.id);
  }, delay);
  timerMap.set(automation.id, timer);
}

export async function syncAutomationScheduler() {
  if (!schedulerDeps) return;
  const store = await readStore();
  const activeIds = new Set(store.automations.map((item) => item.id));

  for (const automationId of Array.from(timerMap.keys())) {
    if (!activeIds.has(automationId)) {
      clearExistingTimer(automationId);
    }
  }

  for (const automation of store.automations) {
    scheduleOne(automation);
  }
}

export async function initializeAutomationScheduler(deps: Dependencies) {
  schedulerDeps = deps;
  if (initialized) {
    await syncAutomationScheduler();
    return;
  }
  initialized = true;
  await syncAutomationScheduler();
}

export async function createOrUpdateAutomation(input: {
  id?: string;
  characterId: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled?: boolean;
}) {
  const now = Date.now();
  const automation: AutomationRecord = {
    id: input.id || randomId("auto"),
    characterId: input.characterId,
    name: String(input.name || "").trim(),
    prompt: String(input.prompt || "").trim(),
    intervalMinutes: Math.max(1, Number(input.intervalMinutes || 60)),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    nextRunAt: now + Math.max(1, Number(input.intervalMinutes || 60)) * 60_000,
  };

  await updateStore((draft) => {
    const existing = draft.automations.find((item) => item.id === automation.id);
    if (existing) {
      automation.createdAt = existing.createdAt;
    }
    upsertAutomation(draft, automation);
  });
  await syncAutomationScheduler();
  return automation;
}

export async function deleteAutomation(id: string) {
  let deleted = false;
  await updateStore((draft) => {
    const before = draft.automations.length;
    draft.automations = draft.automations.filter((item) => item.id !== id);
    deleted = draft.automations.length !== before;
  });
  clearExistingTimer(id);
  return deleted;
}

export async function runAutomationNow(id: string) {
  const result = await runAutomationTask(id);
  await syncAutomationScheduler();
  return result;
}
