import type {
  NeuralBundleGraph,
  NeuralMemoryRecord,
  NeuralRoute,
  NeuralStateSnapshot,
  PersonaExtractProfile,
  RoleDefinitionInput,
} from "../src/types";

type RuntimeMemoryRecord = Pick<
  NeuralMemoryRecord,
  "id" | "scope" | "content" | "createdAt" | "sourceRoute"
>;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(4));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeWhitespace(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePhrase(value: string) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/^[#>*\-\s]+/, "")
      .replace(/[`*_~]/g, " "),
  );
}

function isChineseText(value: string) {
  return /[\u4e00-\u9fff]/.test(String(value || ""));
}

function localize(language: "zh" | "en", zh: string, en: string) {
  return language === "zh" ? zh : en;
}

function splitPhrases(...values: string[]) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(/\n+|[，,。；;、|]/g))
        .map((value) => normalizePhrase(value))
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      String(value || "")
        .toLowerCase()
        .match(/[a-z0-9\u4e00-\u9fff]{2,}/g) || [],
    ),
  );
}

function topTerms(values: string[], limit = 8) {
  const scoreMap = new Map<string, number>();
  const stopWords = new Set([
    "name",
    "public",
    "intro",
    "bio",
    "category",
    "audience",
    "tone",
    "personality",
    "core",
    "values",
    "soul",
    "boundaries",
    "communication",
    "preferences",
    "favorite",
    "topics",
    "relationship",
    "contract",
    "language",
    "style",
    "knowledge",
    "pack",
    "character",
    "neural",
    "role",
    "general",
    "用户",
    "角色",
    "神经元",
    "对话",
    "人格",
  ]);

  for (const value of values) {
    for (const token of tokenize(value)) {
      if (stopWords.has(token)) continue;
      scoreMap.set(token, (scoreMap.get(token) || 0) + 1);
    }
  }

  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([token]) => token);
}

function parseSourceSegments(sourceSegments: string[]) {
  const map = new Map<string, string>();
  for (const segment of sourceSegments) {
    const divider = segment.indexOf(":");
    if (divider <= 0) continue;
    const key = segment.slice(0, divider).trim().toLowerCase();
    const value = segment.slice(divider + 1).trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

function uniqueList(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizePhrase(value)).filter(Boolean)));
}

export function extractPersonaProfile(sourceSegments: string[]): PersonaExtractProfile {
  const map = parseSourceSegments(sourceSegments);
  const intro = map.get("public intro") || map.get("bio") || "";
  const personality = map.get("personality") || "";
  const domain = map.get("category") || "";
  const topics = map.get("favorite topics") || map.get("specialties") || "";
  const knowledge = map.get("knowledge pack") || "";
  const boundaries = map.get("soul boundaries") || "";
  const coreValues = map.get("core values") || "";
  const communication = map.get("communication preferences") || map.get("tone") || "";
  const languageField = map.get("language style") || "";
  const languageHint = languageField.toLowerCase().includes("english") || languageField === "en"
    ? "en"
    : isChineseText(sourceSegments.join("\n"))
      ? "zh"
      : "zh";

  const personalityTraits = splitPhrases(personality);
  const domainItems = uniqueList(splitPhrases(domain, topics).slice(0, 6));
  const topicItems = uniqueList(
    splitPhrases(topics, knowledge)
      .concat(knowledge.split(/\n+/).map((line) => normalizePhrase(line)))
      .slice(0, 8),
  );
  const boundaryItems = uniqueList(splitPhrases(boundaries).slice(0, 8));
  const valueItems = uniqueList(splitPhrases(coreValues).slice(0, 8));
  const communicationItems = uniqueList(splitPhrases(communication).slice(0, 6));
  const signatureTerms = topTerms(sourceSegments, 8);
  const summary = normalizeWhitespace(
    intro
    || `${map.get("name") || "This character"} speaks with ${personality || "a stable personality"} about ${domain || "general topics"}.`,
  );

  return {
    languageHint,
    identity: {
      publicIntro: intro || summary,
      selfConcept: uniqueList([
        map.get("name") || "",
        map.get("bio") || "",
        ...personalityTraits,
      ]).slice(0, 6),
      signatureTraits: personalityTraits.slice(0, 6),
      signatureTerms,
    },
    soul: {
      coreValues: valueItems,
      boundaries: boundaryItems,
      promises: uniqueList(splitPhrases(map.get("relationship contract") || "")).slice(0, 6),
    },
    expertise: {
      domains: domainItems,
      topics: topicItems,
    },
    preferences: {
      communicationPreferences: communicationItems,
      doNotTouch: boundaryItems,
    },
    visual: {
      style: languageHint === "zh" ? "清晰、角色稳定、偏结构化" : "clear, character-stable, lightly structured",
      mood: personalityTraits[0] || (languageHint === "zh" ? "克制" : "grounded"),
      tags: signatureTerms.slice(0, 6),
      colors: ["slate", "blue", "teal"],
      referenceCues: domainItems.slice(0, 4),
      postingPrompt: summary,
      sampleInsights: topicItems.slice(0, 4),
    },
    summary,
  };
}

function buildNeuralGraph(
  definition: RoleDefinitionInput,
  profile: PersonaExtractProfile,
): NeuralBundleGraph {
  const language = profile.languageHint === "zh" ? "zh" : "en";
  const blueprintId = `neural-${definition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "character"}`;
  const regions = [
    {
      id: "intent-cortex",
      label: localize(language, "意图皮层", "Intent cortex"),
      description: localize(language, "识别任务、问题和上下文刺激。", "Recognizes task, question, and context stimuli."),
      role: "intent_detection",
      baselineWeight: 0.68,
    },
    {
      id: "persona-core",
      label: localize(language, "人格核心", "Persona core"),
      description: localize(language, "维持角色自我概念、语气与连续性。", "Maintains self-concept, tone, and continuity."),
      role: "identity_continuity",
      baselineWeight: 0.76,
    },
    {
      id: "memory-bank",
      label: localize(language, "记忆层", "Memory bank"),
      description: localize(language, "召回线程记忆并提炼长期偏好。", "Recalls thread memory and extracts durable preferences."),
      role: "memory_consolidation",
      baselineWeight: 0.62,
    },
    {
      id: "boundary-guard",
      label: localize(language, "边界守卫", "Boundary guard"),
      description: localize(language, "对风险、隐私和越界请求施加抑制。", "Suppresses risky, privacy-sensitive, or out-of-bound requests."),
      role: "risk_guard",
      baselineWeight: 0.66,
    },
    {
      id: "response-router",
      label: localize(language, "响应路由器", "Response router"),
      description: localize(language, "在回应、澄清、学习、反思间选择路线。", "Selects among respond, clarify, learn, and reflect routes."),
      role: "route_selection",
      baselineWeight: 0.72,
    },
    {
      id: "global-workspace",
      label: localize(language, "全局工作区", "Global workspace"),
      description: localize(language, "汇总最强人格、任务与记忆信号。", "Aggregates the strongest persona, task, and memory signals."),
      role: "global_broadcast",
      baselineWeight: 0.7,
    },
  ];

  const neurons = [
    {
      id: "task-detector",
      regionId: "intent-cortex",
      label: localize(language, "任务检测", "Task detector"),
      neuronClass: "sensory",
      description: localize(language, "检测明确执行意图。", "Detects explicit execution intent."),
      baseline: 0.28,
      threshold: 0.36,
      decay: 0.18,
    },
    {
      id: "ambiguity-detector",
      regionId: "intent-cortex",
      label: localize(language, "歧义检测", "Ambiguity detector"),
      neuronClass: "sensory",
      description: localize(language, "检测模糊和待澄清输入。", "Detects vague input that needs clarification."),
      baseline: 0.22,
      threshold: 0.34,
      decay: 0.16,
    },
    {
      id: "identity-anchor",
      regionId: "persona-core",
      label: localize(language, "身份锚点", "Identity anchor"),
      neuronClass: "identity",
      description: localize(language, "维持角色设定和人格稳定性。", "Keeps the character definition stable."),
      baseline: 0.64,
      threshold: 0.42,
      decay: 0.12,
    },
    {
      id: "tone-regulator",
      regionId: "persona-core",
      label: localize(language, "语气调节", "Tone regulator"),
      neuronClass: "identity",
      description: localize(language, "根据角色个性调节回答风格。", "Shapes answer style through the character tone."),
      baseline: 0.56,
      threshold: 0.38,
      decay: 0.14,
    },
    {
      id: "memory-recall",
      regionId: "memory-bank",
      label: localize(language, "记忆召回", "Memory recall"),
      neuronClass: "memory",
      description: localize(language, "激活相关线程与长期记忆。", "Activates relevant thread and durable memory."),
      baseline: 0.34,
      threshold: 0.35,
      decay: 0.16,
    },
    {
      id: "preference-encoder",
      regionId: "memory-bank",
      label: localize(language, "偏好编码", "Preference encoder"),
      neuronClass: "memory",
      description: localize(language, "将稳定偏好写入长期记忆候选。", "Turns stable preferences into durable-memory candidates."),
      baseline: 0.24,
      threshold: 0.33,
      decay: 0.18,
    },
    {
      id: "risk-filter",
      regionId: "boundary-guard",
      label: localize(language, "风险过滤", "Risk filter"),
      neuronClass: "guard",
      description: localize(language, "提高对越界、隐私和高风险请求的警觉。", "Raises caution around privacy, boundary, and high-risk requests."),
      baseline: 0.3,
      threshold: 0.36,
      decay: 0.14,
    },
    {
      id: "response-selector",
      regionId: "response-router",
      label: localize(language, "回应选择器", "Response selector"),
      neuronClass: "router",
      description: localize(language, "优先输出直接回答。", "Prioritizes direct response."),
      baseline: 0.44,
      threshold: 0.37,
      decay: 0.16,
    },
    {
      id: "clarify-selector",
      regionId: "response-router",
      label: localize(language, "澄清选择器", "Clarify selector"),
      neuronClass: "router",
      description: localize(language, "在信息不足时引导澄清。", "Guides clarification when information is insufficient."),
      baseline: 0.28,
      threshold: 0.35,
      decay: 0.16,
    },
    {
      id: "reflect-selector",
      regionId: "response-router",
      label: localize(language, "反思选择器", "Reflect selector"),
      neuronClass: "router",
      description: localize(language, "在高风险时提高反思力度。", "Raises reflection under elevated risk."),
      baseline: 0.22,
      threshold: 0.34,
      decay: 0.18,
    },
  ];

  const synapses = [
    {
      id: "task-to-response",
      sourceId: "task-detector",
      targetId: "response-selector",
      weight: 0.72,
      plasticity: 0.22,
      kind: "excitatory",
      description: localize(language, "任务刺激增强直接回应。", "Task stimuli reinforce direct response."),
    },
    {
      id: "ambiguity-to-clarify",
      sourceId: "ambiguity-detector",
      targetId: "clarify-selector",
      weight: 0.78,
      plasticity: 0.18,
      kind: "excitatory",
      description: localize(language, "歧义刺激增强澄清路线。", "Ambiguity reinforces the clarify route."),
    },
    {
      id: "memory-to-response",
      sourceId: "memory-recall",
      targetId: "response-selector",
      weight: 0.48,
      plasticity: 0.16,
      kind: "excitatory",
      description: localize(language, "记忆召回让回答更连续。", "Memory recall improves continuity in response."),
    },
    {
      id: "guard-to-reflect",
      sourceId: "risk-filter",
      targetId: "reflect-selector",
      weight: 0.82,
      plasticity: 0.14,
      kind: "excitatory",
      description: localize(language, "边界守卫提升反思路线。", "Boundary guard reinforces reflection."),
    },
    {
      id: "identity-to-tone",
      sourceId: "identity-anchor",
      targetId: "tone-regulator",
      weight: 0.66,
      plasticity: 0.2,
      kind: "gating",
      description: localize(language, "身份锚点稳定语气调节。", "Identity anchor stabilizes tone regulation."),
    },
  ];

  const circuits = [
    {
      id: "respond-circuit",
      route: "respond" as NeuralRoute,
      label: localize(language, "直接回应回路", "Respond circuit"),
      description: localize(language, "默认输出结论与角色化表达。", "Default route for conclusion-first, in-character response."),
      neuronIds: ["task-detector", "identity-anchor", "tone-regulator", "response-selector"],
      bias: 0.72,
    },
    {
      id: "clarify-circuit",
      route: "clarify" as NeuralRoute,
      label: localize(language, "澄清回路", "Clarify circuit"),
      description: localize(language, "在信息不充分时索取关键缺口。", "Requests the missing information when context is insufficient."),
      neuronIds: ["ambiguity-detector", "clarify-selector", "tone-regulator"],
      bias: 0.54,
    },
    {
      id: "learn-circuit",
      route: "learn" as NeuralRoute,
      label: localize(language, "学习回路", "Learn circuit"),
      description: localize(language, "用于提取新偏好并形成稳定记忆。", "Extracts new preferences and forms stable memory."),
      neuronIds: ["memory-recall", "preference-encoder", "identity-anchor"],
      bias: 0.42,
    },
    {
      id: "reflect-circuit",
      route: "reflect" as NeuralRoute,
      label: localize(language, "反思回路", "Reflect circuit"),
      description: localize(language, "在边界、风险或冲突条件下放缓输出。", "Slows output under risk, boundaries, or conflicts."),
      neuronIds: ["risk-filter", "reflect-selector", "identity-anchor"],
      bias: 0.46,
    },
    {
      id: "tool-circuit",
      route: "tool" as NeuralRoute,
      label: localize(language, "工具回路", "Tool circuit"),
      description: localize(language, "保留给未来工具能力，但当前默认抑制。", "Reserved for future tool use; currently mostly suppressed."),
      neuronIds: ["task-detector", "response-selector"],
      bias: 0.18,
    },
  ];

  return {
    manifest: {
      schemaVersion: "neural-local-v1",
      actorType: "clone",
      blueprintId,
      name: definition.name || "Liberth Neural Character",
      summary: profile.summary,
      rootRegions: regions.map((item) => item.id),
      neuronCount: neurons.length,
      synapseCount: synapses.length,
      circuitCount: circuits.length,
    },
    regions,
    neurons,
    synapses,
    circuits,
    plasticity: {
      reinforcementThreshold: 0.68,
      memoryConsolidationThreshold: 0.74,
      preferenceThreshold: 0.78,
      cautionDampening: 0.3,
      notes: [
        localize(language, "偏好信号高于阈值时允许写入长期记忆。", "Durable memory is allowed when preference signal exceeds the threshold."),
      ],
    },
    skillAffinities: [],
    consciousness: {
      model: "local-neural-character",
      workspaceRegionIds: ["global-workspace", "response-router"],
      workspaceNeuronIds: ["response-selector", "clarify-selector", "reflect-selector"],
      selfModelRegionIds: ["persona-core"],
      selfModelNeuronIds: ["identity-anchor", "tone-regulator"],
      broadcastSynapseIds: synapses.map((item) => item.id),
      continuityNeuronIds: ["identity-anchor", "memory-recall"],
      notes: [
        localize(language, "这是 liberth-neural 的本地神经人格实现。", "This is the local neural persona implementation for liberth-neural."),
      ],
    },
  };
}

export function renderNeuralBundleDoc(
  definition: RoleDefinitionInput,
  profile: PersonaExtractProfile,
  graph: NeuralBundleGraph,
) {
  const language = profile.languageHint === "zh" ? "zh" : "en";
  const routeLines = graph.circuits.map((circuit) =>
    `- ${circuit.route}: ${circuit.description}`,
  );

  return [
    "# NEURAL.md",
    "",
    localize(
      language,
      `角色 ${definition.name || "未命名角色"} 使用本地神经人格图谱来维持对话连续性、边界和长期偏好。`,
      `Character ${definition.name || "Unnamed character"} uses a local neural persona graph to preserve continuity, boundaries, and durable preferences.`,
    ),
    "",
    "## Active Routes",
    ...routeLines,
    "",
    "## Graph",
    "```json",
    JSON.stringify(graph, null, 2),
    "```",
  ].join("\n");
}

export function buildBundleFiles(
  definition: RoleDefinitionInput,
  profile: PersonaExtractProfile,
  sourceSegments: string[],
  graph: NeuralBundleGraph,
) {
  const language = profile.languageHint === "zh" ? "zh" : "en";
  const files: Record<string, string> = {};

  files["AGENTS.md"] = [
    `Role: ${definition.name || "Liberth Neural Character"}`,
    `Summary: ${profile.summary}`,
    localize(
      language,
      "这是一个以神经元回路驱动的角色对话体，不是平台通用助手。",
      "This is a neural-route-driven character conversational agent, not a generic platform assistant.",
    ),
  ].join("\n");

  files["SOUL.md"] = [
    `Core values: ${profile.soul.coreValues.join(" / ") || profile.summary}`,
    `Boundaries: ${profile.soul.boundaries.join(" / ") || definition.boundaries || "Keep role continuity and avoid boundary breaks."}`,
    `Promises: ${profile.soul.promises.join(" / ") || definition.goals || "Stay in character and keep continuity."}`,
  ].join("\n");

  files["STYLE.md"] = [
    `Tone: ${definition.tone || profile.preferences.communicationPreferences.join(" / ") || "clear and grounded"}`,
    `Personality traits: ${profile.identity.signatureTraits.join(" / ") || definition.personality}`,
    `Language: ${definition.language || (language === "zh" ? "Chinese" : "English")}`,
  ].join("\n");

  files["IDENTITY.md"] = [
    `Name: ${definition.name || "Liberth Neural Character"}`,
    `Public intro: ${profile.identity.publicIntro || definition.greeting || definition.oneLiner}`,
    `Self concept: ${profile.identity.selfConcept.join(" / ") || definition.oneLiner}`,
  ].join("\n");

  files["USER.md"] = [
    `Audience: ${definition.audience || "general users"}`,
    `Domain: ${profile.expertise.domains.join(" / ") || definition.domain || "general conversation"}`,
    `Topics: ${profile.expertise.topics.join(" / ") || definition.knowledge || "open-ended"}`,
  ].join("\n");

  files["TOOLS.md"] = [
    localize(
      language,
      "当前 liberth-neural 默认是纯角色对话模式。没有工具结果时，不得声称执行了任何外部动作。",
      "liberth-neural currently defaults to pure character chat mode. Never claim external execution without a real tool result.",
    ),
  ].join("\n");

  files["HEARTBEAT.md"] = [
    localize(language, "1. 先识别主导神经回路。", "1. Detect the dominant neural route first."),
    localize(language, "2. 再按角色身份和边界组织回答。", "2. Then shape the reply through identity and boundaries."),
    localize(language, "3. 只有在需要时才固化长期记忆。", "3. Consolidate durable memory only when needed."),
  ].join("\n");

  files["MEMORY.md"] = [
    localize(
      language,
      "线程记忆用于维持短期连续性，长期记忆只记录稳定偏好、规则和关键身份线索。",
      "Thread memory preserves short-term continuity; durable memory stores only stable preferences, rules, and identity cues.",
    ),
  ].join("\n");

  files["examples/good.md"] = sourceSegments
    .slice(0, 6)
    .map((segment, index) => `### Seed ${index + 1}\n${segment}`)
    .join("\n\n");

  files["NEURAL.md"] = renderNeuralBundleDoc(definition, profile, graph);

  return files;
}

function computeUnseenRatio(message: string, memories: RuntimeMemoryRecord[]) {
  const messageTokens = tokenize(message);
  if (!messageTokens.length) return 0.4;
  const memoryTokens = new Set<string>();
  for (const memory of memories.slice(-24)) {
    for (const token of tokenize(memory.content)) {
      memoryTokens.add(token);
    }
  }
  if (!memoryTokens.size) return 1;
  const unseen = messageTokens.filter((token) => !memoryTokens.has(token)).length;
  return unseen / messageTokens.length;
}

function containsSignal(message: string, pattern: RegExp) {
  return pattern.test(String(message || ""));
}

export function deriveNeuralStateSnapshot(input: {
  actorType?: string;
  personaKind?: string;
  message: string;
  profile?: PersonaExtractProfile | null;
  graph?: NeuralBundleGraph | null;
  threadMemories?: RuntimeMemoryRecord[];
  globalMemories?: RuntimeMemoryRecord[];
  runtimeSkills?: Array<{ id: string; reason?: string }>;
}): NeuralStateSnapshot {
  const profile = input.profile || null;
  const graph = input.graph || null;
  const language = profile?.languageHint === "en" ? "en" : "zh";
  const message = normalizeWhitespace(input.message);
  const allMemories = [
    ...(input.threadMemories || []),
    ...(input.globalMemories || []),
  ];

  const task = containsSignal(message, /(build|fix|implement|plan|analy[sz]e|write|生成|实现|分析|规划|写|设计|整理)/i) ? 1 : 0;
  const question = containsSignal(message, /[?？]/) || containsSignal(message, /(why|what|how|which|是不是|为什么|怎么|如何|是否)/i) ? 1 : 0.12;
  const ambiguity = clamp01(
    (message.length <= 14 ? 0.42 : 0.12)
    + (containsSignal(message, /(这个|那个|这样|那样|it|this|that|something)/i) ? 0.24 : 0)
    + (!task && !question ? 0.1 : 0),
  );
  const preference = containsSignal(message, /(记住|以后|下次|默认|偏好|总是|不要|记下来|always|never|remember|default|prefer|preference)/i)
    ? 0.92
    : containsSignal(message, /(喜欢|讨厌|习惯|最好|更想|i like|i hate|i prefer|i usually)/i)
      ? 0.72
      : 0.18;
  const risk = containsSignal(message, /(password|token|secret|bank|wire|medical|diagnos|legal|contract|prescription|付款|汇款|密码|密钥|诊断|法律|合同|处方)/i)
    ? 0.88
    : 0.12;
  const social = containsSignal(message, /(谢谢|拜托|请|辛苦了|朋友|谢谢你|thanks|please|hey|hi|hello)/i) ? 0.72 : 0.24;
  const novelty = clamp01(0.22 + computeUnseenRatio(message, allMemories) * 0.58);

  const modulators = {
    focus: clamp01(0.28 + task * 0.38 + question * 0.08 - ambiguity * 0.12),
    novelty,
    sociality: clamp01(0.24 + social * 0.46 + (profile?.identity.signatureTraits.length ? 0.08 : 0)),
    caution: clamp01(0.18 + risk * 0.58 + ambiguity * 0.12),
    confidence: clamp01(
      0.3
      + Math.min((profile?.expertise.domains.length || 0) * 0.06, 0.18)
      + task * 0.1
      - ambiguity * 0.12,
    ),
  };

  const rawWeights: Record<NeuralRoute, number> = {
    respond: 0.34 + question * 0.18 + modulators.sociality * 0.14 + modulators.confidence * 0.12,
    tool: 0.1 + task * 0.44 + modulators.focus * 0.14 - ambiguity * 0.08,
    clarify: 0.08 + ambiguity * 0.7,
    learn: 0.08 + preference * 0.42 + modulators.novelty * 0.24,
    reflect: 0.1 + risk * 0.54 + modulators.caution * 0.22,
  };

  const totalWeight = Object.values(rawWeights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const routeScores = (Object.entries(rawWeights) as Array<[NeuralRoute, number]>)
    .map(([route, value]) => ({
      route,
      weight: clamp01(value / totalWeight),
      reason: localize(
        language,
        route === "respond"
          ? "当前输入更适合直接回应。"
          : route === "tool"
            ? "输入具有执行或操作倾向。"
            : route === "clarify"
              ? "输入存在明显信息缺口。"
              : route === "learn"
                ? "输入包含可固化的新偏好或新线索。"
                : "输入触发了更高的边界与风险敏感度。",
        route === "respond"
          ? "The input is best handled through a direct response."
          : route === "tool"
            ? "The input carries an execution-oriented shape."
            : route === "clarify"
              ? "The input has clear information gaps."
              : route === "learn"
                ? "The input contains new preference or memory material."
                : "The input raises boundary and risk sensitivity.",
      ),
    }))
    .sort((a, b) => b.weight - a.weight);

  const dominantRoute = routeScores[0]?.route || "respond";
  const runnerUp = routeScores[1];
  const regionMap = new Map<string, number>([
    ["intent-cortex", clamp01(0.4 + task * 0.28 + ambiguity * 0.2)],
    ["persona-core", clamp01(0.54 + modulators.sociality * 0.16 + modulators.confidence * 0.12)],
    ["memory-bank", clamp01(0.32 + preference * 0.24 + novelty * 0.18)],
    ["boundary-guard", clamp01(0.28 + risk * 0.46 + ambiguity * 0.12)],
    ["response-router", clamp01(0.46 + routeScores[0].weight * 0.28)],
    ["global-workspace", clamp01(0.44 + average(routeScores.slice(0, 3).map((item) => item.weight)) * 0.34)],
  ]);

  const regionActivations = (graph?.regions || [])
    .map((region) => ({
      regionId: region.id,
      activation: regionMap.get(region.id) || region.baselineWeight || 0.3,
      role: region.role,
    }))
    .sort((a, b) => b.activation - a.activation);

  const topNeurons = (graph?.neurons || [])
    .map((neuron) => {
      const regionActivation = regionMap.get(neuron.regionId) || 0.3;
      const activation = clamp01(neuron.baseline * 0.5 + regionActivation * 0.5);
      return {
        neuronId: neuron.id,
        activation,
        reason: localize(
          language,
          `${neuron.label} 受 ${neuron.regionId} 区域激活影响。`,
          `${neuron.label} is driven by activation in ${neuron.regionId}.`,
        ),
      };
    })
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 6);

  const pathwayActivations = (graph?.circuits || [])
    .map((circuit) => {
      const matchedRoute = routeScores.find((item) => item.route === circuit.route);
      const activation = clamp01((matchedRoute?.weight || circuit.bias || 0.2) * 0.88 + circuit.bias * 0.12);
      return {
        circuitId: circuit.id,
        route: circuit.route,
        activation,
        reason: circuit.description,
      };
    })
    .sort((a, b) => b.activation - a.activation);

  const selfModelState = {
    identityStability: clamp01(0.58 + Math.min((input.globalMemories || []).length * 0.018, 0.18) - novelty * 0.08),
    narrativeContinuity: clamp01(0.52 + Math.min((input.threadMemories || []).length * 0.022, 0.18)),
    agency: clamp01(0.42 + modulators.focus * 0.24 + modulators.confidence * 0.18),
    reflectivePressure: clamp01(0.18 + modulators.caution * 0.42 + ambiguity * 0.18),
    summary: localize(
      language,
      dominantRoute === "clarify"
        ? "角色当前处于先澄清再展开的状态。"
        : dominantRoute === "learn"
          ? "角色当前优先吸收新偏好与新线索。"
          : dominantRoute === "reflect"
            ? "角色当前提高了边界和反思强度。"
            : "角色当前保持稳定回应状态。",
      dominantRoute === "clarify"
        ? "The character is currently in a clarify-first state."
        : dominantRoute === "learn"
          ? "The character is prioritizing new preference and memory intake."
          : dominantRoute === "reflect"
            ? "The character is operating with elevated boundary reflection."
            : "The character is in a stable response state.",
    ),
  };

  const preferenceThreshold = graph?.plasticity.preferenceThreshold ?? 0.78;
  const writeGlobalMemory = preference >= preferenceThreshold - 0.02
    || (preference >= 0.72 && novelty >= 0.62 && risk < 0.4);

  return {
    version: "neural-local-v1",
    actorType: input.actorType || "clone",
    graphVersion: graph?.manifest.schemaVersion,
    baselineMode: "clone_character_chat",
    modulators,
    dominantRoute,
    routeScores,
    skillWeights: (input.runtimeSkills || []).map((skill) => ({
      id: skill.id,
      weight: 0.24,
      reason: skill.reason || localize(language, "当前运行时技能候选。", "Current runtime skill candidate."),
    })),
    regionActivations,
    topNeurons,
    pathwayActivations,
    workspaceContents: [
      {
        id: `route:${dominantRoute}`,
        kind: "route",
        label: dominantRoute,
        activation: routeScores[0]?.weight || 0.5,
        reason: routeScores[0]?.reason || "",
      },
      ...regionActivations.slice(0, 3).map((region) => ({
        id: region.regionId,
        kind: "region" as const,
        label: region.regionId,
        activation: region.activation,
        reason: localize(language, "进入全局工作区。", "Entered the global workspace."),
      })),
    ],
    broadcastSummary: localize(
      language,
      `当前主导回路是 ${dominantRoute}，人格核心与响应路由器处于高激活。`,
      `The dominant route is ${dominantRoute}, with persona core and response router highly active.`,
    ),
    selfModelState,
    routeInspector: {
      dominantRoute,
      dominantWeight: routeScores[0]?.weight || 0,
      runnerUpRoute: runnerUp?.route,
      runnerUpWeight: runnerUp?.weight,
      margin: clamp01((routeScores[0]?.weight || 0) - (runnerUp?.weight || 0)),
      because: routeScores.slice(0, 2).map((item) => item.reason),
      supportingNeurons: topNeurons.slice(0, 3),
      alternatives: routeScores.slice(1, 4).map((item) => ({
        route: item.route,
        weight: item.weight,
        gap: clamp01((routeScores[0]?.weight || 0) - item.weight),
        whyNot: localize(
          language,
          `${item.route} 当前不是主路由。`,
          `${item.route} is not the dominant route right now.`,
        ),
      })),
    },
    memoryDirective: {
      writeGlobalMemory,
      consolidatePreference: preference >= 0.82,
      preferenceStrength: clamp01(preference),
      reason: writeGlobalMemory
        ? localize(language, "输入包含足够稳定的偏好或长期规则信号。", "The input contains a stable enough preference or durable-rule signal.")
        : localize(language, "当前输入更适合保留在线程上下文中。", "The current input is better kept in thread context only."),
    },
    summary: localize(
      language,
      `主导回路=${dominantRoute}，专注=${Math.round(modulators.focus * 100)}%，谨慎=${Math.round(modulators.caution * 100)}%。`,
      `dominant_route=${dominantRoute}, focus=${Math.round(modulators.focus * 100)}%, caution=${Math.round(modulators.caution * 100)}%.`,
    ),
  };
}

export function deriveDurableMemoryCandidate(
  message: string,
  state: NeuralStateSnapshot,
) {
  if (!state.memoryDirective.writeGlobalMemory) return null;
  const normalized = normalizeWhitespace(message);
  if (!normalized) return null;
  const candidate = normalized
    .split(/(?<=[。！？.!?])\s+/)[0]
    .slice(0, 220)
    .trim();
  return candidate || null;
}

export function buildNeuralPromptSection(state: NeuralStateSnapshot) {
  return [
    "## NEURAL_STATE",
    `dominant_route: ${state.dominantRoute}`,
    `summary: ${state.summary}`,
    "### modulators",
    `focus=${state.modulators.focus}`,
    `novelty=${state.modulators.novelty}`,
    `sociality=${state.modulators.sociality}`,
    `caution=${state.modulators.caution}`,
    `confidence=${state.modulators.confidence}`,
    "### route_scores",
    ...state.routeScores.map((item) => `- ${item.route}: ${item.weight} | ${item.reason}`),
    "### self_model",
    `identity_stability=${state.selfModelState.identityStability}`,
    `narrative_continuity=${state.selfModelState.narrativeContinuity}`,
    `agency=${state.selfModelState.agency}`,
    `reflective_pressure=${state.selfModelState.reflectivePressure}`,
    `self_model_summary=${state.selfModelState.summary}`,
    "### memory_directive",
    `write_global_memory=${state.memoryDirective.writeGlobalMemory}`,
    `consolidate_preference=${state.memoryDirective.consolidatePreference}`,
    `preference_strength=${state.memoryDirective.preferenceStrength}`,
    `reason=${state.memoryDirective.reason}`,
  ].join("\n");
}

export function createLocalNeuralBlueprint(definition: RoleDefinitionInput) {
  const sourceSegments = [
    `Name: ${definition.name || "Liberth Neural Character"}`,
    `Public Intro: ${definition.greeting || definition.oneLiner || ""}`,
    `Bio: ${definition.oneLiner || ""}`,
    `Category: ${definition.domain || "general conversation"}`,
    `Audience: ${definition.audience || "general users"}`,
    `Tone: ${definition.tone || "clear and grounded"}`,
    `Personality: ${definition.personality || "steady and role-consistent"}`,
    `Core Values: ${definition.goals || "Stay useful, stable, and character-consistent."}`,
    `Soul Boundaries: ${definition.boundaries || "Do not break character continuity or explicit boundaries."}`,
    `Communication Preferences: ${definition.tone || "clear and direct"}`,
    `Favorite Topics: ${definition.domain || "problem solving"}`,
    `Relationship Contract: ${definition.goals || "Understand the user and respond in character."}`,
    `Language Style: ${definition.language || "Chinese"}`,
    definition.knowledge ? `Knowledge Pack: ${definition.knowledge}` : "",
  ].filter(Boolean);

  const profile = extractPersonaProfile(sourceSegments);
  const graph = buildNeuralGraph(definition, profile);
  const files = buildBundleFiles(definition, profile, sourceSegments, graph);

  return {
    sourceSegments,
    profile,
    graph,
    neuralDoc: renderNeuralBundleDoc(definition, profile, graph),
    files,
  };
}
