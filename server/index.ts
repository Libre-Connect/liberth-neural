import "./env";
import express from "express";
import { promises as fs } from "fs";
import path from "path";
import type {
  CharacterRecord,
  ConversationRecord,
  DeploymentChannel,
  DeploymentPlatformKey,
  DeploymentRecord,
  NeuralMemoryRecord,
  NeuralRecord,
  ProviderSettings,
  RoleDefinitionInput,
} from "../src/types";
import { providerCatalog } from "../src/types";
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
  upsertDeployment,
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
        providerMode: provider.providerMode,
        glmModel: provider.glmModel,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
        anthropicVersion: provider.anthropicVersion,
        googleApiVersion: provider.googleApiVersion,
      };
}

function buildAssistantNeuralRecord(input: {
  generation: NonNullable<ConversationRecord["messages"][number]["generation"]>;
  neuralState: CharacterRecord["lastNeuralState"];
  durableMemoryCandidate: string | null;
}): NeuralRecord {
  const neuralState = input.neuralState;
  if (!neuralState) {
    return {
      recordedAt: Date.now(),
      dominantRoute: "respond",
      turnSummary: "No neural state was captured for this turn.",
      broadcastSummary: "",
      routeInspector: {
        dominantRoute: "respond",
        dominantWeight: 0,
        margin: 0,
        because: [],
        supportingNeurons: [],
        alternatives: [],
      },
      modulators: {
        focus: 0,
        novelty: 0,
        sociality: 0,
        caution: 0,
        confidence: 0,
      },
      workspaceContents: [],
      topNeurons: [],
      memoryDirective: {
        writeGlobalMemory: false,
        consolidatePreference: false,
        preferenceStrength: 0,
        reason: "",
        durableMemoryCandidate: null,
      },
      provider: input.generation,
    };
  }

  return {
    recordedAt: Date.now(),
    dominantRoute: neuralState.dominantRoute,
    turnSummary: neuralState.summary,
    broadcastSummary: neuralState.broadcastSummary,
    routeInspector: neuralState.routeInspector,
    modulators: neuralState.modulators,
    workspaceContents: neuralState.workspaceContents.slice(0, 6),
    topNeurons: neuralState.topNeurons.slice(0, 6),
    memoryDirective: {
      ...neuralState.memoryDirective,
      durableMemoryCandidate: input.durableMemoryCandidate || null,
    },
    provider: input.generation,
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

function trimValue(value: unknown) {
  return String(value || "").trim();
}

function ensureDeploymentChannel(value: unknown): DeploymentChannel {
  const normalized = trimValue(value);
  if (normalized === "telegram" || normalized === "slack" || normalized === "webhook") {
    return normalized;
  }
  return "webhook";
}

function ensureDeploymentPlatformKey(
  value: unknown,
  fallback: DeploymentChannel,
): DeploymentPlatformKey {
  const normalized = trimValue(value);
  if (
    normalized === "telegram"
    || normalized === "slack"
    || normalized === "discord"
    || normalized === "feishu"
    || normalized === "teams"
    || normalized === "webhook"
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeDeploymentInput(
  input: any,
  existing?: DeploymentRecord | null,
): DeploymentRecord {
  const channel = ensureDeploymentChannel(input?.channel || existing?.channel);
  const platformKey = ensureDeploymentPlatformKey(
    input?.platformKey || existing?.platformKey,
    channel,
  );

  return {
    id: existing?.id || randomId("dep"),
    characterId: trimValue(input?.characterId || existing?.characterId),
    secret: existing?.secret || randomId("depsec"),
    channel,
    platformKey,
    enabled: input?.enabled !== false,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    sessionByConversation: existing?.sessionByConversation || {},
    telegram: {
      botToken: trimValue(input?.telegram?.botToken || existing?.telegram?.botToken),
      chatId: trimValue(input?.telegram?.chatId || existing?.telegram?.chatId),
      secretToken: trimValue(
        input?.telegram?.secretToken || existing?.telegram?.secretToken,
      ),
    },
    slack: {
      botToken: trimValue(input?.slack?.botToken || existing?.slack?.botToken),
      channelId: trimValue(input?.slack?.channelId || existing?.slack?.channelId),
      signingSecret: trimValue(
        input?.slack?.signingSecret || existing?.slack?.signingSecret,
      ),
    },
    webhook: {
      outboundUrl: trimValue(
        input?.webhook?.outboundUrl || existing?.webhook?.outboundUrl,
      ),
      outboundAuthHeader: trimValue(
        input?.webhook?.outboundAuthHeader || existing?.webhook?.outboundAuthHeader,
      ),
    },
  };
}

function toIso(value: number) {
  try {
    return new Date(value).toISOString();
  } catch {
    return String(value || "");
  }
}

function buildConversationExportMarkdown(input: {
  character: CharacterRecord | null;
  conversation: ConversationRecord;
}) {
  const { character, conversation } = input;
  const lines: string[] = [];
  lines.push(`# ${character?.definition.name || conversation.title}`);
  lines.push("");
  lines.push(`- conversationId: ${conversation.id}`);
  lines.push(`- characterId: ${conversation.characterId}`);
  lines.push(`- exportedAt: ${new Date().toISOString()}`);
  lines.push(`- updatedAt: ${toIso(conversation.updatedAt)}`);
  lines.push("");

  for (const message of conversation.messages) {
    lines.push(`## ${message.role.toUpperCase()} · ${toIso(message.createdAt)}`);
    lines.push("");
    lines.push(message.content);
    lines.push("");

    if (message.role === "assistant" && message.generation) {
      lines.push("### Generation");
      lines.push("");
      lines.push(`- mode: ${message.generation.mode}`);
      lines.push(`- provider: ${message.generation.providerMode}`);
      lines.push(`- model: ${message.generation.model}`);
      lines.push("");
    }

    if (message.role === "assistant" && message.neuralRecord) {
      lines.push("### Neural Record");
      lines.push("");
      lines.push(`- dominantRoute: ${message.neuralRecord.dominantRoute}`);
      lines.push(`- broadcastSummary: ${message.neuralRecord.broadcastSummary || "-"}`);
      lines.push(
        `- memoryWriteback: ${message.neuralRecord.memoryDirective.writeGlobalMemory ? "yes" : "no"}`,
      );
      lines.push(
        `- durableMemoryCandidate: ${message.neuralRecord.memoryDirective.durableMemoryCandidate || "-"}`,
      );
      if (message.neuralRecord.routeInspector.because.length) {
        lines.push("");
        lines.push("#### Why this route");
        lines.push("");
        for (const reason of message.neuralRecord.routeInspector.because) {
          lines.push(`- ${reason}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateDeploymentRecord(deployment: DeploymentRecord) {
  if (!deployment.characterId) {
    throw new Error("characterId is required");
  }

  if (!deployment.enabled) {
    return;
  }

  if (deployment.channel === "webhook") {
    if (!deployment.webhook?.outboundUrl) {
      throw new Error("webhook outboundUrl is required");
    }
    if (!isHttpUrl(deployment.webhook.outboundUrl)) {
      throw new Error("webhook outboundUrl must be a valid http or https URL");
    }
    return;
  }

  if (deployment.channel === "slack") {
    if (!deployment.slack?.botToken) {
      throw new Error("slack botToken is required");
    }
    if (!deployment.slack?.channelId) {
      throw new Error("slack channelId is required");
    }
    return;
  }

  if (!deployment.telegram?.botToken) {
    throw new Error("telegram botToken is required");
  }
  if (!deployment.telegram?.chatId) {
    throw new Error("telegram chatId is required");
  }
}

function parseJsonMaybe(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function trimResponseText(value: string) {
  return String(value || "").slice(0, 1200);
}

function describeDeploymentTarget(deployment: DeploymentRecord) {
  if (deployment.channel === "webhook") {
    return deployment.webhook?.outboundUrl || "(missing webhook url)";
  }
  if (deployment.channel === "slack") {
    return deployment.slack?.channelId || "(missing slack channel)";
  }
  return deployment.telegram?.chatId || "(missing telegram chat)";
}

function buildOutboundDeliveryText(input: {
  character: CharacterRecord;
  conversation: ConversationRecord | null;
  latestAssistantMessage: ConversationRecord["messages"][number] | null;
}) {
  const { character, conversation, latestAssistantMessage } = input;
  const record = latestAssistantMessage?.role === "assistant"
    ? latestAssistantMessage.neuralRecord
    : null;
  const lines = [
    "Liberth Neural outbound test",
    `Character: ${character.definition.name}`,
    `Character ID: ${character.id}`,
    `Conversation: ${conversation?.title || "No conversation yet"}`,
    `Conversation ID: ${conversation?.id || "-"}`,
    `Route: ${record?.dominantRoute || "-"}`,
    `Summary: ${record?.broadcastSummary || record?.turnSummary || "-"}`,
    `Top neurons: ${record?.topNeurons.map((item) => item.neuronId).join(", ") || "-"}`,
    "",
    "Reply:",
    latestAssistantMessage?.content || "No assistant turn has been recorded yet.",
  ];
  return lines.join("\n");
}

function buildOutboundDeliveryPayload(input: {
  deployment: DeploymentRecord;
  character: CharacterRecord;
  conversation: ConversationRecord | null;
  latestAssistantMessage: ConversationRecord["messages"][number] | null;
}) {
  const { deployment, character, conversation, latestAssistantMessage } = input;
  return {
    event: "liberth-neural.outbound-test",
    exportedAt: new Date().toISOString(),
    deployment: {
      id: deployment.id,
      channel: deployment.channel,
      platformKey: deployment.platformKey,
      target: describeDeploymentTarget(deployment),
    },
    character: {
      id: character.id,
      slug: character.slug,
      name: character.definition.name,
      oneLiner: character.definition.oneLiner,
    },
    conversation: conversation
      ? {
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          messageCount: conversation.messages.length,
        }
      : null,
    latestAssistantMessage,
    lastNeuralState: character.lastNeuralState || null,
    globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
  };
}

async function sendWebhookDelivery(input: {
  deployment: DeploymentRecord;
  payload: ReturnType<typeof buildOutboundDeliveryPayload>;
}) {
  const { deployment, payload } = input;
  const response = await fetch(String(deployment.webhook?.outboundUrl || ""), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Liberth-Deployment-Secret": deployment.secret,
      ...(deployment.webhook?.outboundAuthHeader
        ? {
            Authorization: deployment.webhook.outboundAuthHeader,
          }
        : {}),
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    responseText: trimResponseText(responseText),
  };
}

async function sendSlackDelivery(input: {
  deployment: DeploymentRecord;
  text: string;
}) {
  const { deployment, text } = input;
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${deployment.slack?.botToken || ""}`,
    },
    body: JSON.stringify({
      channel: deployment.slack?.channelId || "",
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const responseText = await response.text();
  const body = parseJsonMaybe(responseText);
  return {
    ok: Boolean(response.ok && body?.ok !== false),
    status: response.status,
    statusText: String(body?.error || response.statusText || ""),
    responseText: trimResponseText(responseText),
  };
}

async function sendTelegramDelivery(input: {
  deployment: DeploymentRecord;
  text: string;
}) {
  const { deployment, text } = input;
  const response = await fetch(
    `https://api.telegram.org/bot${deployment.telegram?.botToken || ""}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(deployment.telegram?.secretToken
          ? {
              "X-Telegram-Bot-Api-Secret-Token": deployment.telegram.secretToken,
            }
          : {}),
      },
      body: JSON.stringify({
        chat_id: deployment.telegram?.chatId || "",
        text,
        disable_web_page_preview: true,
      }),
    },
  );
  const responseText = await response.text();
  const body = parseJsonMaybe(responseText);
  return {
    ok: Boolean(response.ok && body?.ok !== false),
    status: response.status,
    statusText: String(body?.description || response.statusText || ""),
    responseText: trimResponseText(responseText),
  };
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

app.get("/api/providers", async (_req, res) => {
  const provider = await resolveProviderSettings();
  res.json({
    providers: providerCatalog,
    activeProvider: provider,
  });
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

app.get("/api/deployments", async (req, res) => {
  const characterId = String(req.query.characterId || "").trim();
  const store = await readStore();
  const deployments = characterId
    ? store.deployments.filter((item) => item.characterId === characterId)
    : store.deployments;
  res.json({ deployments });
});

app.get("/api/characters/:characterId/neural-state", async (req, res) => {
  const characterId = String(req.params.characterId || "").trim();
  const character = await getCharacterById(characterId);
  if (!character) {
    return res.status(404).json({ message: "Character not found" });
  }

  res.json({
    characterId: character.id,
    characterName: character.definition.name,
    lastNeuralState: character.lastNeuralState || null,
    globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
    blueprint: {
      summary: character.blueprint.summary,
      generation: character.blueprint.generation || null,
      neuralGraphManifest: character.blueprint.neuralGraph?.manifest || null,
    },
  });
});

app.get("/api/conversations/:conversationId/neural-records", async (req, res) => {
  const conversationId = String(req.params.conversationId || "").trim();
  const store = await readStore();
  const conversation = store.conversations.find((item) => item.id === conversationId) || null;
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found" });
  }

  const records = conversation.messages
    .filter((message) => message.role === "assistant" && message.neuralRecord)
    .map((message) => ({
      messageId: message.id,
      createdAt: message.createdAt,
      reply: message.content,
      neuralRecord: message.neuralRecord || null,
    }));

  res.json({
    conversationId: conversation.id,
    characterId: conversation.characterId,
    title: conversation.title,
    records,
  });
});

app.post("/api/deployments", async (req, res) => {
  try {
    const id = trimValue(req.body?.deployment?.id);
    const store = await readStore();
    const existing = id
      ? store.deployments.find((item) => item.id === id) || null
      : null;
    const deployment = normalizeDeploymentInput(req.body?.deployment, existing);

    validateDeploymentRecord(deployment);

    await updateStore((draft) => {
      upsertDeployment(draft, deployment);
    });

    res.json({ deployment });
  } catch (error: any) {
    res.status(400).json({ message: String(error?.message || error) });
  }
});

app.post("/api/deployments/:deploymentId/send-test", async (req, res) => {
  try {
    const deploymentId = String(req.params.deploymentId || "").trim();
    const conversationId = trimValue(req.body?.conversationId);
    if (!deploymentId) {
      throw new Error("deploymentId is required");
    }

    const store = await readStore();
    const deployment = store.deployments.find((item) => item.id === deploymentId) || null;
    if (!deployment) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    validateDeploymentRecord(deployment);

    const character = await getCharacterById(deployment.characterId);
    if (!character) {
      return res.status(404).json({ message: "Character not found" });
    }

    const conversation = conversationId
      ? store.conversations.find((item) => item.id === conversationId) || null
      : store.conversations.find((item) => item.characterId === deployment.characterId) || null;

    const latestAssistantMessage = conversation
      ? [...conversation.messages].reverse().find((item) => item.role === "assistant") || null
      : null;

    const payload = buildOutboundDeliveryPayload({
      deployment,
      character,
      conversation,
      latestAssistantMessage,
    });
    const text = buildOutboundDeliveryText({
      character,
      conversation,
      latestAssistantMessage,
    });

    const result = deployment.channel === "webhook"
      ? await sendWebhookDelivery({ deployment, payload })
      : deployment.channel === "slack"
      ? await sendSlackDelivery({ deployment, text })
      : await sendTelegramDelivery({ deployment, text });

    res.json({
      channel: deployment.channel,
      target: describeDeploymentTarget(deployment),
      ...result,
    });
  } catch (error: any) {
    res.status(400).json({ message: String(error?.message || error) });
  }
});

app.get("/api/conversations/:conversationId/export", async (req, res) => {
  const conversationId = String(req.params.conversationId || "").trim();
  const format = String(req.query.format || "json").trim().toLowerCase();
  const store = await readStore();
  const conversation = store.conversations.find((item) => item.id === conversationId) || null;
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found" });
  }

  const character = store.characters.find((item) => item.id === conversation.characterId) || null;

  if (format === "markdown" || format === "md") {
    res.type("text/markdown").send(
      buildConversationExportMarkdown({
        character,
        conversation,
      }),
    );
    return;
  }

  res.json({
    exportedAt: new Date().toISOString(),
    character,
    conversation,
  });
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
    const durableMemory = deriveDurableMemoryCandidate(message, neuralState);
    const assistantEntry = {
      id: randomId("msg"),
      role: "assistant" as const,
      content: replyResult.reply,
      createdAt: Date.now(),
      generation: replyResult.generation,
      neuralRecord: buildAssistantNeuralRecord({
        generation: replyResult.generation,
        neuralState,
        durableMemoryCandidate: durableMemory,
      }),
    };

    const nextConversation: ConversationRecord = {
      ...conversation,
      title: conversation.messages.length <= 1
        ? message.slice(0, 48) || conversation.title
        : conversation.title,
      updatedAt: Date.now(),
      messages: [...conversation.messages, userEntry, assistantEntry],
    };

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
