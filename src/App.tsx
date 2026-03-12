import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CharacterRecord,
  ConversationRecord,
  ProviderMode,
  ProviderSettings,
  RoleBlueprint,
  RoleDefinitionInput,
  emptyRoleDefinition,
} from "./types";

type ChatPayload = {
  character: CharacterRecord;
  conversation: ConversationRecord;
};

const emptyProviderSettings = (): ProviderSettings => ({
  providerMode: "glm-main",
  glmModel: "glm-4-flash-250414",
  openaiApiKey: "",
  openaiBaseUrl: "",
  openaiModel: "",
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

function starterConversation(character?: CharacterRecord | null) {
  if (!character) return [];
  return [
    {
      id: "bootstrap",
      role: "assistant" as const,
      content: character.blueprint.greeting,
      createdAt: Date.now(),
    },
  ];
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

  const selectedCharacter = useMemo(
    () => characters.find((item) => item.id === selectedCharacterId) || null,
    [characters, selectedCharacterId],
  );
  const displayedBlueprint = blueprintPreview || selectedCharacter?.blueprint || null;

  useEffect(() => {
    void loadCharacters();
    void loadProviderSettings();
  }, []);

  useEffect(() => {
    if (!selectedCharacter) {
      setConversation(null);
      return;
    }
    setDefinition(selectedCharacter.definition);
    setBlueprintPreview(selectedCharacter.blueprint);
    void loadConversation(selectedCharacter.id);
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
    setProviderSettings((current) => ({ ...current, providerMode: value }));
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">liberth-neural</p>
          <h1>Neural character dialogue</h1>
          <p className="muted">
            只保留神经元角色生成与对话。角色 blueprint 走 clone 同款 persona-engine，
            每轮消息都会重新激活 neural state。
          </p>
        </div>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Provider</p>
              <h2>LLM runtime</h2>
            </div>
          </div>
          <div className="form-stack">
            <label>
              <span>Mode</span>
              <select
                value={providerSettings.providerMode}
                onChange={(event) => updateProviderMode(event.target.value as ProviderMode)}
              >
                <option value="glm-main">GLM main</option>
                <option value="openai-compatible">OpenAI compatible</option>
              </select>
            </label>
            <label>
              <span>GLM model</span>
              <input
                value={providerSettings.glmModel}
                onChange={(event) => updateProviderField("glmModel", event.target.value)}
              />
            </label>
            {providerSettings.providerMode === "openai-compatible" ? (
              <>
                <label>
                  <span>API key</span>
                  <input
                    type="password"
                    value={providerSettings.openaiApiKey}
                    onChange={(event) => updateProviderField("openaiApiKey", event.target.value)}
                  />
                </label>
                <label>
                  <span>Base URL</span>
                  <input
                    value={providerSettings.openaiBaseUrl}
                    onChange={(event) => updateProviderField("openaiBaseUrl", event.target.value)}
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    value={providerSettings.openaiModel}
                    onChange={(event) => updateProviderField("openaiModel", event.target.value)}
                  />
                </label>
              </>
            ) : null}
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
                  {(character.blueprint.tags || []).slice(0, 3).map((tag) => (
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
            当前产品定位已经收窄为 neural-only: 角色生成、神经元状态推导、长期记忆与多轮对话。
          </p>
        </div>
      </aside>

      <main className="workspace">
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
              {displayedBlueprint?.summary
                || "生成后这里会显示角色摘要、人格连续性与核心定位。"}
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
                  {displayedBlueprint.neuralGraph.circuits.slice(0, 4).map((circuit) => (
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
            <p className="eyebrow">Profile</p>
            {displayedBlueprint?.profile ? (
              <>
                <ul>
                  <li>language: {displayedBlueprint.profile.languageHint}</li>
                  <li>domains: {displayedBlueprint.profile.expertise.domains.join(" / ") || "n/a"}</li>
                  <li>topics: {displayedBlueprint.profile.expertise.topics.slice(0, 4).join(" / ") || "n/a"}</li>
                </ul>
                <div className="tag-row">
                  {(displayedBlueprint.profile.visual.tags || []).slice(0, 5).map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p>生成后这里会显示 persona-engine 提取出的风格、领域与视觉信号。</p>
            )}
          </article>
        </section>

        <section className="split">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Chat</p>
                <h2>Neural conversation</h2>
              </div>
              {selectedCharacter ? (
                <span className="tag">{selectedCharacter.definition.name}</span>
              ) : null}
            </div>
            <div className="message-list">
              {(conversation?.messages || []).map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span>{message.role}</span>
                  <p>{message.content}</p>
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
                placeholder="向角色发送一条消息，观察 neural state 如何变化。"
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

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Telemetry</p>
                <h2>Latest neural state</h2>
              </div>
            </div>
            {selectedCharacter?.lastNeuralState ? (
              <div className="stack-list">
                <article className="list-card">
                  <strong>Dominant route</strong>
                  <p>{selectedCharacter.lastNeuralState.dominantRoute}</p>
                  <p className="small-note">{selectedCharacter.lastNeuralState.summary}</p>
                </article>
                <article className="list-card">
                  <strong>Modulators</strong>
                  <div className="tag-row">
                    <span className="tag">focus {selectedCharacter.lastNeuralState.modulators.focus}</span>
                    <span className="tag">novelty {selectedCharacter.lastNeuralState.modulators.novelty}</span>
                    <span className="tag">sociality {selectedCharacter.lastNeuralState.modulators.sociality}</span>
                    <span className="tag">caution {selectedCharacter.lastNeuralState.modulators.caution}</span>
                    <span className="tag">confidence {selectedCharacter.lastNeuralState.modulators.confidence}</span>
                  </div>
                </article>
                <article className="list-card">
                  <strong>Top neurons</strong>
                  <ul>
                    {selectedCharacter.lastNeuralState.topNeurons.slice(0, 5).map((item) => (
                      <li key={item.neuronId}>
                        {item.neuronId} / {item.activation}
                      </li>
                    ))}
                  </ul>
                </article>
                <article className="list-card">
                  <strong>Route inspector</strong>
                  <p>
                    dominant {selectedCharacter.lastNeuralState.routeInspector.dominantRoute} / margin{" "}
                    {selectedCharacter.lastNeuralState.routeInspector.margin}
                  </p>
                  <ul>
                    {selectedCharacter.lastNeuralState.routeInspector.because.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </div>
            ) : (
              <p className="empty-state">还没有运行时 neural state。发送第一条消息后这里会开始变化。</p>
            )}
          </div>
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
                  <pre className="mono">{displayedBlueprint.neuralDoc || "No neural doc."}</pre>
                </article>
                <article className="list-card">
                  <strong>Source segments</strong>
                  <pre className="mono">
                    {(displayedBlueprint.sourceSegments || []).slice(0, 12).join("\n\n")}
                  </pre>
                </article>
              </div>
            ) : (
              <p className="empty-state">生成 blueprint 后，这里会展示编译出的 prompt bundle 与神经元语料。</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
