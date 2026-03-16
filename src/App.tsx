import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type AutomationRecord,
  type AutomationRunRecord,
  type CharacterRecord,
  type ChatAttachment,
  type ChatMessage,
  type ConversationRecord,
  type DeploymentChannel,
  type DeploymentRecord,
  emptyProviderSettings,
  emptyRoleDefinition,
  getProviderCatalogItem,
  type NeuralMemoryRecord,
  type NeuralRecord,
  providerCatalog,
  type ProviderMode,
  type ProviderSettings,
  type RoleBlueprint,
  type RoleDefinitionInput,
  type SkillCatalogItem,
  type ToolEventRecord,
} from "./types";

type AppSection = "characters" | "chat" | "settings";
type StudioMode = "create" | "edit";

type ChatPayload = {
  character: CharacterRecord;
  conversation: ConversationRecord;
};

type CharacterComposePayload = {
  definition: RoleDefinitionInput;
  blueprint: RoleBlueprint;
};

type ProviderSettingsPayload = {
  provider: ProviderSettings;
  configured: boolean;
  setupComplete?: boolean;
  requiresSetup: boolean;
};

type TelegramDraft = {
  id: string;
  botToken: string;
  chatId: string;
  secretToken: string;
  enabled: boolean;
};

type SlackDraft = {
  id: string;
  botToken: string;
  channelId: string;
  signingSecret: string;
  enabled: boolean;
};

type WebhookDraft = {
  id: string;
  outboundUrl: string;
  outboundAuthHeader: string;
  enabled: boolean;
};

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const CLIENT_CHAT_IMAGE_MAX_COUNT = 4;
const CLIENT_CHAT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      String(payload?.message || payload?.error || `Request failed: ${response.status}`),
    );
  }
  return response.json() as Promise<T>;
}

function createClientAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `img_${crypto.randomUUID()}`;
  }
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function attachmentSummary(attachments?: ChatAttachment[]) {
  const count = Array.isArray(attachments) ? attachments.length : 0;
  if (!count) return "";
  return count === 1 ? "Image message" : `${count} images`;
}

function starterConversation(character?: CharacterRecord | null): ChatMessage[] {
  if (!character) return [];
  return [
    {
      id: "bootstrap",
      role: "assistant",
      content: character.blueprint.greeting,
      createdAt: Date.now(),
      generation: character.blueprint.generation || null,
      neuralRecord: null,
    },
  ];
}

function formatPercent(value: number) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatTime(value: number) {
  try {
    return timeFormatter.format(new Date(value));
  } catch {
    return "--";
  }
}

