import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  type CharacterRecord,
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

function routePillClass(route: string) {
  return `route-pill route-${String(route || "respond").toLowerCase()}`;
}

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
  return latestUser?.content || conversation.messages[0]?.content || "New chat";
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
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState("");
  const [studioSaved, setStudioSaved] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [providerSettings, setProviderSettings] =
    useState<ProviderSettings>(emptyProviderSettings);
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
    if (!selectedCharacterId) {
      setConversations([]);
      setSelectedConversationId("");
      setDeployments([]);
      setSlackDraft(emptySlackDraft());
      setTelegramDraft(emptyTelegramDraft());
      setWebhookDraft(emptyWebhookDraft());
      return;
    }
    void loadConversations(selectedCharacterId);
    void loadDeployments(selectedCharacterId);
  }, [selectedCharacterId]);

  async function bootstrap() {
    await Promise.all([loadCharacters(), loadProviderSettings()]);
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
    const payload = await requestJson<{ provider: ProviderSettings }>("/api/settings/provider");
    setProviderSettings(payload.provider);
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
      setStudioError("Give the character a one-line concept first.");
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

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedCharacter || !chatText.trim()) return;

    setChatBusy(true);
    setChatError("");
    const userContent = chatText.trim();
    setChatText("");

    try {
      const payload = await requestJson<ChatPayload>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          characterId: selectedCharacter.id,
          conversationId: selectedConversationId || undefined,
          message: userContent,
        }),
      });
      patchCharacter(payload.character);
      upsertConversationState(payload.conversation);
      if (studioMode === "edit" && payload.character.id === selectedCharacter.id) {
        setBlueprintPreview(payload.character.blueprint);
      }
    } catch (error: any) {
      setChatError(String(error?.message || error));
    } finally {
      setChatBusy(false);
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
    setSettingsBusy(true);
    setSettingsError("");
    setSettingsSaved("");
    try {
      const payload = await requestJson<{ provider: ProviderSettings }>(
        "/api/settings/provider",
        {
          method: "PUT",
          body: JSON.stringify({ provider: providerSettings }),
        },
      );
      setProviderSettings(payload.provider);
      setSettingsSaved("Runtime settings saved.");
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
        <div className="neural-record-topline">
          <span className={routePillClass(record.dominantRoute)}>{record.dominantRoute}</span>
          <span className="meta-pill">{record.provider.providerMode}</span>
          <span className="meta-pill">{record.provider.model}</span>
          <span
            className={`meta-pill ${
              record.memoryDirective.writeGlobalMemory ? "meta-pill-hot" : ""
            }`}
          >
            {record.memoryDirective.writeGlobalMemory ? "memory writeback" : "thread only"}
          </span>
        </div>

        <p className="neural-record-summary">
          {record.broadcastSummary || record.turnSummary}
        </p>

        <div className="metric-strip">
          <span className="metric-chip">focus {formatPercent(record.modulators.focus)}</span>
          <span className="metric-chip">novelty {formatPercent(record.modulators.novelty)}</span>
          <span className="metric-chip">caution {formatPercent(record.modulators.caution)}</span>
          <span className="metric-chip">margin {formatPercent(record.routeInspector.margin)}</span>
        </div>

        <details className="neural-details">
          <summary>Inspect neural record</summary>
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
                <p className="small-note">This turn did not produce a durable-memory candidate.</p>
              )}
            </article>
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
              <h2>One-line concept first</h2>
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
                placeholder="Example: A midnight strategy editor who answers like a calm newsroom chief."
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
            Describe the role in one sentence. AI expands the full character definition first,
            then builds the neural bundle from that result.
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

    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Chat Workspace</p>
              <h2>{selectedCharacter ? selectedCharacter.definition.name : "Select a character"}</h2>
            </div>
            <div className="actions">
              {selectedCharacter ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => prepareEditCharacter(selectedCharacter)}
                >
                  Edit character
                </button>
              ) : null}
              <button className="ghost-button" type="button" onClick={() => setAppSection("characters")}>
                Characters
              </button>
            </div>
          </div>

          {selectedCharacter ? (
            <p className="small-note">
              Chat lives separately from the builder now. Pick or create a role first, then keep
              local conversation history in this workspace like a ChatGPT-style thread list.
            </p>
          ) : (
            <p className="empty-state">
              Create or choose a neural character before entering chat.
            </p>
          )}
        </section>

        {selectedCharacter ? (
          <>
            <div className="chat-shell">
              <section className="panel conversation-sidebar">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Conversations</p>
                    <h2>Local history</h2>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={handleCreateConversation}
                    disabled={chatBusy}
                  >
                    New chat
                  </button>
                </div>

                <div className="conversation-list">
                  {conversations.length ? (
                    conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        className={`conversation-item ${
                          conversation.id === selectedConversationId ? "active" : ""
                        }`}
                        type="button"
                        onClick={() => setSelectedConversationId(conversation.id)}
                      >
                        <strong>{conversation.title || "New chat"}</strong>
                        <span>{conversationSnippet(conversation)}</span>
                        <small>{formatTime(conversation.updatedAt)}</small>
                      </button>
                    ))
                  ) : (
                    <p className="empty-state">
                      No saved conversations yet. Send a message or create a new chat.
                    </p>
                  )}
                </div>
              </section>

              <section className="panel chat-panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Thread</p>
                    <h2>{selectedConversation?.title || "New chat"}</h2>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => handleExportConversation("json")}
                      disabled={!selectedConversation?.id || exportBusy !== ""}
                    >
                      {exportBusy === "json" ? "Exporting..." : "Export JSON"}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => handleExportConversation("markdown")}
                      disabled={!selectedConversation?.id || exportBusy !== ""}
                    >
                      {exportBusy === "markdown" ? "Exporting..." : "Export Markdown"}
                    </button>
                  </div>
                </div>

                {chatError ? <p className="error-banner">{chatError}</p> : null}

                <div className="message-stage">
                  {displayedMessages.map((message) => (
                    <article
                      key={`${selectedConversation?.id || "starter"}-${message.id}`}
                      className={`message-card ${message.role}`}
                    >
                      <div className="message-meta">
                        <span className="message-role">{message.role}</span>
                        <span className="message-time">{formatTime(message.createdAt)}</span>
                      </div>
                      <div className="message-copy">
                        <p>{message.content}</p>
                      </div>
                      {message.role === "assistant" && message.neuralRecord
                        ? renderNeuralRecord(message.neuralRecord)
                        : null}
                    </article>
                  ))}
                </div>

                <form className="composer" onSubmit={handleSendMessage}>
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
                    <button className="primary-button" type="submit" disabled={chatBusy}>
                      {chatBusy ? "Sending..." : "Send"}
                    </button>
                  </div>
                </form>
              </section>
            </div>

            <div className="split chat-meta-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Character</p>
                    <h2>Active role snapshot</h2>
                  </div>
                </div>
                <div className="stack-list">
                  <article className="list-card">
                    <strong>{selectedCharacter.definition.name}</strong>
                    <p>{selectedCharacter.definition.oneLiner}</p>
                  </article>
                  <article className="list-card">
                    <strong>Bundle summary</strong>
                    <p>{selectedCharacter.blueprint.summary}</p>
                  </article>
                  <article className="list-card">
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
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Durable Memory</p>
                    <h2>Local memory store</h2>
                  </div>
                </div>
                {memories.length ? (
                  <div className="stack-list">
                    {[...memories].reverse().map((memory: NeuralMemoryRecord) => (
                      <article key={memory.id} className="list-card">
                        <strong>{memory.sourceRoute || "memory"}</strong>
                        <p>{memory.content}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">
                    Stable preferences and repeated signals will accumulate here over time.
                  </p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </>
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
            Runtime configuration lives here now, separate from role creation and chat. API keys
            remain write-only.
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
              <aside className="settings-provider-nav">
                {providerCatalog.map((item) => (
                  <button
                    key={item.id}
                    className={`settings-provider-button ${
                      providerSettings.providerMode === item.id ? "active" : ""
                    }`}
                    type="button"
                    onClick={() => updateProviderMode(item.id)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </button>
                ))}
              </aside>

              <div className="settings-provider-form">
                <div className="settings-provider-summary">
                  <p className="eyebrow">Selected provider</p>
                  <h3>{activeProviderPreset.label}</h3>
                  <p className="small-note">{activeProviderPreset.description}</p>
                </div>

                <div className="form-stack">
                  {providerSettings.providerMode !== "ollama" ? (
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
              </div>
            </div>

            <div className="actions">
              <button
                className="primary-button wide"
                type="button"
                onClick={handleSaveProviderSettings}
                disabled={settingsBusy}
              >
                {settingsBusy ? "Saving..." : "Save runtime"}
              </button>
            </div>

            <p className="small-note">
              Leave the API key blank to keep the stored key for the current provider.
            </p>
            {settingsError ? <p className="error-banner">{settingsError}</p> : null}
            {settingsSaved ? <p className="success-banner">{settingsSaved}</p> : null}
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
              className={`nav-button ${appSection === "chat" ? "active" : ""}`}
              type="button"
              onClick={() => setAppSection("chat")}
              disabled={!selectedCharacter}
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
        {appSection === "chat" ? renderChatWorkspace() : null}
        {appSection === "settings" ? renderSettingsWorkspace() : null}
      </main>
    </div>
  );
}
