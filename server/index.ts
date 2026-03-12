import "./env";
import express from "express";
import { promises as fs } from "fs";
import path from "path";
import type {
  CharacterRecord,
  ConversationRecord,
  NeuralMemoryRecord,
  ProviderSettings,
  RoleDefinitionInput,
} from "../src/types";
import {
  deriveDurableMemoryCandidate,
  deriveNeuralStateSnapshot,
} from "./neural-engine";
import {
  defaultProviderSettings,
  normalizeProviderSettings,
  randomId,
  readStore,
  slugify,
  updateStore,
  upsertCharacter,
  upsertConversation,
} from "./store";
import type { LlmRuntimeConfig } from "./llm";
import {
  buildCharacterRuntimeSystemPrompt,
  generateBlueprint,
  generateRoleReplyDetailed,
} from "./roles";
import { clientDistPath } from "./project-paths";

const app = express();
const port = Number(process.env.PORT || 4318);

app.use(express.json({ limit: "2mb" }));

function ensureRoleDefinition(input: any): RoleDefinitionInput {
  return {
    name: String(input?.name || "").trim(),
    oneLiner: String(input?.oneLiner || "").trim(),
    domain: String(input?.domain || "").trim(),
    audience: String(input?.audience || "").trim(),
    tone: String(input?.tone || "").trim(),
    personality: String(input?.personality || "").trim(),
    goals: String(input?.goals || "").trim(),
    boundaries: String(input?.boundaries || "").trim(),
    knowledge: String(input?.knowledge || "").trim(),
    greeting: String(input?.greeting || "").trim(),
    language: String(input?.language || "Chinese").trim() || "Chinese",
  };
}

function validateDefinition(definition: RoleDefinitionInput) {
  if (!definition.name) {
    throw new Error("Character name is required");
  }
  if (!definition.oneLiner) {
    throw new Error("One-liner is required");
  }
  if (!definition.personality) {
    throw new Error("Personality is required");
  }
}

function ensureProviderSettings(input: any): ProviderSettings {
  return normalizeProviderSettings(input);
}

async function resolveProviderSettings() {
  const store = await readStore();
  return normalizeProviderSettings({
    ...defaultProviderSettings(),
    ...(store.settings?.provider || {}),
  });
}

function providerToRuntimeConfig(provider: ProviderSettings): LlmRuntimeConfig {
  return provider.providerMode === "glm-main"
    ? {
        providerMode: "glm-main",
        glmModel: provider.glmModel,
      }
    : {
        providerMode: "openai-compatible",
        glmModel: provider.glmModel,
        apiKey: provider.openaiApiKey,
        baseUrl: provider.openaiBaseUrl,
        model: provider.openaiModel,
      };
}

function starterConversation(character: CharacterRecord) {
  return [
    {
      id: randomId("msg"),
      role: "assistant" as const,
      content: character.blueprint.greeting,
      createdAt: Date.now(),
    },
  ];
}

async function createConversationRecord(
  character: CharacterRecord,
  conversationId?: string,
): Promise<ConversationRecord> {
  const store = await readStore();
  if (conversationId) {
    const existing = store.conversations.find((item) => item.id === conversationId);
    if (existing) return existing;
  }

  return {
    id: randomId("conv"),
    characterId: character.id,
    title: `${character.definition.name} neural chat`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: starterConversation(character),
  };
}

function toThreadMemories(conversation: ConversationRecord): NeuralMemoryRecord[] {
  return conversation.messages.slice(-12).map((message, index) => ({
    id: `thread_${index + 1}`,
    scope: "thread",
    content: `${message.role}: ${message.content}`,
    createdAt: message.createdAt,
    sourceRoute: undefined,
  }));
}