function formatIntervalMinutes(value: number) {
  const minutes = Math.max(1, Number(value) || 0);
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `Every ${days} day${days > 1 ? "s" : ""}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `Every ${hours} hour${hours > 1 ? "s" : ""}`;
  }
  return `Every ${minutes} min`;
}

function routePillClass(route: string) {
  return `route-pill route-${String(route || "respond").toLowerCase()}`;
}

function providerMonogram(mode: ProviderMode) {
  if (mode === "glm-main") return "GL";
  if (mode === "openai-compatible") return "OA";
  if (mode === "openrouter") return "OR";
  if (mode === "deepseek") return "DS";
  if (mode === "siliconflow") return "SF";
  if (mode === "groq") return "GQ";
  if (mode === "ollama") return "OL";
  if (mode === "anthropic") return "AN";
  return "GM";
}

function providerFamilyLabel(mode: ProviderMode) {
  const item = getProviderCatalogItem(mode);
  if (item.apiStyle === "glm-main") return "Built-in";
  if (item.apiStyle === "anthropic") return "Native API";
  if (item.apiStyle === "google-gemini") return "Native API";
  return "OpenAI-style";
}

function providerDisplayLabel(mode: ProviderMode) {
  return getProviderCatalogItem(mode).label;
}

function providerConnectionLabel(mode: ProviderMode) {
  return mode === "ollama" ? "Local" : "API key";
}

function providerNeedsApiKey(mode: ProviderMode) {
  return mode !== "ollama";
}

function providerRuntimeModel(settings: ProviderSettings) {
  if (settings.providerMode === "glm-main") {
    return settings.glmModel || getProviderCatalogItem("glm-main").defaultModel;
  }
  return settings.model || getProviderCatalogItem(settings.providerMode).defaultModel;
}

function formatGenerationReason(reason?: string) {
  const raw = String(reason || "").trim();
  if (!raw) return "";
  const normalized = raw.toLowerCase();

  if (normalized.includes("no_llm_access")) {
    return "No live model access is configured for the current runtime.";
  }

  if (normalized.includes("fetch failed")) {
    return `The live model request failed before a reply was returned. ${raw}`;
  }

  if (normalized.includes("api key")) {
    return `The selected runtime is missing a usable API key. ${raw}`;
  }

  if (normalized.includes("json_not_found")) {
    return "The model replied, but the expected JSON payload was missing.";
  }

  return raw;
}

const providerSections: Array<{
  title: string;
  subtitle: string;
  modes: ProviderMode[];
}> = [
  {
    title: "Built-in",
    subtitle: "Native Liberth runtime path",
    modes: ["glm-main"],
  },
  {
    title: "OpenAI-compatible",
    subtitle: "Shared chat-completions surface",
    modes: [
      "openai-compatible",
      "openrouter",
      "deepseek",
      "siliconflow",
      "groq",
      "ollama",
    ],
  },
  {
    title: "Native APIs",
    subtitle: "Provider-specific request format",
    modes: ["anthropic", "google-gemini"],
  },
];

function emptyWebhookDraft(): WebhookDraft {
  return {
    id: "",
    outboundUrl: "",
    outboundAuthHeader: "",
    enabled: true,
  };
}

function emptySlackDraft(): SlackDraft {
  return {
    id: "",
    botToken: "",
    channelId: "",
    signingSecret: "",
    enabled: true,
  };
}

function emptyTelegramDraft(): TelegramDraft {
  return {
    id: "",
    botToken: "",
    chatId: "",
    secretToken: "",
    enabled: true,
  };
}

function formatChannelName(channel: DeploymentChannel) {
  if (channel === "webhook") return "Webhook";
  if (channel === "slack") return "Slack";
  return "Telegram";
}

function describeChannel(channel: DeploymentChannel) {
  if (channel === "webhook") {
    return "Post the neural payload to an external URL.";
  }
  if (channel === "slack") {
    return "Send a route summary into a Slack channel.";
  }
  return "Send a route summary into a Telegram chat.";
}

function describeDeploymentTarget(deployment: DeploymentRecord) {
  if (deployment.channel === "webhook") {
    return deployment.webhook?.outboundUrl || "No webhook URL";
  }
  if (deployment.channel === "slack") {
    return deployment.slack?.channelId || "No Slack channel";
  }
  return deployment.telegram?.chatId || "No Telegram chat";
}

function conversationSnippet(conversation: ConversationRecord) {
  const latestUser = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "user");
  return latestUser?.content || attachmentSummary(latestUser?.attachments) || conversation.messages[0]?.content || "New chat";
}

function sortConversations(conversations: ConversationRecord[]) {
  return conversations.slice().sort((left, right) => right.updatedAt - left.updatedAt);
}

function downloadText(fileName: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [appSection, setAppSection] = useState<AppSection>("characters");
  const [studioMode, setStudioMode] = useState<StudioMode>("create");
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [characterBrief, setCharacterBrief] = useState("");
  const [definition, setDefinition] = useState<RoleDefinitionInput>(emptyRoleDefinition);
  const [blueprintPreview, setBlueprintPreview] = useState<RoleBlueprint | null>(null);
  const [showAdvancedBuilder, setShowAdvancedBuilder] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState("");
  const [studioSaved, setStudioSaved] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [providerSettings, setProviderSettings] =
    useState<ProviderSettings>(emptyProviderSettings);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [providerSetupRequired, setProviderSetupRequired] = useState(true);
  const [savedProviderMode, setSavedProviderMode] = useState<ProviderMode>("glm-main");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaved, setSettingsSaved] = useState("");
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [activeOutboundChannel, setActiveOutboundChannel] = useState<DeploymentChannel>("webhook");
  const [slackDraft, setSlackDraft] = useState<SlackDraft>(emptySlackDraft);
  const [telegramDraft, setTelegramDraft] = useState<TelegramDraft>(emptyTelegramDraft);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(emptyWebhookDraft);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState("");
  const [integrationSaved, setIntegrationSaved] = useState("");
  const [exportBusy, setExportBusy] = useState<"" | "json" | "markdown">("");
  const [chatInspector, setChatInspector] =
    useState<"none" | "skills" | "automations" | "role" | "memory">("none");
  const [attachedSkills, setAttachedSkills] = useState<SkillCatalogItem[]>([]);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillSearchResults, setSkillSearchResults] = useState<SkillCatalogItem[]>([]);
  const [skillsBusy, setSkillsBusy] = useState("");
  const [skillsError, setSkillsError] = useState("");
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRunRecord[]>([]);
  const [automationNameDraft, setAutomationNameDraft] = useState("");
  const [automationPromptDraft, setAutomationPromptDraft] = useState("");
  const [automationIntervalDraft, setAutomationIntervalDraft] = useState("60");
  const [automationEnabledDraft, setAutomationEnabledDraft] = useState(true);
  const [automationBusy, setAutomationBusy] = useState("");
  const [automationError, setAutomationError] = useState("");
  const messageStageRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCharacter = useMemo(
    () => characters.find((item) => item.id === selectedCharacterId) || null,
    [characters, selectedCharacterId],
  );
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );
  const displayedMessages = useMemo(
    () => selectedConversation?.messages || starterConversation(selectedCharacter),
    [selectedConversation, selectedCharacter],
  );
  const activeProviderPreset = getProviderCatalogItem(providerSettings.providerMode);
  const activeOutboundDeployment = useMemo(
    () => deployments.find((item) => item.channel === activeOutboundChannel) || null,
    [activeOutboundChannel, deployments],
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    setChatInspector("none");
    setSkillsError("");
    setAutomationError("");
    setSkillSearchQuery("");
    setSkillSearchResults([]);
    setAutomationNameDraft("");
    setAutomationPromptDraft("");
    setAutomationIntervalDraft("60");
    setAutomationEnabledDraft(true);
    if (!selectedCharacterId) {
      setConversations([]);
      setSelectedConversationId("");
      setDeployments([]);
      setAttachedSkills([]);
      setAutomations([]);
      setAutomationRuns([]);
      setSlackDraft(emptySlackDraft());
      setTelegramDraft(emptyTelegramDraft());
      setWebhookDraft(emptyWebhookDraft());
      return;
    }
    void loadConversations(selectedCharacterId);
    void loadDeployments(selectedCharacterId);
    void loadSkills(selectedCharacterId);
    void loadAutomations(selectedCharacterId);
  }, [selectedCharacterId]);

  useEffect(() => {
    const stage = messageStageRef.current;
    if (!stage || !selectedCharacter) return;

    const frame = window.requestAnimationFrame(() => {
      stage.scrollTo({
        top: stage.scrollHeight,
        behavior: selectedConversationId ? "smooth" : "auto",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [displayedMessages.length, selectedCharacter, selectedConversationId]);

  async function bootstrap() {
    try {
      await Promise.all([loadCharacters(), loadProviderSettings()]);
    } catch (error: any) {
      setSettingsError(String(error?.message || error));
      setProviderSetupRequired(true);
      setAppSection("settings");
    } finally {
      setBootstrapped(true);
    }
  }

  async function loadCharacters(preferredCharacterId?: string) {
    const payload = await requestJson<{ characters: CharacterRecord[] }>("/api/characters");
    setCharacters(payload.characters);
    if (!payload.characters.length) {
      setSelectedCharacterId("");
      setAppSection("characters");
      return;
    }

    const candidateId = preferredCharacterId || selectedCharacterId;
    const nextCharacter =
      payload.characters.find((item) => item.id === candidateId) || payload.characters[0];
    setSelectedCharacterId(nextCharacter.id);
  }

  async function loadProviderSettings() {
    const payload = await requestJson<ProviderSettingsPayload>("/api/settings/provider");
    setProviderSettings(payload.provider);
    setProviderConfigured(payload.configured);
    setProviderSetupRequired(payload.requiresSetup);
    setSavedProviderMode(payload.provider.providerMode);
  }

  async function loadConversations(characterId: string) {
    const payload = await requestJson<{ conversations: ConversationRecord[] }>(
      `/api/conversations?characterId=${encodeURIComponent(characterId)}`,
    );
    const nextConversations = sortConversations(payload.conversations);
    setConversations(nextConversations);
    setSelectedConversationId((current) => {
      if (nextConversations.some((item) => item.id === current)) {
        return current;
      }
      return nextConversations[0]?.id || "";
    });
  }

  async function loadDeployments(characterId: string) {
    const payload = await requestJson<{ deployments: DeploymentRecord[] }>(
      `/api/deployments?characterId=${encodeURIComponent(characterId)}`,
    );
    setDeployments(payload.deployments);

    const slack = payload.deployments.find((item) => item.channel === "slack");
    const telegram = payload.deployments.find((item) => item.channel === "telegram");
    const webhook = payload.deployments.find((item) => item.channel === "webhook");

    setSlackDraft(
      slack
        ? {
            id: slack.id,
            botToken: slack.slack?.botToken || "",
            channelId: slack.slack?.channelId || "",
            signingSecret: slack.slack?.signingSecret || "",
            enabled: slack.enabled,
          }
        : emptySlackDraft(),
    );
    setTelegramDraft(
      telegram
        ? {
            id: telegram.id,
            botToken: telegram.telegram?.botToken || "",
            chatId: telegram.telegram?.chatId || "",
            secretToken: telegram.telegram?.secretToken || "",
            enabled: telegram.enabled,
          }
        : emptyTelegramDraft(),
    );
    setWebhookDraft(
      webhook
        ? {
            id: webhook.id,
            outboundUrl: webhook.webhook?.outboundUrl || "",
            outboundAuthHeader: webhook.webhook?.outboundAuthHeader || "",
            enabled: webhook.enabled,
          }
        : emptyWebhookDraft(),
    );
  }

  async function loadSkills(characterId: string) {
    const payload = await requestJson<{ skills: SkillCatalogItem[] }>(
      `/api/characters/${encodeURIComponent(characterId)}/skills`,
    );
    setAttachedSkills(payload.skills);
  }

  async function loadAutomations(characterId: string) {
    const payload = await requestJson<{
      automations: AutomationRecord[];
      runs: AutomationRunRecord[];
    }>(`/api/characters/${encodeURIComponent(characterId)}/automations`);
    setAutomations(payload.automations);
    setAutomationRuns(payload.runs);
  }

  function patchCharacter(nextCharacter: CharacterRecord) {
    setCharacters((current) => {
      const index = current.findIndex((item) => item.id === nextCharacter.id);
      if (index === -1) {
        return [nextCharacter, ...current];
      }
      const copy = [...current];
      copy[index] = nextCharacter;
      return copy;
    });
  }

  function upsertConversationState(nextConversation: ConversationRecord) {
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === nextConversation.id);
      if (index === -1) {
        return sortConversations([nextConversation, ...current]);
      }
      const copy = [...current];
      copy[index] = nextConversation;
      return sortConversations(copy);
    });
    setSelectedConversationId(nextConversation.id);
  }

  function prepareCreateCharacter() {
    setStudioMode("create");
    setCharacterBrief("");
    setDefinition(emptyRoleDefinition());
    setBlueprintPreview(null);
    setShowAdvancedBuilder(false);
    setStudioError("");
    setStudioSaved("");
    setAppSection("characters");
  }

  function prepareEditCharacter(character: CharacterRecord) {
    setStudioMode("edit");
    setSelectedCharacterId(character.id);
    setCharacterBrief(character.definition.oneLiner);
    setDefinition(character.definition);
    setBlueprintPreview(character.blueprint);
    setShowAdvancedBuilder(true);
    setStudioError("");
    setStudioSaved("");
    setAppSection("characters");
  }

  function openChatForCharacter(character: CharacterRecord) {
    if (providerSetupRequired) {
      setAppSection("settings");
      setSettingsError("Choose a provider and save a live model before opening chat.");
      return;
    }
    setSelectedCharacterId(character.id);
    setAppSection("chat");
    setChatError("");
  }

  function updateDefinitionField<Key extends keyof RoleDefinitionInput>(
    key: Key,
    value: RoleDefinitionInput[Key],
  ) {
    setDefinition((current) => ({ ...current, [key]: value }));
    setStudioSaved("");
  }

  async function handleComposeCharacter(event: FormEvent) {
    event.preventDefault();
    if (!characterBrief.trim()) {
      setStudioError("Describe the role in one sentence, with voice or behavior, not just a name.");
      return;
    }

    setStudioBusy(true);
    setStudioError("");
    setStudioSaved("");
    try {
      const payload = await requestJson<CharacterComposePayload>("/api/characters/compose", {
        method: "POST",
        body: JSON.stringify({
          brief: characterBrief,
          language: definition.language,
        }),
      });
      setDefinition(payload.definition);
      setBlueprintPreview(payload.blueprint);
      setShowAdvancedBuilder(false);
      setStudioSaved("Definition expanded and bundle preview generated.");
    } catch (error: any) {
      setStudioError(String(error?.message || error));
    } finally {
      setStudioBusy(false);
    }
  }

  async function handleRefreshBlueprint() {
    setStudioBusy(true);
    setStudioError("");
    setStudioSaved("");
    try {
      const payload = await requestJson<{ blueprint: RoleBlueprint }>(
        "/api/characters/generate",
        {
          method: "POST",
          body: JSON.stringify({ definition }),
        },
      );
      setBlueprintPreview(payload.blueprint);
      setStudioSaved("Bundle preview refreshed from the current definition.");
    } catch (error: any) {
      setStudioError(String(error?.message || error));
    } finally {
      setStudioBusy(false);
    }
  }

  async function handleSaveCharacter() {
    setStudioBusy(true);
    setStudioError("");
    setStudioSaved("");
    try {
      const payload = await requestJson<{ character: CharacterRecord }>(
        "/api/characters",
        {
          method: studioMode === "edit" && selectedCharacter ? "PUT" : "POST",
          body: JSON.stringify({
            id: studioMode === "edit" ? selectedCharacter?.id : undefined,
            definition,
          }),
        },
      );

      patchCharacter(payload.character);
      setSelectedCharacterId(payload.character.id);
      setDefinition(payload.character.definition);
      setBlueprintPreview(payload.character.blueprint);
      setStudioMode("edit");
      setStudioSaved("Character saved.");

      if (studioMode === "create") {
        const conversationPayload = await requestJson<{ conversation: ConversationRecord }>(
          "/api/conversations",
          {
            method: "POST",
            body: JSON.stringify({ characterId: payload.character.id }),
          },
        );
        setConversations([conversationPayload.conversation]);
        setSelectedConversationId(conversationPayload.conversation.id);
      } else {
        await loadConversations(payload.character.id);
      }

      setAppSection("chat");
    } catch (error: any) {
      setStudioError(String(error?.message || error));
    } finally {
      setStudioBusy(false);
    }
  }

  async function handleCreateConversation() {
    if (!selectedCharacter) return;
    setChatBusy(true);
    setChatError("");
    try {
      const payload = await requestJson<{ conversation: ConversationRecord }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ characterId: selectedCharacter.id }),
      });
      upsertConversationState(payload.conversation);
    } catch (error: any) {
      setChatError(String(error?.message || error));
    } finally {
      setChatBusy(false);
    }
  }

  async function handleChatImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files || []);
    if (!fileList.length) return;

    const remainingSlots = Math.max(0, CLIENT_CHAT_IMAGE_MAX_COUNT - chatAttachments.length);
    if (!remainingSlots) {
      setChatError(`You can attach up to ${CLIENT_CHAT_IMAGE_MAX_COUNT} images per message.`);
      event.target.value = "";
      return;
    }

    const selectedFiles = fileList.slice(0, remainingSlots);
    const invalidFile = selectedFiles.find(
      (file) => !String(file.type || "").toLowerCase().startsWith("image/"),
    );
    if (invalidFile) {
      setChatError(`${invalidFile.name} is not an image file.`);
      event.target.value = "";
      return;
    }

    const oversizedFile = selectedFiles.find((file) => file.size > CLIENT_CHAT_IMAGE_MAX_BYTES);
    if (oversizedFile) {
      setChatError(`${oversizedFile.name} exceeds the 4MB image limit.`);
      event.target.value = "";
      return;
    }

    setChatError("");
    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map(async (file) => ({
          id: createClientAttachmentId(),
          kind: "image" as const,
          mimeType: file.type,
          dataUrl: await readFileAsDataUrl(file),
          name: file.name,
          sizeBytes: file.size,
        })),
      );
      setChatAttachments((current) => [...current, ...nextAttachments]);
    } catch (error: any) {
      setChatError(String(error?.message || error));
    } finally {
      event.target.value = "";
    }
  }

  function handleRemoveChatAttachment(attachmentId: string) {
    setChatAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }

  function handleOpenChatImagePicker() {
    imageInputRef.current?.click();
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedCharacter || (!chatText.trim() && !chatAttachments.length)) return;

    setChatBusy(true);
    setChatError("");
    const userContent = chatText.trim();
    const userAttachments = chatAttachments.slice();
    setChatText("");
    setChatAttachments([]);

    try {
      const payload = await requestJson<ChatPayload>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          characterId: selectedCharacter.id,
          conversationId: selectedConversationId || undefined,
          message: userContent,
          attachments: userAttachments,
        }),
      });
      patchCharacter(payload.character);
      upsertConversationState(payload.conversation);
      await loadSkills(payload.character.id);
      await loadAutomations(payload.character.id);
      if (studioMode === "edit" && payload.character.id === selectedCharacter.id) {
        setBlueprintPreview(payload.character.blueprint);
      }
    } catch (error: any) {
      setChatText(userContent);
      setChatAttachments(userAttachments);
      setChatError(String(error?.message || error));
    } finally {
      setChatBusy(false);
    }
  }

  async function handleSearchSkills(event?: FormEvent) {
    event?.preventDefault();
    const query = skillSearchQuery.trim();
    if (!query) {
      setSkillSearchResults([]);
      return;
    }

    setSkillsBusy("search");
    setSkillsError("");
    try {
      const payload = await requestJson<{ skills: SkillCatalogItem[] }>(
        `/api/skills/search?query=${encodeURIComponent(query)}`,
      );
      setSkillSearchResults(payload.skills);
    } catch (error: any) {
      setSkillsError(String(error?.message || error));
    } finally {
      setSkillsBusy("");
    }
  }

  async function handleInstallSkill(skill: SkillCatalogItem) {
    if (!selectedCharacter) return;
    setSkillsBusy(`install:${skill.id}`);
    setSkillsError("");
    try {
      const payload = await requestJson<{ character: CharacterRecord; skills: SkillCatalogItem[] }>(
        `/api/characters/${encodeURIComponent(selectedCharacter.id)}/skills`,
        {
          method: "POST",
          body: JSON.stringify({
            skillId: skill.id,
            packageRef: skill.packageRef,
          }),
        },
      );
      patchCharacter(payload.character);
      setAttachedSkills(payload.skills);
    } catch (error: any) {
      setSkillsError(String(error?.message || error));
    } finally {
      setSkillsBusy("");
    }
  }

  async function handleRemoveSkill(skillId: string) {
    if (!selectedCharacter) return;
    setSkillsBusy(`remove:${skillId}`);
    setSkillsError("");
    try {
      const payload = await requestJson<{ character: CharacterRecord; skills: SkillCatalogItem[] }>(
        `/api/characters/${encodeURIComponent(selectedCharacter.id)}/skills/${encodeURIComponent(skillId)}`,
        {
          method: "DELETE",
        },
      );
      patchCharacter(payload.character);
      setAttachedSkills(payload.skills);
    } catch (error: any) {
      setSkillsError(String(error?.message || error));
    } finally {
      setSkillsBusy("");
    }
  }

  async function handleCreateAutomation(event: FormEvent) {
    event.preventDefault();
    if (!selectedCharacter) return;
    if (!automationNameDraft.trim() || !automationPromptDraft.trim()) {
      setAutomationError("Automation name and prompt are required.");
      return;
    }

    setAutomationBusy("create");
    setAutomationError("");
    try {
      const payload = await requestJson<{
        automations: AutomationRecord[];
        runs: AutomationRunRecord[];
      }>(`/api/characters/${encodeURIComponent(selectedCharacter.id)}/automations`, {
        method: "POST",
        body: JSON.stringify({
          name: automationNameDraft.trim(),
          prompt: automationPromptDraft.trim(),
          intervalMinutes: Number.parseInt(automationIntervalDraft, 10) || 60,
          enabled: automationEnabledDraft,
        }),
      });
      setAutomations(payload.automations);
      setAutomationRuns(payload.runs);
      setAutomationNameDraft("");
      setAutomationPromptDraft("");
      setAutomationIntervalDraft("60");
      setAutomationEnabledDraft(true);
    } catch (error: any) {
      setAutomationError(String(error?.message || error));
    } finally {
      setAutomationBusy("");
    }
  }

  async function handleToggleAutomation(automation: AutomationRecord) {
    if (!selectedCharacter) return;
    setAutomationBusy(`toggle:${automation.id}`);
    setAutomationError("");
    try {
      const payload = await requestJson<{
        automations: AutomationRecord[];
        runs: AutomationRunRecord[];
      }>(
        `/api/characters/${encodeURIComponent(selectedCharacter.id)}/automations/${encodeURIComponent(
          automation.id,
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: !automation.enabled,
          }),
        },
      );
      setAutomations(payload.automations);
      setAutomationRuns(payload.runs);
    } catch (error: any) {
      setAutomationError(String(error?.message || error));
    } finally {
      setAutomationBusy("");
    }
  }

  async function handleRunAutomation(automationId: string) {
    if (!selectedCharacter) return;
    setAutomationBusy(`run:${automationId}`);
    setAutomationError("");
    try {
      const payload = await requestJson<{
        automations: AutomationRecord[];
        runs: AutomationRunRecord[];
      }>(
        `/api/characters/${encodeURIComponent(selectedCharacter.id)}/automations/${encodeURIComponent(
          automationId,
        )}/run`,
        {
          method: "POST",
        },
      );
      setAutomations(payload.automations);
      setAutomationRuns(payload.runs);
    } catch (error: any) {
      setAutomationError(String(error?.message || error));
    } finally {
      setAutomationBusy("");
    }
  }

  async function handleDeleteAutomation(automationId: string) {
    if (!selectedCharacter) return;
    setAutomationBusy(`delete:${automationId}`);
    setAutomationError("");
    try {
      const payload = await requestJson<{
        automations: AutomationRecord[];
        runs: AutomationRunRecord[];
      }>(
        `/api/characters/${encodeURIComponent(selectedCharacter.id)}/automations/${encodeURIComponent(
          automationId,
        )}`,
        {
          method: "DELETE",
        },
      );
      setAutomations(payload.automations);
      setAutomationRuns(payload.runs);
    } catch (error: any) {
      setAutomationError(String(error?.message || error));
    } finally {
      setAutomationBusy("");
    }
  }

  function updateProviderField<Key extends keyof ProviderSettings>(
    key: Key,
    value: ProviderSettings[Key],
  ) {
    setProviderSettings((current) => ({ ...current, [key]: value }));
  }

  function updateProviderMode(value: ProviderMode) {
    const preset = getProviderCatalogItem(value);
    setProviderSettings((current) => ({
      ...current,
      providerMode: value,
      glmModel: value === "glm-main"
        ? current.glmModel || preset.defaultModel
        : current.glmModel || getProviderCatalogItem("glm-main").defaultModel,
      baseUrl: value === "glm-main" ? "" : preset.defaultBaseUrl || current.baseUrl,
      model: value === "glm-main" ? "" : preset.defaultModel,
    }));
  }

  async function handleSaveProviderSettings() {
    const switchingProvider = providerSettings.providerMode !== savedProviderMode;
    if (
      providerNeedsApiKey(providerSettings.providerMode)
      && !providerSettings.apiKey.trim()
      && (switchingProvider || !providerConfigured)
    ) {
      setSettingsError("Enter an API key before continuing.");
      setSettingsSaved("");
      return;
    }

    setSettingsBusy(true);
    setSettingsError("");
    setSettingsSaved("");
    try {
      const payload = await requestJson<ProviderSettingsPayload>(
        "/api/settings/provider",
        {
          method: "PUT",
          body: JSON.stringify({ provider: providerSettings }),
        },
      );
      setProviderSettings(payload.provider);
      setProviderConfigured(payload.configured);
      setProviderSetupRequired(payload.requiresSetup);
      setSavedProviderMode(payload.provider.providerMode);
      setSettingsSaved("Runtime settings saved.");
      if (!payload.requiresSetup && providerSetupRequired) {
        setAppSection("characters");
      }
    } catch (error: any) {
      setSettingsError(String(error?.message || error));
    } finally {
      setSettingsBusy(false);
    }
  }

  function updateWebhookDraft<Key extends keyof WebhookDraft>(
    key: Key,
    value: WebhookDraft[Key],
  ) {
    setWebhookDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSlackDraft<Key extends keyof SlackDraft>(
    key: Key,
    value: SlackDraft[Key],
  ) {
    setSlackDraft((current) => ({ ...current, [key]: value }));
  }

  function updateTelegramDraft<Key extends keyof TelegramDraft>(
    key: Key,
    value: TelegramDraft[Key],
  ) {
    setTelegramDraft((current) => ({ ...current, [key]: value }));
  }

  async function handleSaveDeployment(channel: DeploymentChannel) {
    if (!selectedCharacter) return;
    setIntegrationBusy(true);
    setIntegrationError("");
    setIntegrationSaved("");
    try {
      const deployment = channel === "webhook"
        ? {
            id: webhookDraft.id || undefined,
            characterId: selectedCharacter.id,
            channel: "webhook",
            platformKey: "webhook",
            enabled: webhookDraft.enabled,
            webhook: {
              outboundUrl: webhookDraft.outboundUrl,
              outboundAuthHeader: webhookDraft.outboundAuthHeader,
            },
          }
        : channel === "slack"
        ? {
            id: slackDraft.id || undefined,
            characterId: selectedCharacter.id,
            channel: "slack",
            platformKey: "slack",
            enabled: slackDraft.enabled,
            slack: {
              botToken: slackDraft.botToken,
              channelId: slackDraft.channelId,
              signingSecret: slackDraft.signingSecret,
            },
          }
        : {
            id: telegramDraft.id || undefined,
            characterId: selectedCharacter.id,
            channel: "telegram",
            platformKey: "telegram",
            enabled: telegramDraft.enabled,
            telegram: {
              botToken: telegramDraft.botToken,
              chatId: telegramDraft.chatId,
              secretToken: telegramDraft.secretToken,
            },
          };

      const payload = await requestJson<{ deployment: DeploymentRecord }>("/api/deployments", {
        method: "POST",
        body: JSON.stringify({ deployment }),
      });
      await loadDeployments(selectedCharacter.id);

      if (channel === "webhook") {
        setWebhookDraft({
          id: payload.deployment.id,
          outboundUrl: payload.deployment.webhook?.outboundUrl || "",
          outboundAuthHeader: payload.deployment.webhook?.outboundAuthHeader || "",
          enabled: payload.deployment.enabled,
        });
      } else if (channel === "slack") {
        setSlackDraft({
          id: payload.deployment.id,
          botToken: payload.deployment.slack?.botToken || "",
          channelId: payload.deployment.slack?.channelId || "",
          signingSecret: payload.deployment.slack?.signingSecret || "",
          enabled: payload.deployment.enabled,
        });
      } else {
        setTelegramDraft({
          id: payload.deployment.id,
          botToken: payload.deployment.telegram?.botToken || "",
          chatId: payload.deployment.telegram?.chatId || "",
          secretToken: payload.deployment.telegram?.secretToken || "",
          enabled: payload.deployment.enabled,
        });
      }

      setIntegrationSaved(`${formatChannelName(channel)} outlet saved.`);
    } catch (error: any) {
      setIntegrationError(String(error?.message || error));
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function handleSendDeploymentTest(channel: DeploymentChannel) {
    const deployment = activeOutboundDeployment;
    if (!deployment?.id || deployment.channel !== channel) {
      setIntegrationError(`Save a ${formatChannelName(channel).toLowerCase()} outlet first.`);
      return;
    }
    setIntegrationBusy(true);
    setIntegrationError("");
    setIntegrationSaved("");
    try {
      const payload = await requestJson<{
        ok: boolean;
        status: number;
        statusText: string;
        responseText: string;
      }>(`/api/deployments/${encodeURIComponent(deployment.id)}/send-test`, {
        method: "POST",
        body: JSON.stringify({
          conversationId: selectedConversation?.id || undefined,
        }),
      });
      setIntegrationSaved(
        `${formatChannelName(channel)} test finished with ${payload.status} ${payload.statusText}.`,
      );
    } catch (error: any) {
      setIntegrationError(String(error?.message || error));
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function handleExportConversation(format: "json" | "markdown") {
    if (!selectedConversation?.id) return;
    setExportBusy(format);
    setIntegrationError("");
    setIntegrationSaved("");
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(selectedConversation.id)}/export?format=${encodeURIComponent(format)}`,
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          String(payload?.message || payload?.error || `Export failed: ${response.status}`),
        );
      }

      const baseName = `${selectedCharacter?.slug || "liberth-neural"}-${selectedConversation.id}`;
      if (format === "json") {
        const payload = await response.json();
        downloadText(
          `${baseName}.json`,
          JSON.stringify(payload, null, 2),
          "application/json",
        );
      } else {
        const text = await response.text();
        downloadText(`${baseName}.md`, text, "text/markdown");
      }
      setIntegrationSaved(`Conversation exported as ${format}.`);
    } catch (error: any) {
      setIntegrationError(String(error?.message || error));
    } finally {
      setExportBusy("");
    }
  }

  function renderNeuralRecord(record: NeuralRecord) {
    return (
      <section className="neural-record">
        <details className="neural-details">
          <summary className="neural-trace-summary">
            <div className="neural-record-topline">
              <span className={routePillClass(record.dominantRoute)}>{record.dominantRoute}</span>
              <span className="meta-pill">{record.provider.providerMode}</span>
              <span
                className={`meta-pill ${
                  record.memoryDirective.writeGlobalMemory ? "meta-pill-hot" : ""
                }`}
              >
                {record.memoryDirective.writeGlobalMemory ? "memory writeback" : "thread only"}
              </span>
            </div>
            <span className="neural-summary-inline">
              {record.broadcastSummary || record.turnSummary}
            </span>
          </summary>

          <div className="neural-details-body">
            <div className="metric-strip">
              <span className="metric-chip">focus {formatPercent(record.modulators.focus)}</span>
              <span className="metric-chip">
                novelty {formatPercent(record.modulators.novelty)}
              </span>
              <span className="metric-chip">
                caution {formatPercent(record.modulators.caution)}
              </span>
              <span className="metric-chip">
                margin {formatPercent(record.routeInspector.margin)}
              </span>
              <span className="metric-chip">{record.provider.model}</span>
            </div>

            <div className="neural-details-grid">
              <article className="neural-block">
                <strong>Why this route</strong>
                <ul>
                  {record.routeInspector.because.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="neural-block">
                <strong>Supporting neurons</strong>
                <div className="tag-row">
                  {record.routeInspector.supportingNeurons.map((item) => (
                    <span key={item.neuronId} className="tag">
                      {item.neuronId} {formatPercent(item.activation)}
                    </span>
                  ))}
                </div>
              </article>

              <article className="neural-block">
                <strong>Workspace</strong>
                <div className="tag-row">
                  {record.workspaceContents.map((item) => (
                    <span key={item.id} className="tag">
                      {item.label} {formatPercent(item.activation)}
                    </span>
                  ))}
                </div>
              </article>

              <article className="neural-block">
                <strong>Memory decision</strong>
                <p>{record.memoryDirective.reason}</p>
                {record.memoryDirective.durableMemoryCandidate ? (
                  <pre className="mono compact-pre">
                    {record.memoryDirective.durableMemoryCandidate}
                  </pre>
                ) : (
                  <p className="small-note">
                    This turn did not produce a durable-memory candidate.
                  </p>
                )}
              </article>
            </div>
          </div>
        </details>
      </section>
    );
  }

  function renderToolEvents(events: ToolEventRecord[]) {
    if (!events.length) return null;

    return (
      <section className="tool-event-record">
        <details className="tool-event-details">
          <summary className="tool-event-summary">
            <span>Tools</span>
            <span>{events.length} step{events.length > 1 ? "s" : ""}</span>
          </summary>

          <div className="tool-event-list">
            {events.map((event) => (
              <article key={`${event.step}-${event.tool}`} className="tool-event-item">
                <div className="tool-event-topline">
                  <strong>{event.tool}</strong>
                  <span className={`tool-event-status ${event.ok ? "ok" : "error"}`}>
                    {event.ok ? "ok" : "error"}
                  </span>
                </div>
                <p>{event.summary}</p>
              </article>
            ))}
          </div>
        </details>
      </section>
    );
  }

  function renderCharacterBuilder() {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Character Builder</p>
              <h2>Role sentence first</h2>
            </div>
            <button className="ghost-button" type="button" onClick={prepareCreateCharacter}>
              New character
            </button>
          </div>

          <form className="form-stack" onSubmit={handleComposeCharacter}>
            <label>
              <span>Concept</span>
              <textarea
                value={characterBrief}
                onChange={(event) => setCharacterBrief(event.target.value)}
                placeholder="Example: Answer like a skeptical founder who cuts to first principles, dismisses vague claims, and sounds impatient with fluff."
              />
            </label>

            <div className="actions">
              <button className="primary-button" type="submit" disabled={studioBusy}>
                {studioBusy ? "Generating..." : "Generate details"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={handleRefreshBlueprint}
                disabled={studioBusy || !definition.name}
              >
                Refresh bundle
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowAdvancedBuilder((current) => !current)}
                disabled={!definition.name}
              >
                {showAdvancedBuilder ? "Hide details" : "Edit details"}
              </button>
            </div>
          </form>

          <p className="small-note">
            Give the builder one sentence with viewpoint, behavior, or cadence. Do not enter only a
            name. AI expands that into a full persona definition first, then builds the neural
            bundle from it.
          </p>

          {studioError ? <p className="error-banner">{studioError}</p> : null}
          {studioSaved ? <p className="success-banner">{studioSaved}</p> : null}
        </section>

        <div className="character-shell">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Expanded Definition</p>
                <h2>{definition.name || "Waiting for a concept"}</h2>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={handleSaveCharacter}
                disabled={studioBusy || !definition.name}
              >
                {studioBusy ? "Saving..." : studioMode === "edit" ? "Update character" : "Save character"}
              </button>
            </div>

            {definition.name ? (
              <div className="stack-list">
                <article className="list-card">
                  <strong>Core summary</strong>
                  <p>{definition.oneLiner}</p>
                </article>
                <article className="list-card">
                  <strong>Audience and tone</strong>
                  <p>{definition.audience}</p>
                  <p>{definition.tone}</p>
                </article>
                <article className="list-card">
                  <strong>Goals and boundaries</strong>
                  <p>{definition.goals}</p>
                  <p>{definition.boundaries}</p>
                </article>
                {blueprintPreview?.tags?.length ? (
                  <article className="list-card">
                    <strong>Bundle tags</strong>
                    <div className="tag-row">
                      {blueprintPreview.tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </article>
                ) : null}
              </div>
            ) : (
              <p className="empty-state">
                Expand a one-line concept first. The full definition will appear here before you
                save the character.
              </p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Bundle Preview</p>
                <h2>{blueprintPreview?.summary || "Bundle not generated yet"}</h2>
              </div>
            </div>

            {blueprintPreview ? (
              <>
                <p className="small-note">{blueprintPreview.greeting}</p>
                <div className="tag-row">
                  {blueprintPreview.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                {showAdvancedBuilder ? (
                  <div className="form-stack advanced-editor">
                    <label>
                      <span>Language</span>
                      <select
                        value={definition.language}
                        onChange={(event) => updateDefinitionField("language", event.target.value)}
                      >
                        <option value="English">English</option>
                        <option value="Chinese">Chinese</option>
                      </select>
                    </label>
                    <label>
                      <span>Name</span>
                      <input
                        value={definition.name}
                        onChange={(event) => updateDefinitionField("name", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>One-liner</span>
                      <input
                        value={definition.oneLiner}
                        onChange={(event) => updateDefinitionField("oneLiner", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Domain</span>
                      <input
                        value={definition.domain}
                        onChange={(event) => updateDefinitionField("domain", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Audience</span>
                      <input
                        value={definition.audience}
                        onChange={(event) => updateDefinitionField("audience", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Tone</span>
                      <input
                        value={definition.tone}
                        onChange={(event) => updateDefinitionField("tone", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Greeting</span>
                      <input
                        value={definition.greeting}
                        onChange={(event) => updateDefinitionField("greeting", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Personality</span>
                      <textarea
                        value={definition.personality}
                        onChange={(event) =>
                          updateDefinitionField("personality", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Goals</span>
                      <textarea
                        value={definition.goals}
                        onChange={(event) => updateDefinitionField("goals", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Boundaries</span>
                      <textarea
                        value={definition.boundaries}
                        onChange={(event) =>
                          updateDefinitionField("boundaries", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Knowledge pack</span>
                      <textarea
                        value={definition.knowledge}
                        onChange={(event) =>
                          updateDefinitionField("knowledge", event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="small-note">
                    Keep the builder simple. Only open the full editor if you want to fine-tune the
                    generated definition before saving.
                  </p>
                )}
              </>
            ) : (
              <p className="empty-state">
                After expansion, this panel will show the generated greeting, bundle summary, and
                tags that will drive the saved role.
              </p>
            )}
          </section>
        </div>
      </>
    );
  }

  function renderChatWorkspace() {
    const memories = Array.isArray(selectedCharacter?.globalMemories)
      ? (selectedCharacter?.globalMemories || [])
      : [];
    const attachedSkillIds = new Set(attachedSkills.map((skill) => skill.id));

    return (
      <div className="chat-app-shell">
        <aside className="chat-app-sidebar">
          <div className="chat-app-sidebar-top">
            <div className="chat-app-brand-row">
              <button
                className="chat-app-brand"
                type="button"
                onClick={() => setAppSection("characters")}
              >
                Liberth
              </button>
              <button
                className="chat-app-link"
                type="button"
                onClick={() => setAppSection("settings")}
              >
                Settings
              </button>
            </div>

            <button
              className="chat-app-newchat"
              type="button"
              onClick={handleCreateConversation}
              disabled={!selectedCharacter || chatBusy}
            >
              New chat
            </button>
          </div>

          <div className="chat-app-history">
            {selectedCharacter ? (
              conversations.length ? (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    className={`chat-history-item ${
                      conversation.id === selectedConversationId ? "active" : ""
                    }`}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                  >
                    <strong>{conversation.title || "New chat"}</strong>
                    <span>{conversationSnippet(conversation)}</span>
                  </button>
                ))
              ) : (
                <p className="chat-history-empty">
                  No saved conversations yet. Start one from the button above.
                </p>
              )
            ) : (
              <p className="chat-history-empty">
                Choose a role first. Chat should open on a selected character, not as a blank
                workspace.
              </p>
            )}
          </div>

          <div className="chat-app-sidebar-footer">
            <label className="chat-role-picker">
              <span>Role</span>
              <select
                value={selectedCharacterId}
                onChange={(event) => {
                  setSelectedCharacterId(event.target.value);
                  setSelectedConversationId("");
                }}
              >
                <option value="">Choose a role</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.definition.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="chat-sidebar-actions">
              <button
                className="chat-app-link"
                type="button"
                onClick={() => setAppSection("characters")}
              >
                Characters
              </button>
              <button
                className="chat-app-link"
                type="button"
                onClick={() => setAppSection("settings")}
              >
                Runtime
              </button>
            </div>
          </div>
        </aside>

        <main className="chat-app-main">
          {selectedCharacter ? (
            <>
              <header className="chat-topbar">
                <div className="chat-topbar-copy">
                  <h2>{selectedConversation?.title || "New chat"}</h2>
                  <p>
                    {selectedCharacter.definition.name}
                    {" · "}
                    {selectedCharacter.definition.oneLiner}
                  </p>
                  <div className="chat-topbar-status">
                    <span className="meta-pill">{providerDisplayLabel(providerSettings.providerMode)}</span>
                    <span className="meta-pill">{providerRuntimeModel(providerSettings)}</span>
                    <span className="meta-pill">{providerFamilyLabel(providerSettings.providerMode)}</span>
                  </div>
                </div>

                <div className="actions chat-topbar-actions">
                  <button
                    className={`ghost-button inspector-toggle ${
                      chatInspector === "skills" ? "active" : ""
                    }`}
                    type="button"
                    onClick={() =>
                      setChatInspector((current) => (current === "skills" ? "none" : "skills"))
                    }
                  >
                    Skills{attachedSkills.length ? ` · ${attachedSkills.length}` : ""}
                  </button>
                  <button
                    className={`ghost-button inspector-toggle ${
                      chatInspector === "automations" ? "active" : ""
                    }`}
                    type="button"
                    onClick={() =>
                      setChatInspector((current) =>
                        current === "automations" ? "none" : "automations",
                      )
                    }
                  >
                    Automations{automations.length ? ` · ${automations.length}` : ""}
                  </button>
                  <button
                    className={`ghost-button inspector-toggle ${
                      chatInspector === "role" ? "active" : ""
                    }`}
                    type="button"
                    onClick={() =>
                      setChatInspector((current) => (current === "role" ? "none" : "role"))
                    }
                  >
                    Role
                  </button>
                  <button
                    className={`ghost-button inspector-toggle ${
                      chatInspector === "memory" ? "active" : ""
                    }`}
                    type="button"
                    onClick={() =>
                      setChatInspector((current) => (current === "memory" ? "none" : "memory"))
                    }
                  >
                    Memory
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => handleExportConversation("json")}
                    disabled={!selectedConversation?.id || exportBusy !== ""}
                  >
                    {exportBusy === "json" ? "Exporting..." : "JSON"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => handleExportConversation("markdown")}
                    disabled={!selectedConversation?.id || exportBusy !== ""}
                  >
                    {exportBusy === "markdown" ? "Exporting..." : "Markdown"}
                  </button>
                </div>
              </header>

              {chatError ? <p className="error-banner chat-banner">{chatError}</p> : null}
              {chatInspector !== "none" ? (
                <section className="chat-inline-inspector chat-meta-drawer">
                  {chatInspector === "skills" ? (
                    <div className="skills-drawer">
                      <div className="skills-drawer-head">
                        <div>
                          <strong>Attached skills</strong>
                          <p>Search, install, and remove OpenClaw-style extensions here.</p>
                        </div>
                      </div>

                      <form className="skills-search-form" onSubmit={handleSearchSkills}>
                        <input
                          value={skillSearchQuery}
                          onChange={(event) => setSkillSearchQuery(event.target.value)}
                          placeholder="Search skills, workflows, tools, domains..."
                        />
                        <button
                          className="ghost-button"
                          type="submit"
                          disabled={skillsBusy === "search"}
                        >
                          {skillsBusy === "search" ? "Searching..." : "Search"}
                        </button>
                      </form>

                      {skillsError ? <p className="error-banner">{skillsError}</p> : null}

                      <div className="skills-grid">
                        <article className="skills-column">
                          <strong className="skills-column-title">
                            Installed
                            {attachedSkills.length ? ` · ${attachedSkills.length}` : ""}
                          </strong>
                          {attachedSkills.length ? (
                            <div className="skills-list">
                              {attachedSkills.map((skill) => (
                                <article key={skill.id} className="skill-card">
                                  <div className="skill-card-topline">
                                    <div>
                                      <strong>{skill.name}</strong>
                                      <p>{skill.description}</p>
                                    </div>
                                    <button
                                      className="ghost-button skill-action"
                                      type="button"
                                      onClick={() => handleRemoveSkill(skill.id)}
                                      disabled={skillsBusy === `remove:${skill.id}`}
                                    >
                                      {skillsBusy === `remove:${skill.id}` ? "Removing..." : "Remove"}
                                    </button>
                                  </div>
                                  <div className="skill-meta-row">
                                    <span className="meta-pill">{skill.id}</span>
                                    <span className="meta-pill">{skill.source || "workspace"}</span>
                                  </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="empty-state inspector-empty">
                              No skills attached yet. Search and install one below, or ask the chat
                              to install one for you.
                            </p>
                          )}
                        </article>

                        <article className="skills-column">
                          <strong className="skills-column-title">Search results</strong>
                          {skillSearchResults.length ? (
                            <div className="skills-list">
                              {skillSearchResults.map((skill) => {
                                const installed = attachedSkillIds.has(skill.id);
                                return (
                                  <article key={`${skill.packageRef || skill.id}`} className="skill-card">
                                    <div className="skill-card-topline">
                                      <div>
                                        <strong>{skill.name}</strong>
                                        <p>{skill.description}</p>
                                      </div>
                                      <button
                                        className="ghost-button skill-action"
                                        type="button"
                                        onClick={() => handleInstallSkill(skill)}
                                        disabled={installed || skillsBusy === `install:${skill.id}`}
                                      >
                                        {installed
                                          ? "Installed"
                                          : skillsBusy === `install:${skill.id}`
                                          ? "Installing..."
                                          : "Install"}
                                      </button>
                                    </div>
                                    <div className="skill-meta-row">
                                      <span className="meta-pill">{skill.id}</span>
                                      {skill.packageRef ? (
                                        <span className="meta-pill">{skill.packageRef}</span>
                                      ) : null}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="empty-state inspector-empty">
                              Search for a capability like `browser automation`, `seo audit`, or
                              `react routing` to attach it to this role.
                            </p>
                          )}
                        </article>
                      </div>
                    </div>
                  ) : chatInspector === "automations" ? (
                    <div className="skills-drawer">
                      <div className="skills-drawer-head">
                        <div>
                          <strong>Automations</strong>
                          <p>Run scheduled prompts against this role, OpenClaw-style.</p>
                        </div>
                      </div>

                      {automationError ? <p className="error-banner">{automationError}</p> : null}

                      <div className="skills-grid">
                        <article className="skills-column">
                          <strong className="skills-column-title">Create automation</strong>
                          <form className="automation-form" onSubmit={handleCreateAutomation}>
                            <input
                              value={automationNameDraft}
                              onChange={(event) => setAutomationNameDraft(event.target.value)}
                              placeholder="Morning research pulse"
                            />
                            <textarea
                              value={automationPromptDraft}
                              onChange={(event) => setAutomationPromptDraft(event.target.value)}
                              placeholder="What should this role research or generate on each run?"
                            />
                            <div className="automation-form-row">
                              <label className="automation-field">
                                <span>Interval (min)</span>
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={automationIntervalDraft}
                                  onChange={(event) => setAutomationIntervalDraft(event.target.value)}
                                />
                              </label>
                              <label className="automation-toggle">
                                <input
                                  type="checkbox"
                                  checked={automationEnabledDraft}
                                  onChange={(event) => setAutomationEnabledDraft(event.target.checked)}
                                />
                                <span>Enabled on create</span>
                              </label>
                            </div>
                            <button
                              className="ghost-button"
                              type="submit"
                              disabled={automationBusy === "create"}
                            >
                              {automationBusy === "create" ? "Creating..." : "Create automation"}
                            </button>
                          </form>
                        </article>

                        <article className="skills-column">
                          <strong className="skills-column-title">
                            Scheduled
                            {automations.length ? ` · ${automations.length}` : ""}
                          </strong>
                          {automations.length ? (
                            <div className="skills-list">
                              {automations.map((automation) => (
                                <article key={automation.id} className="skill-card">
                                  <div className="skill-card-topline">
                                    <div>
                                      <strong>{automation.name}</strong>
                                      <p>{automation.prompt}</p>
                                    </div>
                                    <div className="skill-card-actions">
                                      <button
                                        className="ghost-button skill-action"
                                        type="button"
                                        onClick={() => handleToggleAutomation(automation)}
                                        disabled={automationBusy === `toggle:${automation.id}`}
                                      >
                                        {automationBusy === `toggle:${automation.id}`
                                          ? "Saving..."
                                          : automation.enabled
                                          ? "Pause"
                                          : "Enable"}
                                      </button>
                                      <button
                                        className="ghost-button skill-action"
                                        type="button"
                                        onClick={() => handleRunAutomation(automation.id)}
                                        disabled={automationBusy === `run:${automation.id}`}
                                      >
                                        {automationBusy === `run:${automation.id}` ? "Running..." : "Run now"}
                                      </button>
                                      <button
                                        className="ghost-button skill-action"
                                        type="button"
                                        onClick={() => handleDeleteAutomation(automation.id)}
                                        disabled={automationBusy === `delete:${automation.id}`}
                                      >
                                        {automationBusy === `delete:${automation.id}`
                                          ? "Deleting..."
                                          : "Delete"}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="skill-meta-row">
                                    <span className="meta-pill">
                                      {formatIntervalMinutes(automation.intervalMinutes)}
                                    </span>
                                    <span
                                      className={`meta-pill ${
                                        automation.enabled ? "meta-pill-hot" : ""
                                      }`}
                                    >
                                      {automation.enabled ? "active" : "paused"}
                                    </span>
                                    {automation.nextRunAt ? (
                                      <span className="meta-pill">
                                        Next {formatTime(automation.nextRunAt)}
                                      </span>
                                    ) : null}
                                  </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="empty-state inspector-empty">
                              No scheduled tasks yet. Create one to let this role run repeatable
                              prompts in the background.
                            </p>
                          )}
                        </article>
                      </div>

                      <article className="skills-column">
                        <strong className="skills-column-title">Recent runs</strong>
                        {automationRuns.length ? (
                          <div className="automation-run-list">
                            {automationRuns.map((run) => (
                              <article key={run.id} className="skill-card automation-run-card">
                                <div className="tool-event-topline">
                                  <strong>{formatTime(run.createdAt)}</strong>
                                  <span
                                    className={`tool-event-status ${
                                      run.status === "success" ? "ok" : "error"
                                    }`}
                                  >
                                    {run.status}
                                  </span>
                                </div>
                                <p>{run.prompt}</p>
                                {run.reply ? (
                                  <pre className="mono compact-pre automation-run-reply">{run.reply}</pre>
                                ) : null}
                                {run.error ? <p className="small-note">{run.error}</p> : null}
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="empty-state inspector-empty">
                            Runs will appear here after an automation fires or you launch one
                            manually.
                          </p>
                        )}
                      </article>
                    </div>
                  ) : chatInspector === "role" ? (
                    <div className="inspector-grid">
                      <article className="list-card inspector-card">
                        <strong>{selectedCharacter.definition.name}</strong>
                        <p>{selectedCharacter.definition.oneLiner}</p>
                      </article>
                      <article className="list-card inspector-card">
                        <strong>Runtime summary</strong>
                        <p>{selectedCharacter.blueprint.summary}</p>
                      </article>
                      <article className="list-card inspector-card inspector-card-wide">
                        <strong>Tags</strong>
                        <div className="tag-row">
                          {selectedCharacter.blueprint.tags.map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </article>
                    </div>
                  ) : memories.length ? (
                    <div className="inspector-grid">
                      {[...memories].reverse().map((memory: NeuralMemoryRecord) => (
                        <article key={memory.id} className="list-card inspector-card">
                          <strong>{memory.sourceRoute || "memory"}</strong>
                          <p>{memory.content}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state inspector-empty">
                      Stable preferences and repeated signals will accumulate here over time.
                    </p>
                  )}
                </section>
              ) : null}

              <div ref={messageStageRef} className="message-stage chat-thread">
                {displayedMessages.map((message) => (
                  <article
                    key={`${selectedConversation?.id || "starter"}-${message.id}`}
                    className={`message-card ${message.role}`}
                  >
                    <div className="message-meta">
                      <span className="message-role">{message.role}</span>
                      <span className="message-time">{formatTime(message.createdAt)}</span>
                    </div>
                    {message.content.trim() ? (
                      <div className="message-copy">
                        <p>{message.content}</p>
                      </div>
                    ) : null}
                    {Array.isArray(message.attachments) && message.attachments.length ? (
                      <div className="message-attachments">
                        {message.attachments.map((attachment) => (
                          <figure key={attachment.id} className="message-attachment">
                            <img src={attachment.dataUrl} alt={attachment.name || "chat upload"} />
                            {attachment.name ? <figcaption>{attachment.name}</figcaption> : null}
                          </figure>
                        ))}
                      </div>
                    ) : null}
                    {message.role === "assistant" && message.generation ? (
                      <>
                        <div className="message-trace">
                          <span
                            className={`meta-pill ${
                              message.generation.mode === "llm"
                                ? "meta-pill-success"
                                : "meta-pill-warning"
                            }`}
                          >
                            {message.generation.mode === "llm" ? "Live model" : "Fallback"}
                          </span>
                          <span className="meta-pill">
                            {providerDisplayLabel(message.generation.providerMode)}
                          </span>
                          <span className="meta-pill">{message.generation.model}</span>
                          {message.generation.totalTokens ? (
                            <span className="meta-pill">{message.generation.totalTokens} tokens</span>
                          ) : null}
                          {message.generation.nativeTools ? (
                            <span className="meta-pill">Native tools</span>
                          ) : null}
                        </div>
                        {message.generation.mode === "fallback" && message.generation.reason ? (
                          <p className="message-warning">
                            {formatGenerationReason(message.generation.reason)}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {message.role === "assistant" && Array.isArray(message.toolEvents)
                      ? renderToolEvents(message.toolEvents)
                      : null}
                    {message.role === "assistant" && message.neuralRecord
                      ? renderNeuralRecord(message.neuralRecord)
                      : null}
                  </article>
                ))}
              </div>

              <div className="chat-composer-shell">
                <form className="composer chat-composer" onSubmit={handleSendMessage}>
                  <input
                    ref={imageInputRef}
                    className="chat-image-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleChatImageSelection}
                    disabled={chatBusy}
                  />
                  {chatAttachments.length ? (
                    <div className="chat-attachment-strip">
                      {chatAttachments.map((attachment) => (
                        <div key={attachment.id} className="chat-attachment-chip">
                          <img src={attachment.dataUrl} alt={attachment.name || "pending upload"} />
                          <div className="chat-attachment-chip-copy">
                            <strong>{attachment.name || "Image"}</strong>
                          </div>
                          <button
                            className="chat-attachment-remove"
                            type="button"
                            onClick={() => handleRemoveChatAttachment(attachment.id)}
                            disabled={chatBusy}
                            aria-label={`Remove ${attachment.name || "image"}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    value={chatText}
                    onChange={(event) => setChatText(event.target.value)}
                    placeholder={
                      selectedConversation
                        ? "Message the character..."
                        : "Send a message to start a new local conversation."
                    }
                    disabled={chatBusy}
                  />
                  <div className="actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={handleOpenChatImagePicker}
                      disabled={chatBusy || chatAttachments.length >= CLIENT_CHAT_IMAGE_MAX_COUNT}
                    >
                      Image
                    </button>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={chatBusy || (!chatText.trim() && !chatAttachments.length)}
                    >
                      {chatBusy ? "Sending..." : "Send"}
                    </button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <section className="chat-empty-stage">
              <p className="eyebrow">Chat</p>
              <h2>Choose a role to begin</h2>
              <p>
                Chat should behave like a focused messaging surface. Select a saved role from the
                sidebar, or go back and build one first.
              </p>
              <div className="actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setAppSection("characters")}
                >
                  Open characters
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setAppSection("settings")}
                >
                  Runtime settings
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    );
  }

  function renderProviderSelection() {
    return (
      <aside className="settings-provider-nav">
        {providerSections.map((section) => (
          <section key={section.title} className="settings-provider-group">
            <div className="settings-provider-group-head">
              <p className="eyebrow">{section.title}</p>
            </div>

            <div className="settings-provider-group-list">
              {section.modes.map((mode) => {
                const item = getProviderCatalogItem(mode);
                const active = providerSettings.providerMode === item.id;
                return (
                  <button
                    key={item.id}
                    className={`settings-provider-button ${active ? "active" : ""}`}
                    type="button"
                    onClick={() => updateProviderMode(item.id)}
                  >
                    <span className="settings-provider-mark">{providerMonogram(item.id)}</span>
                    <span className="settings-provider-copy">
                      <span className="settings-provider-topline">
                        <strong>{item.label}</strong>
                        <span className="settings-provider-family">
                          {providerConnectionLabel(item.id)}
                        </span>
                      </span>
                    </span>
                    {active ? <span className="settings-provider-state">Selected</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </aside>
    );
  }

  function renderProviderForm(setupMode = false) {
    return (
      <div className={`settings-provider-form ${setupMode ? "setup-mode" : ""}`}>
        <div className="settings-provider-summary">
          <p className="eyebrow">{setupMode ? "Step 2" : "Selected provider"}</p>
          <h3>{activeProviderPreset.label}</h3>
          <p className="small-note">
            {providerNeedsApiKey(providerSettings.providerMode)
              ? "Paste an API key, then save."
              : "Use your local Ollama runtime, then save."}
          </p>
        </div>

        <div className="form-stack">
          {providerNeedsApiKey(providerSettings.providerMode) ? (
            <label>
              <span>API key</span>
              <input
                type="password"
                placeholder={activeProviderPreset.apiKeyPlaceholder}
                value={providerSettings.apiKey}
                onChange={(event) => updateProviderField("apiKey", event.target.value)}
              />
            </label>
          ) : null}

          {providerSettings.providerMode === "glm-main" ? (
            <label>
              <span>GLM model</span>
              <input
                value={providerSettings.glmModel}
                onChange={(event) => updateProviderField("glmModel", event.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                <span>Base URL</span>
                <input
                  value={providerSettings.baseUrl}
                  onChange={(event) => updateProviderField("baseUrl", event.target.value)}
                />
              </label>
              <label>
                <span>Model</span>
                <input
                  value={providerSettings.model}
                  onChange={(event) => updateProviderField("model", event.target.value)}
                />
              </label>
              {providerSettings.providerMode === "anthropic" ? (
                <label>
                  <span>Anthropic version</span>
                  <input
                    value={providerSettings.anthropicVersion}
                    onChange={(event) =>
                      updateProviderField("anthropicVersion", event.target.value)}
                  />
                </label>
              ) : null}
              {providerSettings.providerMode === "google-gemini" ? (
                <label>
                  <span>Google API version</span>
                  <input
                    value={providerSettings.googleApiVersion}
                    onChange={(event) =>
                      updateProviderField("googleApiVersion", event.target.value)}
                  />
                </label>
              ) : null}
            </>
          )}
        </div>

        <div className="actions">
          <button
            className="primary-button wide"
            type="button"
            onClick={handleSaveProviderSettings}
            disabled={settingsBusy}
          >
            {settingsBusy ? "Saving..." : setupMode ? "Save and continue" : "Save runtime"}
          </button>
        </div>

        {!setupMode ? (
          <p className="small-note">
            Leave the API key blank to keep the stored key for the current provider.
          </p>
        ) : null}
        {settingsError ? <p className="error-banner">{settingsError}</p> : null}
        {settingsSaved ? <p className="success-banner">{settingsSaved}</p> : null}
      </div>
    );
  }

  function renderProviderSetupGate() {
    return (
      <div className="setup-gate">
        <section className="panel setup-gate-panel">
          <div className="setup-gate-copy">
            <p className="eyebrow">Runtime setup</p>
            <h1>Connect a model first</h1>
            <p>Pick one provider, enter the required value, and save.</p>
          </div>

          <div className="settings-runtime-shell setup-runtime-shell">
            {renderProviderSelection()}
            {renderProviderForm(true)}
          </div>
        </section>
      </div>
    );
  }

  function renderOutboundSettings() {
    if (!selectedCharacter) {
      return <p className="empty-state">Select a character to configure outbound channels.</p>;
    }

    const currentDraft = activeOutboundChannel === "webhook"
      ? webhookDraft
      : activeOutboundChannel === "slack"
      ? slackDraft
      : telegramDraft;

    return (
      <div className="stack-list">
        <div className="provider-grid">
          {(["webhook", "slack", "telegram"] as DeploymentChannel[]).map((channel) => (
            <button
              key={channel}
              className={`provider-card ${activeOutboundChannel === channel ? "active" : ""}`}
              type="button"
              onClick={() => setActiveOutboundChannel(channel)}
            >
              <strong>{formatChannelName(channel)}</strong>
              <span>{describeChannel(channel)}</span>
              {deployments.find((item) => item.channel === channel) ? (
                <span className="small-note">
                  {describeDeploymentTarget(
                    deployments.find((item) => item.channel === channel) as DeploymentRecord,
                  )}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="form-stack">
          {activeOutboundChannel === "webhook" ? (
            <>
              <label>
                <span>Outbound URL</span>
                <input
                  value={webhookDraft.outboundUrl}
                  onChange={(event) => updateWebhookDraft("outboundUrl", event.target.value)}
                />
              </label>
              <label>
                <span>Authorization header</span>
                <input
                  value={webhookDraft.outboundAuthHeader}
                  onChange={(event) =>
                    updateWebhookDraft("outboundAuthHeader", event.target.value)}
                />
              </label>
            </>
          ) : null}

          {activeOutboundChannel === "slack" ? (
            <>
              <label>
                <span>Bot token</span>
                <input
                  type="password"
                  value={slackDraft.botToken}
                  onChange={(event) => updateSlackDraft("botToken", event.target.value)}
                />
              </label>
              <label>
                <span>Channel ID</span>
                <input
                  value={slackDraft.channelId}
                  onChange={(event) => updateSlackDraft("channelId", event.target.value)}
                />
              </label>
              <label>
                <span>Signing secret</span>
                <input
                  type="password"
                  value={slackDraft.signingSecret}
                  onChange={(event) => updateSlackDraft("signingSecret", event.target.value)}
                />
              </label>
            </>
          ) : null}

          {activeOutboundChannel === "telegram" ? (
            <>
              <label>
                <span>Bot token</span>
                <input
                  type="password"
                  value={telegramDraft.botToken}
                  onChange={(event) => updateTelegramDraft("botToken", event.target.value)}
                />
              </label>
              <label>
                <span>Chat ID</span>
                <input
                  value={telegramDraft.chatId}
                  onChange={(event) => updateTelegramDraft("chatId", event.target.value)}
                />
              </label>
              <label>
                <span>Secret token</span>
                <input
                  type="password"
                  value={telegramDraft.secretToken}
                  onChange={(event) => updateTelegramDraft("secretToken", event.target.value)}
                />
              </label>
            </>
          ) : null}

          <label>
            <span>Status</span>
            <select
              value={currentDraft.enabled ? "enabled" : "disabled"}
              onChange={(event) => {
                const enabled = event.target.value === "enabled";
                if (activeOutboundChannel === "webhook") {
                  updateWebhookDraft("enabled", enabled);
                } else if (activeOutboundChannel === "slack") {
                  updateSlackDraft("enabled", enabled);
                } else {
                  updateTelegramDraft("enabled", enabled);
                }
              }}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => handleSaveDeployment(activeOutboundChannel)}
            disabled={integrationBusy}
          >
            {integrationBusy ? "Saving..." : `Save ${formatChannelName(activeOutboundChannel)}`}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => handleSendDeploymentTest(activeOutboundChannel)}
            disabled={integrationBusy || !activeOutboundDeployment}
          >
            Send test
          </button>
        </div>
      </div>
    );
  }

  function renderSettingsWorkspace() {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>Runtime and advanced controls</h2>
            </div>
          </div>
          <p className="small-note">
            Choose one provider, fill the required fields, then save.
          </p>
        </section>

        <div className="split settings-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Runtime</p>
                <h2>Provider settings</h2>
              </div>
            </div>

            <div className="settings-runtime-shell">
              {renderProviderSelection()}
              {renderProviderForm()}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Outbound</p>
                <h2>Character-specific channels</h2>
              </div>
            </div>
            {renderOutboundSettings()}
            {integrationError ? <p className="error-banner">{integrationError}</p> : null}
            {integrationSaved ? <p className="success-banner">{integrationSaved}</p> : null}
          </section>
        </div>
      </>
    );
  }

  if (!bootstrapped) {
    return (
      <div className="setup-gate">
        <section className="panel setup-gate-panel loading">
          <div className="setup-gate-copy">
            <p className="eyebrow">Liberth</p>
            <h1>Loading runtime</h1>
          </div>
        </section>
      </div>
    );
  }

  if (providerSetupRequired) {
    return renderProviderSetupGate();
  }

  if (appSection === "chat") {
    return renderChatWorkspace();
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">liberth-neural</p>
          <h1>Neural character dialogue</h1>
          <p className="muted">
            Generate or select a role first, then chat in a separate workspace with local
            conversation history.
          </p>
        </div>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Navigation</p>
              <h2>Workspace</h2>
            </div>
          </div>
          <div className="nav-stack">
            <button
              className={`nav-button ${appSection === "characters" ? "active" : ""}`}
              type="button"
              onClick={() => setAppSection("characters")}
            >
              Characters
            </button>
            <button
              className="nav-button"
              type="button"
              onClick={() => setAppSection("chat")}
              disabled={!selectedCharacter || providerSetupRequired}
            >
              Chat
            </button>
            <button
              className={`nav-button ${appSection === "settings" ? "active" : ""}`}
              type="button"
              onClick={() => setAppSection("settings")}
            >
              Settings
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Selected role</p>
              <h2>{selectedCharacter?.definition.name || "None yet"}</h2>
            </div>
            {selectedCharacter ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => prepareEditCharacter(selectedCharacter)}
              >
                Edit
              </button>
            ) : null}
          </div>

          {selectedCharacter ? (
            <div className="stack-list">
              <article className="list-card">
                <strong>{selectedCharacter.definition.oneLiner}</strong>
                <p>{selectedCharacter.blueprint.summary}</p>
              </article>
              <div className="tag-row">
                {selectedCharacter.blueprint.tags.slice(0, 6).map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => openChatForCharacter(selectedCharacter)}
                  disabled={providerSetupRequired}
                >
                  Open chat
                </button>
                <button className="secondary-button" type="button" onClick={prepareCreateCharacter}>
                  New role
                </button>
              </div>
            </div>
          ) : (
            <p className="empty-state">
              Start with a one-line concept or select one of your saved characters below.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Saved characters</p>
              <h2>Roster</h2>
            </div>
            <button className="ghost-button" type="button" onClick={prepareCreateCharacter}>
              New
            </button>
          </div>

          <div className="character-list">
            {characters.length ? (
              characters.map((character) => (
                <article
                  key={character.id}
                  className={`character-card ${character.id === selectedCharacterId ? "active" : ""}`}
                >
                  <strong>{character.definition.name}</strong>
                  <span>{character.definition.oneLiner}</span>
                  <div className="actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => openChatForCharacter(character)}
                      disabled={providerSetupRequired}
                    >
                      Chat
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => prepareEditCharacter(character)}
                    >
                      Edit
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-state">No characters saved yet.</p>
            )}
          </div>
        </section>
      </aside>

      <main className="workspace">
        {appSection === "characters" ? renderCharacterBuilder() : null}
        {appSection === "settings" ? renderSettingsWorkspace() : null}
      </main>
    </div>
  );
}
