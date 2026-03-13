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
  type NeuralRecord,
  providerCatalog,
  type ProviderMode,
  type ProviderSettings,
  type RoleBlueprint,
  type RoleDefinitionInput,
} from "./types";

type ChatPayload = {
  character: CharacterRecord;
  conversation: ConversationRecord;
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

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
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
    return "--:--";
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
    return "Post the full neural payload to an external URL.";
  }
  if (channel === "slack") {
    return "Send a route summary into a Slack channel via bot token.";
  }
  return "Send a route summary into a Telegram chat via bot token.";
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
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [definition, setDefinition] = useState<RoleDefinitionInput>(emptyRoleDefinition);
  const [blueprintPreview, setBlueprintPreview] = useState<RoleBlueprint | null>(null);
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [chatText, setChatText] = useState("");
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
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
  const displayedBlueprint = blueprintPreview || selectedCharacter?.blueprint || null;
  const currentMessages = conversation?.messages || [];
  const latestAssistantRecord = useMemo(() => {
    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      const message = currentMessages[index];
      if (message.role === "assistant" && message.neuralRecord) {
        return message.neuralRecord;
      }
    }
    return null;
  }, [currentMessages]);
  const assistantTimeline = useMemo(
    () =>
      currentMessages
        .filter(
          (
            message,
          ): message is ChatMessage & { role: "assistant"; neuralRecord: NeuralRecord } =>
            message.role === "assistant" && Boolean(message.neuralRecord),
        )
        .slice()
        .reverse(),
    [currentMessages],
  );
  const activeProviderPreset = getProviderCatalogItem(providerSettings.providerMode);
  const outboundDeploymentByChannel = useMemo<Record<DeploymentChannel, DeploymentRecord | null>>(
    () => ({
      webhook: deployments.find((item) => item.channel === "webhook") || null,
      slack: deployments.find((item) => item.channel === "slack") || null,
      telegram: deployments.find((item) => item.channel === "telegram") || null,
    }),
    [deployments],
  );
  const activeOutboundDeployment = outboundDeploymentByChannel[activeOutboundChannel];

  useEffect(() => {
    void loadCharacters();
    void loadProviderSettings();
  }, []);

  useEffect(() => {
    if (!selectedCharacter) {
      setConversation(null);
      setDeployments([]);
      setActiveOutboundChannel("webhook");
      setSlackDraft(emptySlackDraft());
      setTelegramDraft(emptyTelegramDraft());
      setWebhookDraft(emptyWebhookDraft());
      return;
    }
    setDefinition(selectedCharacter.definition);
    setBlueprintPreview(selectedCharacter.blueprint);
    void loadConversation(selectedCharacter.id);
    void loadDeployments(selectedCharacter.id);
  }, [selectedCharacter]);

  async function loadCharacters() {
    const payload = await requestJson<{ characters: CharacterRecord[] }>("/api/characters");
    setCharacters(payload.characters);
    if (!selectedCharacterId && payload.characters[0]) {
      setSelectedCharacterId(payload.characters[0].id);
    }
  }

  async function loadProviderSettings() {
    const payload = await requestJson<{ provider: ProviderSettings }>("/api/settings/provider");
    setProviderSettings(payload.provider);
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

  async function loadConversation(characterId: string) {
    const payload = await requestJson<{ conversation: ConversationRecord | null }>(
      `/api/conversations?characterId=${encodeURIComponent(characterId)}`,
    );
    if (payload.conversation) {
      setConversation(payload.conversation);
      return;
    }
    const character = characters.find((item) => item.id === characterId) || selectedCharacter;
    setConversation({
      id: "",
      characterId,
      title: "New neural chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: starterConversation(character),
    });
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

  function startNewCharacter() {
    setSelectedCharacterId("");
    setDefinition(emptyRoleDefinition());
    setBlueprintPreview(null);
    setConversation(null);
    setStudioError("");
  }

  function updateField<Key extends keyof RoleDefinitionInput>(
    key: Key,
    value: RoleDefinitionInput[Key],
  ) {
    setDefinition((current) => ({ ...current, [key]: value }));
  }

  async function handleGenerateBlueprint(event: FormEvent) {
    event.preventDefault();
    setStudioBusy(true);
    setStudioError("");
    try {
      const payload = await requestJson<{ blueprint: RoleBlueprint }>(
        "/api/characters/generate",
        {
          method: "POST",
          body: JSON.stringify({ definition }),
        },
      );
      setBlueprintPreview(payload.blueprint);
    } catch (error: any) {
      setStudioError(String(error?.message || error));
    } finally {
      setStudioBusy(false);
    }
  }

  async function handleSaveCharacter() {
    setStudioBusy(true);
    setStudioError("");
    try {
      const payload = await requestJson<{ character: CharacterRecord }>(
        "/api/characters",
        {
          method: selectedCharacter ? "PUT" : "POST",
          body: JSON.stringify({
            id: selectedCharacter?.id,
            definition,
            blueprint: blueprintPreview,
          }),
        },
      );
      patchCharacter(payload.character);
      setSelectedCharacterId(payload.character.id);
      setBlueprintPreview(payload.character.blueprint);
    } catch (error: any) {
      setStudioError(String(error?.message || error));
    } finally {
      setStudioBusy(false);
    }
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedCharacter || !chatText.trim()) return;

    setChatBusy(true);
    const userContent = chatText.trim();
    setChatText("");
    setConversation((current) => {
      const base = current || {
        id: "",
        characterId: selectedCharacter.id,
        title: "New neural chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: starterConversation(selectedCharacter),
      };
      return {
        ...base,
        messages: [
          ...base.messages,
          {
            id: `user-${Date.now()}`,
            role: "user",
            content: userContent,
            createdAt: Date.now(),
          },
        ],
      };
    });

    try {
      const payload = await requestJson<ChatPayload>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          characterId: selectedCharacter.id,
          conversationId: conversation?.id || undefined,
          message: userContent,
        }),
      });
      patchCharacter(payload.character);
      setConversation(payload.conversation);
      setBlueprintPreview(payload.character.blueprint);
    } catch (error: any) {
      setConversation((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: `assistant-error-${Date.now()}`,
                  role: "assistant",
                  content: `Neural chat failed: ${String(error?.message || error)}`,
                  createdAt: Date.now(),
                },
              ],
            }
          : current,
      );
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
      setSettingsSaved("Provider settings saved.");
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
        body: JSON.stringify({
          deployment,
        }),
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
    const deployment = outboundDeploymentByChannel[channel];
    if (!deployment?.id) {
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
          conversationId: conversation?.id || undefined,
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
    if (!conversation?.id) return;
    setExportBusy(format);
    setIntegrationError("");
    setIntegrationSaved("");
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversation.id)}/export?format=${encodeURIComponent(format)}`,
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          String(payload?.message || payload?.error || `Export failed: ${response.status}`),
        );
      }

      const baseName = `${selectedCharacter?.slug || "liberth-neural"}-${conversation.id}`;
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
          <span className="metric-chip">
            margin {formatPercent(record.routeInspector.margin)}
          </span>
        </div>

        <details className="neural-details">
          <summary>查看神经日志</summary>
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
                <p className="small-note">本轮没有写入长期记忆候选。</p>
              )}
            </article>

            <article className="neural-block">
              <strong>Alternative routes</strong>
              <ul>
                {record.routeInspector.alternatives.map((item) => (
                  <li key={item.route}>
                    {item.route}: {formatPercent(item.weight)} / gap {formatPercent(item.gap)}
                  </li>
                ))}
              </ul>
            </article>

            <article className="neural-block">
              <strong>Top neurons</strong>
              <div className="tag-row">
                {record.topNeurons.map((item) => (
                  <span key={item.neuronId} className="tag">
                    {item.neuronId}
                  </span>
                ))}
              </div>
            </article>
          </div>
        </details>
      </section>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">liberth-neural</p>
          <h1>Neural character dialogue</h1>
          <p className="muted">
            独立的神经元角色工作台。角色由 blueprint、neural graph、长期记忆和每轮
            neural log 共同驱动。
          </p>
        </div>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Provider</p>
              <h2>Runtime API matrix</h2>
            </div>
          </div>

          <div className="provider-grid">
            {providerCatalog.map((item) => (
              <button
                key={item.id}
                className={`provider-card ${
                  providerSettings.providerMode === item.id ? "active" : ""
                }`}
                type="button"
                onClick={() => updateProviderMode(item.id)}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>

          <div className="form-stack">
            <label>
              <span>Mode</span>
              <select
                value={providerSettings.providerMode}
                onChange={(event) => updateProviderMode(event.target.value as ProviderMode)}
              >
                {providerCatalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

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
                  <span>API key</span>
                  <input
                    type="password"
                    placeholder={activeProviderPreset.apiKeyPlaceholder}
                    value={providerSettings.apiKey}
                    onChange={(event) => updateProviderField("apiKey", event.target.value)}
                  />
                </label>
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
              {settingsBusy ? "Saving..." : "Save runtime"}
            </button>
          </div>
          <p className="small-note">
            当前预设支持 GLM、OpenAI Compatible、OpenRouter、DeepSeek、SiliconFlow、
            Groq、Ollama、Anthropic、Google Gemini。
          </p>
          {settingsError ? <p className="error-banner">{settingsError}</p> : null}
          {settingsSaved ? <p className="success-banner">{settingsSaved}</p> : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Characters</p>
              <h2>Neural roster</h2>
            </div>
            <button className="ghost-button" type="button" onClick={startNewCharacter}>
              New
            </button>
          </div>

          <div className="character-list">
            {characters.length === 0 ? (
              <p className="empty-state">还没有角色。先在右侧工作台生成一个 neural character。</p>
            ) : null}

            {characters.map((character) => (
              <button
                key={character.id}
                className={`character-card ${
                  character.id === selectedCharacterId ? "active" : ""
                }`}
                type="button"
                onClick={() => setSelectedCharacterId(character.id)}
              >
                <strong>{character.definition.name}</strong>
                <span>{character.definition.oneLiner}</span>
                <div className="tag-row">
                  {(character.blueprint.tags || []).slice(0, 4).map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </section>

        <div className="legal-notice">
          <p>
            现在每条 assistant 回复都会附带 turn-level neural record，而不只是更新
            右侧的全局最新状态。
          </p>
        </div>
      </aside>

      <main className="workspace">
        <section className="panel hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Conversation cockpit</p>
            <h2>{selectedCharacter?.definition.name || "Neural character studio"}</h2>
            <p className="muted">
              {selectedCharacter?.definition.oneLiner ||
                "从角色定义生成 blueprint、神经图谱、系统提示词和带日志的对话回放。"}
            </p>
          </div>

          <div className="hero-metrics">
            <article className="hero-metric">
              <span>Provider</span>
              <strong>{activeProviderPreset.label}</strong>
              <p>{providerSettings.providerMode === "glm-main" ? providerSettings.glmModel : providerSettings.model || activeProviderPreset.defaultModel}</p>
            </article>
            <article className="hero-metric">
              <span>Dominant route</span>
              <strong>{latestAssistantRecord?.dominantRoute || selectedCharacter?.lastNeuralState?.dominantRoute || "waiting"}</strong>
              <p>{latestAssistantRecord?.broadcastSummary || selectedCharacter?.lastNeuralState?.summary || "发送第一条消息后开始激活。"}</p>
            </article>
            <article className="hero-metric">
              <span>Memory mode</span>
              <strong>
                {latestAssistantRecord?.memoryDirective.writeGlobalMemory ? "writeback" : "thread"}
              </strong>
              <p>
                {latestAssistantRecord?.memoryDirective.reason ||
                  "稳定偏好和高强度线索才会进入长期记忆。"}
              </p>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Studio</p>
              <h2>Neural character builder</h2>
            </div>
            {displayedBlueprint?.generation ? (
              <span className="tag">
                {displayedBlueprint.generation.mode} / {displayedBlueprint.generation.model}
              </span>
            ) : null}
          </div>

          <form className="studio-grid" onSubmit={handleGenerateBlueprint}>
            <label>
              <span>Name</span>
              <input
                value={definition.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="例如：午夜策略师 / Archive Oracle"
              />
            </label>
            <label>
              <span>One-liner</span>
              <input
                value={definition.oneLiner}
                onChange={(event) => updateField("oneLiner", event.target.value)}
                placeholder="一句话角色定位"
              />
            </label>
            <label>
              <span>Domain</span>
              <input
                value={definition.domain}
                onChange={(event) => updateField("domain", event.target.value)}
                placeholder="领域、场景、长期主题"
              />
            </label>
            <label>
              <span>Audience</span>
              <input
                value={definition.audience}
                onChange={(event) => updateField("audience", event.target.value)}
                placeholder="这个角色主要为谁服务"
              />
            </label>
            <label>
              <span>Tone</span>
              <input
                value={definition.tone}
                onChange={(event) => updateField("tone", event.target.value)}
                placeholder="例如：冷静、锋利、像总编辑"
              />
            </label>
            <label>
              <span>Language</span>
              <select
                value={definition.language}
                onChange={(event) => updateField("language", event.target.value)}
              >
                <option value="Chinese">Chinese</option>
                <option value="English">English</option>
              </select>
            </label>
            <label className="full">
              <span>Personality</span>
              <textarea
                value={definition.personality}
                onChange={(event) => updateField("personality", event.target.value)}
                placeholder="把角色的语气、判断方式、脾气、节奏写清楚。"
              />
            </label>
            <label className="full">
              <span>Goals</span>
              <textarea
                value={definition.goals}
                onChange={(event) => updateField("goals", event.target.value)}
                placeholder="角色的核心目标、承诺、价值观。"
              />
            </label>
            <label className="full">
              <span>Boundaries</span>
              <textarea
                value={definition.boundaries}
                onChange={(event) => updateField("boundaries", event.target.value)}
                placeholder="明确禁区、不能做什么、什么时候必须谨慎。"
              />
            </label>
            <label className="full">
              <span>Knowledge</span>
              <textarea
                value={definition.knowledge}
                onChange={(event) => updateField("knowledge", event.target.value)}
                placeholder="补充知识包、背景事实、口头禅、上下文素材。"
              />
            </label>
            <label className="full">
              <span>Greeting</span>
              <textarea
                value={definition.greeting}
                onChange={(event) => updateField("greeting", event.target.value)}
                placeholder="首条开场白。留空则由 neural blueprint 自动生成。"
              />
            </label>
            <div className="full actions">
              <button className="secondary-button" type="submit" disabled={studioBusy}>
                {studioBusy ? "Generating..." : "Generate blueprint"}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={handleSaveCharacter}
                disabled={studioBusy}
              >
                {studioBusy ? "Saving..." : selectedCharacter ? "Update character" : "Save character"}
              </button>
            </div>
          </form>

          {studioError ? <p className="error-banner">{studioError}</p> : null}
        </section>

        <section className="preview-grid">
          <article className="preview-card">
            <p className="eyebrow">Identity</p>
            <h3>{displayedBlueprint?.profile?.identity.publicIntro || "等待生成角色"}</h3>
            <p>
              {displayedBlueprint?.summary ||
                "生成后这里会显示角色摘要、人格连续性与核心定位。"}
            </p>
            <div className="tag-row">
              {(displayedBlueprint?.profile?.identity.signatureTraits || []).slice(0, 6).map((item) => (
                <span key={item} className="tag">
                  {item}
                </span>
              ))}
            </div>
          </article>

          <article className="preview-card">
            <p className="eyebrow">Neural graph</p>
            {displayedBlueprint?.neuralGraph ? (
              <>
                <ul>
                  <li>actor: {displayedBlueprint.neuralGraph.manifest.actorType}</li>
                  <li>regions: {displayedBlueprint.neuralGraph.regions.length}</li>
                  <li>neurons: {displayedBlueprint.neuralGraph.neurons.length}</li>
                  <li>synapses: {displayedBlueprint.neuralGraph.synapses.length}</li>
                  <li>circuits: {displayedBlueprint.neuralGraph.circuits.length}</li>
                </ul>
                <div className="tag-row">
                  {displayedBlueprint.neuralGraph.circuits.slice(0, 5).map((circuit) => (
                    <span key={circuit.id} className="tag">
                      {circuit.route}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p>生成后这里会显示 clone 风格 neural topology。</p>
            )}
          </article>

          <article className="preview-card">
            <p className="eyebrow">Starter prompts</p>
            {displayedBlueprint?.starterQuestions?.length ? (
              <ul>
                {displayedBlueprint.starterQuestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>生成 blueprint 后，这里会出现可直接喂给角色的第一批刺激问题。</p>
            )}
          </article>
        </section>

        <section className="conversation-grid">
          <div className="panel chat-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Chat</p>
                <h2>Neural conversation</h2>
              </div>
              {selectedCharacter ? <span className="tag">{selectedCharacter.definition.name}</span> : null}
            </div>

            <div className="message-list message-stage">
              {currentMessages.map((message) => (
                <article key={message.id} className={`message-card ${message.role}`}>
                  <header className="message-meta">
                    <span className="message-role">{message.role}</span>
                    <span className="message-time">{formatTime(message.createdAt)}</span>
                  </header>
                  <div className="message-copy">
                    <p>{message.content}</p>
                  </div>
                  {message.role === "assistant" && message.neuralRecord
                    ? renderNeuralRecord(message.neuralRecord)
                    : null}
                </article>
              ))}
              {!selectedCharacter ? (
                <p className="empty-state">先保存一个角色，聊天区才会开始接收神经元刺激。</p>
              ) : null}
            </div>

            <form className="composer" onSubmit={handleSendMessage}>
              <textarea
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder="向角色发送一条消息，观察每轮 neural route、memory writeback 和神经日志。"
              />
              <div className="actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!selectedCharacter || chatBusy}
                >
                  {chatBusy ? "Thinking..." : "Send stimulus"}
                </button>
              </div>
            </form>
          </div>

          <div className="panel telemetry-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Turn cockpit</p>
                <h2>Latest neural state</h2>
              </div>
            </div>

            {selectedCharacter?.lastNeuralState ? (
              <div className="stack-list">
                <article className="list-card">
                  <strong>Dominant route</strong>
                  <div className="tag-row">
                    <span className={routePillClass(selectedCharacter.lastNeuralState.dominantRoute)}>
                      {selectedCharacter.lastNeuralState.dominantRoute}
                    </span>
                    <span className="metric-chip">
                      margin {formatPercent(selectedCharacter.lastNeuralState.routeInspector.margin)}
                    </span>
                  </div>
                  <p>{selectedCharacter.lastNeuralState.broadcastSummary}</p>
                </article>

                <article className="list-card">
                  <strong>Modulators</strong>
                  <div className="tag-row">
                    <span className="metric-chip">
                      focus {formatPercent(selectedCharacter.lastNeuralState.modulators.focus)}
                    </span>
                    <span className="metric-chip">
                      novelty {formatPercent(selectedCharacter.lastNeuralState.modulators.novelty)}
                    </span>
                    <span className="metric-chip">
                      sociality {formatPercent(selectedCharacter.lastNeuralState.modulators.sociality)}
                    </span>
                    <span className="metric-chip">
                      caution {formatPercent(selectedCharacter.lastNeuralState.modulators.caution)}
                    </span>
                    <span className="metric-chip">
                      confidence {formatPercent(selectedCharacter.lastNeuralState.modulators.confidence)}
                    </span>
                  </div>
                </article>

                <article className="list-card">
                  <strong>Route inspector</strong>
                  <ul>
                    {selectedCharacter.lastNeuralState.routeInspector.because.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>

                <article className="list-card">
                  <strong>Workspace contents</strong>
                  <div className="tag-row">
                    {selectedCharacter.lastNeuralState.workspaceContents.map((item) => (
                      <span key={item.id} className="tag">
                        {item.label}
                      </span>
                    ))}
                  </div>
                </article>

                {latestAssistantRecord?.memoryDirective.durableMemoryCandidate ? (
                  <article className="list-card">
                    <strong>Durable candidate</strong>
                    <pre className="mono compact-pre">
                      {latestAssistantRecord.memoryDirective.durableMemoryCandidate}
                    </pre>
                  </article>
                ) : null}
              </div>
            ) : (
              <p className="empty-state">还没有运行时 neural state。发送第一条消息后这里会开始变化。</p>
            )}
          </div>
        </section>

        <section className="panel timeline-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Timeline</p>
              <h2>Neural log timeline</h2>
            </div>
            <span className="tag">{assistantTimeline.length} turns</span>
          </div>

          {assistantTimeline.length ? (
            <div className="timeline-list">
              {assistantTimeline.map((message) => (
                <article key={message.id} className="timeline-item">
                  <div className="timeline-rail">
                    <span className="timeline-dot" />
                  </div>

                  <div className="timeline-card">
                    <header className="timeline-head">
                      <div className="timeline-title">
                        <span className={routePillClass(message.neuralRecord.dominantRoute)}>
                          {message.neuralRecord.dominantRoute}
                        </span>
                        <span className="timeline-stamp">{formatTime(message.createdAt)}</span>
                        <span className="meta-pill">{message.neuralRecord.provider.providerMode}</span>
                        <span className="meta-pill">{message.neuralRecord.provider.model}</span>
                      </div>
                      <span
                        className={`meta-pill ${
                          message.neuralRecord.memoryDirective.writeGlobalMemory
                            ? "meta-pill-hot"
                            : ""
                        }`}
                      >
                        {message.neuralRecord.memoryDirective.writeGlobalMemory
                          ? "writeback"
                          : "thread"}
                      </span>
                    </header>

                    <p className="timeline-summary">
                      {message.neuralRecord.broadcastSummary || message.neuralRecord.turnSummary}
                    </p>

                    <div className="timeline-columns">
                      <article className="timeline-block">
                        <strong>Why</strong>
                        <ul>
                          {message.neuralRecord.routeInspector.because.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </article>

                      <article className="timeline-block">
                        <strong>Workspace</strong>
                        <div className="tag-row">
                          {message.neuralRecord.workspaceContents.map((item) => (
                            <span key={item.id} className="tag">
                              {item.label}
                            </span>
                          ))}
                        </div>
                      </article>

                      <article className="timeline-block">
                        <strong>Top neurons</strong>
                        <div className="tag-row">
                          {message.neuralRecord.topNeurons.map((item) => (
                            <span key={item.neuronId} className="tag">
                              {item.neuronId}
                            </span>
                          ))}
                        </div>
                      </article>

                      <article className="timeline-block">
                        <strong>Reply excerpt</strong>
                        <p>{message.content}</p>
                      </article>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">还没有 assistant neural turn。开始对话后这里会累积时间线日志。</p>
          )}
        </section>

        <section className="split">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Memory</p>
                <h2>Durable neural memory</h2>
              </div>
            </div>
            {selectedCharacter?.globalMemories?.length ? (
              <div className="stack-list">
                {selectedCharacter.globalMemories.map((memory) => (
                  <article key={memory.id} className="list-card">
                    <strong>{memory.sourceRoute || "global"}</strong>
                    <p>{memory.content}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">还没有写入长期记忆。只有稳定偏好或重复信号才会进入这里。</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Bundle</p>
                <h2>Clone-style prompt bundle</h2>
              </div>
            </div>
            {displayedBlueprint ? (
              <div className="stack-list">
                <article className="list-card">
                  <strong>Files</strong>
                  <div className="tag-row">
                    {Object.keys(displayedBlueprint.bundleFiles || {}).slice(0, 12).map((file) => (
                      <span key={file} className="tag">
                        {file}
                      </span>
                    ))}
                  </div>
                </article>
                <article className="list-card">
                  <strong>NEURAL.md</strong>
                  <pre className="mono compact-pre">{displayedBlueprint.neuralDoc || "No neural doc."}</pre>
                </article>
              </div>
            ) : (
              <p className="empty-state">生成 blueprint 后，这里会展示编译出的 prompt bundle 与神经元语料。</p>
            )}
          </div>
        </section>

        <section className="split integration-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Outbound</p>
                <h2>Outbound routes</h2>
              </div>
              <span className="tag">{deployments.length} configured</span>
            </div>

            {selectedCharacter ? (
              <>
                <div className="provider-grid">
                  {(["webhook", "slack", "telegram"] as DeploymentChannel[]).map((channel) => {
                    const deployment = outboundDeploymentByChannel[channel];
                    return (
                      <button
                        key={channel}
                        type="button"
                        className={`provider-card ${activeOutboundChannel === channel ? "active" : ""}`}
                        onClick={() => setActiveOutboundChannel(channel)}
                      >
                        <strong>{formatChannelName(channel)}</strong>
                        <span>{describeChannel(channel)}</span>
                        <span>{deployment ? describeDeploymentTarget(deployment) : "Not configured"}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="small-note">
                  {activeOutboundChannel === "webhook"
                    ? "Webhook sends the full JSON payload for the current conversation state."
                    : activeOutboundChannel === "slack"
                    ? "Slack sends a compact neural summary by using chat.postMessage."
                    : "Telegram sends a compact neural summary by using Bot API sendMessage."}
                </p>

                <div className="form-stack">
                  {activeOutboundChannel === "webhook" ? (
                    <>
                      <label>
                        <span>Outbound URL</span>
                        <input
                          value={webhookDraft.outboundUrl}
                          onChange={(event) =>
                            updateWebhookDraft("outboundUrl", event.target.value)}
                          placeholder="https://example.com/liberth-neural-webhook"
                        />
                      </label>
                      <label>
                        <span>Authorization header</span>
                        <input
                          type="password"
                          value={webhookDraft.outboundAuthHeader}
                          onChange={(event) =>
                            updateWebhookDraft("outboundAuthHeader", event.target.value)}
                          placeholder="Bearer ..."
                        />
                      </label>
                      <label>
                        <span>Status</span>
                        <select
                          value={webhookDraft.enabled ? "enabled" : "disabled"}
                          onChange={(event) =>
                            updateWebhookDraft("enabled", event.target.value === "enabled")}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
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
                          placeholder="xoxb-..."
                        />
                      </label>
                      <label>
                        <span>Channel ID</span>
                        <input
                          value={slackDraft.channelId}
                          onChange={(event) => updateSlackDraft("channelId", event.target.value)}
                          placeholder="C0123456789"
                        />
                      </label>
                      <label>
                        <span>Signing secret</span>
                        <input
                          type="password"
                          value={slackDraft.signingSecret}
                          onChange={(event) =>
                            updateSlackDraft("signingSecret", event.target.value)}
                          placeholder="Optional for outbound-only use"
                        />
                      </label>
                      <label>
                        <span>Status</span>
                        <select
                          value={slackDraft.enabled ? "enabled" : "disabled"}
                          onChange={(event) =>
                            updateSlackDraft("enabled", event.target.value === "enabled")}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
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
                          onChange={(event) =>
                            updateTelegramDraft("botToken", event.target.value)}
                          placeholder="123456:ABCDEF..."
                        />
                      </label>
                      <label>
                        <span>Chat ID</span>
                        <input
                          value={telegramDraft.chatId}
                          onChange={(event) => updateTelegramDraft("chatId", event.target.value)}
                          placeholder="-1001234567890"
                        />
                      </label>
                      <label>
                        <span>Secret token</span>
                        <input
                          type="password"
                          value={telegramDraft.secretToken}
                          onChange={(event) =>
                            updateTelegramDraft("secretToken", event.target.value)}
                          placeholder="Optional secret token"
                        />
                      </label>
                      <label>
                        <span>Status</span>
                        <select
                          value={telegramDraft.enabled ? "enabled" : "disabled"}
                          onChange={(event) =>
                            updateTelegramDraft("enabled", event.target.value === "enabled")}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                </div>

                <div className="actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={integrationBusy}
                    onClick={() => handleSaveDeployment(activeOutboundChannel)}
                  >
                    {integrationBusy ? "Saving..." : `Save ${formatChannelName(activeOutboundChannel)}`}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={integrationBusy || !activeOutboundDeployment}
                    onClick={() => handleSendDeploymentTest(activeOutboundChannel)}
                  >
                    Send {formatChannelName(activeOutboundChannel)} test
                  </button>
                </div>

                {deployments.length ? (
                  <div className="stack-list deployment-list">
                    {deployments.map((deployment) => (
                      <article key={deployment.id} className="list-card">
                        <strong>{formatChannelName(deployment.channel)}</strong>
                        <p>{describeDeploymentTarget(deployment)}</p>
                        <div className="tag-row">
                          <span className="tag">{deployment.enabled ? "enabled" : "disabled"}</span>
                          <span className="tag">{deployment.platformKey}</span>
                          <span className="tag">{deployment.id}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="empty-state">先选择或创建一个角色，才能配置外部出口。</p>
            )}

            {integrationError ? <p className="error-banner">{integrationError}</p> : null}
            {integrationSaved ? <p className="success-banner">{integrationSaved}</p> : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Export</p>
                <h2>Conversation export</h2>
              </div>
            </div>

            {conversation?.id ? (
              <>
                <p className="muted">
                  导出当前会话，保留 assistant 回复里的 `generation` 和 `neuralRecord`。
                  现在支持 JSON 和 Markdown 两种格式。
                </p>
                <div className="actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={Boolean(exportBusy)}
                    onClick={() => handleExportConversation("json")}
                  >
                    {exportBusy === "json" ? "Exporting..." : "Export JSON"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={Boolean(exportBusy)}
                    onClick={() => handleExportConversation("markdown")}
                  >
                    {exportBusy === "markdown" ? "Exporting..." : "Export Markdown"}
                  </button>
                </div>

                <div className="stack-list">
                  <article className="list-card">
                    <strong>Current conversation</strong>
                    <p>{conversation.title}</p>
                    <div className="tag-row">
                      <span className="tag">{conversation.id}</span>
                      <span className="tag">{currentMessages.length} messages</span>
                      <span className="tag">{assistantTimeline.length} neural turns</span>
                    </div>
                  </article>
                </div>
              </>
            ) : (
              <p className="empty-state">当前没有会话，导出接口还没有内容可以打包。</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