function normalizeMemoryText(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function appendGlobalMemory(
  memories: NeuralMemoryRecord[],
  content: string | null,
  sourceRoute?: string,
) {
  const normalized = normalizeMemoryText(content || "");
  if (!normalized) return memories;
  if (memories.some((item) => normalizeMemoryText(item.content) === normalized)) {
    return memories;
  }
  const nextMemory: NeuralMemoryRecord = {
    id: randomId("mem"),
    scope: "global",
    content: String(content || "").trim(),
    createdAt: Date.now(),
    sourceRoute: sourceRoute as NeuralMemoryRecord["sourceRoute"],
  };
  return [...memories, nextMemory].slice(-24);
}

async function hydrateCharacter(character: CharacterRecord) {
  const needsBlueprint =
    !character.blueprint?.profile
    || !character.blueprint?.neuralGraph
    || !character.blueprint?.bundleFiles;
  if (!needsBlueprint) {
    return character;
  }
  const blueprint = await generateBlueprint(character.definition);
  const nextCharacter: CharacterRecord = {
    ...character,
    blueprint,
    globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
    lastNeuralState: character.lastNeuralState || null,
    updatedAt: Date.now(),
  };
  await updateStore((store) => {
    upsertCharacter(store, nextCharacter);
  });
  return nextCharacter;
}

async function getCharacterById(characterId: string) {
  const store = await readStore();
  const character = store.characters.find((item) => item.id === characterId) || null;
  if (!character) return null;
  return hydrateCharacter(character);
}

app.get("/api/health", async (_req, res) => {
  const store = await readStore();
  res.json({
    ok: true,
    mode: "neural-chat",
    characters: store.characters.length,
    conversations: store.conversations.length,
  });
});

app.get("/api/characters", async (_req, res) => {
  const store = await readStore();
  const characters = await Promise.all(store.characters.map((item) => hydrateCharacter(item)));
  res.json({ characters });
});

app.get("/api/settings/provider", async (_req, res) => {
  res.json({ provider: await resolveProviderSettings() });
});

app.put("/api/settings/provider", async (req, res) => {
  const provider = ensureProviderSettings(req.body?.provider);
  await updateStore((store) => {
    store.settings = { provider };
  });
  res.json({ provider });
});

app.post("/api/characters/generate", async (req, res) => {
  try {
    const definition = ensureRoleDefinition(req.body?.definition);
    validateDefinition(definition);
    const blueprint = await generateBlueprint(definition);
    res.json({ blueprint });
  } catch (error: any) {
    res.status(400).json({ message: String(error?.message || error) });
  }
});

app.post("/api/characters", async (req, res) => {
  try {
    const definition = ensureRoleDefinition(req.body?.definition);
    validateDefinition(definition);
    const blueprint = req.body?.blueprint || (await generateBlueprint(definition));
    const character: CharacterRecord = {
      id: randomId("char"),
      slug: slugify(definition.name) || randomId("neural"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      definition,
      blueprint,
      globalMemories: [],
      lastNeuralState: null,
      skillIds: [],
    };
    await updateStore((store) => {
      upsertCharacter(store, character);
    });
    res.json({ character });
  } catch (error: any) {
    res.status(400).json({ message: String(error?.message || error) });
  }
});

app.put("/api/characters", async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) throw new Error("Character id is required");

    const definition = ensureRoleDefinition(req.body?.definition);
    validateDefinition(definition);

    const store = await readStore();
    const existing = store.characters.find((item) => item.id === id);
    if (!existing) {
      return res.status(404).json({ message: "Character not found" });
    }

    const blueprint = req.body?.blueprint || (await generateBlueprint(definition));
    const character: CharacterRecord = {
      ...existing,
      slug: slugify(definition.name) || existing.slug,
      updatedAt: Date.now(),
      definition,
      blueprint,
      globalMemories: Array.isArray(existing.globalMemories) ? existing.globalMemories : [],
      lastNeuralState: existing.lastNeuralState || null,
    };
    await updateStore((draft) => {
      upsertCharacter(draft, character);
    });
    res.json({ character });
  } catch (error: any) {
    res.status(400).json({ message: String(error?.message || error) });
  }
});

app.get("/api/conversations", async (req, res) => {
  const characterId = String(req.query.characterId || "").trim();
  const store = await readStore();
  const conversation =
    store.conversations.find((item) => item.characterId === characterId) || null;
  res.json({ conversation });
});

app.post("/api/chat", async (req, res) => {
  try {
    const characterId = String(req.body?.characterId || "").trim();
    const message = String(req.body?.message || "").trim();
    const conversationId = String(req.body?.conversationId || "").trim();
    if (!characterId) throw new Error("characterId is required");
    if (!message) throw new Error("message is required");

    const character = await getCharacterById(characterId);
    if (!character) {
      return res.status(404).json({ message: "Character not found" });
    }

    const provider = await resolveProviderSettings();
    const conversation = await createConversationRecord(character, conversationId || undefined);
    const threadMemories = toThreadMemories(conversation);
    const globalMemories = Array.isArray(character.globalMemories) ? character.globalMemories : [];
    const neuralState = deriveNeuralStateSnapshot({
      actorType: "clone",
      personaKind: "clone_user",
      message,
      profile: character.blueprint.profile || null,
      graph: character.blueprint.neuralGraph || null,
      threadMemories,
      globalMemories,
      runtimeSkills: [],
    });

    const systemPrompt = buildCharacterRuntimeSystemPrompt({
      bundleFiles: character.blueprint.bundleFiles,
      definition: character.definition,
      neuralState,
      globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
    });

    const history = conversation.messages.slice(-10).map((item) => ({
      role: item.role,
      content: item.content,
    }));

    const replyResult = await generateRoleReplyDetailed({
      systemPrompt,
      history,
      userMessage: message,
      config: providerToRuntimeConfig(provider),
    });

    const userEntry = {
      id: randomId("msg"),
      role: "user" as const,
      content: message,
      createdAt: Date.now(),
    };
    const assistantEntry = {
      id: randomId("msg"),
      role: "assistant" as const,
      content: replyResult.reply,
      createdAt: Date.now(),
    };

    const nextConversation: ConversationRecord = {
      ...conversation,
      title: conversation.messages.length <= 1
        ? message.slice(0, 48) || conversation.title
        : conversation.title,
      updatedAt: Date.now(),
      messages: [...conversation.messages, userEntry, assistantEntry],
    };

    const durableMemory = deriveDurableMemoryCandidate(message, neuralState);
    const nextCharacter: CharacterRecord = {
      ...character,
      updatedAt: Date.now(),
      lastNeuralState: neuralState as CharacterRecord["lastNeuralState"],
      globalMemories: appendGlobalMemory(
        Array.isArray(character.globalMemories) ? character.globalMemories : [],
        durableMemory,
        neuralState.dominantRoute,
      ),
    };

    await updateStore((store) => {
      upsertCharacter(store, nextCharacter);
      upsertConversation(store, nextConversation);
    });

    res.json({
      character: nextCharacter,
      conversation: nextConversation,
      neuralState,
      generation: replyResult.generation,
    });
  } catch (error: any) {
    res.status(400).json({ message: String(error?.message || error) });
  }
});

app.use(express.static(clientDistPath));

app.get("*", async (_req, res) => {
  const indexPath = path.join(clientDistPath, "index.html");
  try {
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch {
    res.status(404).send("liberth-neural client is not built yet.");
  }
});

app.listen(port, () => {
  console.log(`liberth-neural listening on http://localhost:${port}`);
});
