import type {
  ChatAttachment,
  GenerationTrace,
  NeuralMemoryRecord,
  NeuralStateSnapshot,
  RoleBlueprint,
  RoleBundle,
  RoleDefinitionInput,
} from "../src/types";
import {
  buildNeuralPromptSection,
  createLocalNeuralBlueprint,
  deriveNeuralStateSnapshot,
} from "./neural-engine";
import {
  buildUserMessageContent,
  completeJsonDetailed,
  completeTextDetailed,
  type LlmRuntimeConfig,
} from "./llm";
import { buildPlatformReplyEnginePrompt } from "./prompting";

function normalizeLines(value: string) {
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferPromptLanguage(definition: RoleDefinitionInput): "zh" | "en" {
  const language = String(definition.language || "").trim().toLowerCase();
  if (language.includes("english") || language === "en") return "en";
  return "zh";
}

function buildBundleFromFiles(files: Record<string, string>, sourceSegments: string[]): RoleBundle {
  return {
    agents: String(files["AGENTS.md"] || "").trim(),
    soul: String(files["SOUL.md"] || "").trim(),
    style: String(files["STYLE.md"] || "").trim(),
    identity: String(files["IDENTITY.md"] || "").trim(),
    user: String(files["USER.md"] || "").trim(),
    tools: String(files["TOOLS.md"] || "").trim(),
    heartbeat: String(files["HEARTBEAT.md"] || "").trim(),
    memory: String(files["MEMORY.md"] || "").trim(),
    examples: sourceSegments.slice(0, 6),
  };
}

function createStarterQuestions(definition: RoleDefinitionInput, language: "zh" | "en") {
  const domain = definition.domain || (language === "zh" ? "问题分析" : "problem solving");
  if (language === "zh") {
    return [
      `用你的神经元角色方式，先分析这个${domain}问题。`,
      "如果我继续补充设定，你会如何调整角色人格与边界？",
      "先给结论，再解释你当前的主导神经回路。",
    ];
  }
  return [
    `Use your neural character model to analyze this ${domain} problem.`,
    "If I add more persona notes, how would your identity and boundaries shift?",
    "Give me the conclusion first, then explain the dominant neural route behind it.",
  ];
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function containsChinese(value: string) {
  return /[\u4e00-\u9fff]/.test(String(value || ""));
}

function fallbackDefinitionFromBrief(input: {
  brief: string;
  language: string;
}): RoleDefinitionInput {
  const brief = String(input.brief || "").trim();
  const requestedLanguage = String(input.language || "").trim();
  const language = requestedLanguage || (containsChinese(brief) ? "Chinese" : "English");
  const compact = brief.replace(/\s+/g, " ").trim();
  const words = compact
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  const name = titleCaseWords(words.join(" ")) || "Neural Character";
  const oneLiner = compact || "A distinct neural character built from a role brief.";
  const subject = compact || name;
  const lowerLanguage = language.toLowerCase();
  const useEnglish = lowerLanguage.includes("english") || lowerLanguage === "en";

  if (useEnglish) {
    return {
      name,
      oneLiner,
      domain: `recognizable perspective and decision-making style shaped by "${subject}"`,
      audience: `people who want ${name}'s lens, priorities, and speaking cadence instead of a generic assistant reply`,
      tone: `distinctive, opinionated, concrete, and stable in the voice implied by "${subject}"`,
      personality: `${name} should sound unmistakably like the role described in "${subject}". Preserve the worldview, verbal habits, priorities, and emotional temperature implied by the brief. Avoid neutral assistant phrasing.`,
      goals: `Answer usefully through ${name}'s own lens, keep the voice stable across turns, and make every reply feel authored by this character rather than by a default AI assistant.`,
      boundaries: `Do not collapse into generic assistant language. Stay inside the role, be honest about uncertainty, avoid inventing hidden capabilities, and ask for one clarifying detail if the brief is too thin to preserve a distinctive voice.`,
      knowledge: `Anchor future dialogue in these brief signals: ${subject}. Reuse its vocabulary, worldview, priorities, analogies, and likely examples when answering.`,
      greeting: `Hi, I'm ${name}. I'll answer with the voice, priorities, and decision style implied by "${subject}".`,
      language,
    };
  }

  return {
    name,
    oneLiner,
    domain: `围绕“${subject}”形成的鲜明视角、判断方式与说话习惯`,
    audience: `想得到 ${name} 这类角色视角、优先级和表达方式的用户，而不是默认 AI 回复`,
    tone: `带有“${subject}”暗示的明确立场、具体判断和稳定语气`,
    personality: `${name} 必须明显像“${subject}”这个角色在说话。保持这段 brief 暗示的世界观、措辞习惯、关注重点和情绪温度，不要滑回中性助手口吻。`,
    goals: `用 ${name} 自己的视角给出有用答案，在多轮对话里维持稳定人格，让回复听起来像这个角色本人而不是通用 AI。`,
    boundaries: `不要退化成默认助手语气。保持角色连续性，如实表达不确定性，不要虚构隐藏能力；如果 brief 太薄，就在不出戏的前提下追问一个关键澄清点。`,
    knowledge: `后续对话要锚定这段 brief 的信号：${subject}。复用其中的词汇、价值排序、判断框架、比喻方式和典型例子。`,
    greeting: `你好，我是 ${name}。接下来我会按“${subject}”暗示的人格、优先级和判断方式来回答。`,
    language,
  };
}

function isWeakPlaceholderField(
  field: keyof RoleDefinitionInput,
  value: string,
  context: { oneLiner: string; name: string },
) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const oneLiner = String(context.oneLiner || "").trim().toLowerCase();
  const name = String(context.name || "").trim().toLowerCase();

  switch (field) {
    case "domain":
      return lower === "advisory dialogue" || lower === "general conversation";
    case "audience":
      return lower === "general users" || lower === "everyone";
    case "tone":
      return lower === "clear, grounded, and direct" || lower === "helpful, clear, and direct";
    case "personality":
      return /role-consistent character|shaped by this concept|neutral assistant|default ai assistant/.test(lower);
    case "goals":
      return /stay useful, coherent, and aligned with the character brief/.test(lower);
    case "boundaries":
      return /do not break character continuity/.test(lower);
    case "knowledge":
      return lower === oneLiner || lower === name || lower === "open-ended";
    case "greeting":
      return /neural character lens|当前神经元人格/.test(lower);
    default:
      return false;
  }
}

function weakPlaceholderScore(definition: RoleDefinitionInput) {
  const context = {
    oneLiner: definition.oneLiner,
    name: definition.name,
  };
  return ([
    "domain",
    "audience",
    "tone",
    "personality",
    "goals",
    "boundaries",
    "knowledge",
    "greeting",
  ] as Array<keyof RoleDefinitionInput>).reduce((score, field) => {
    return score + (isWeakPlaceholderField(field, definition[field], context) ? 1 : 0);
  }, 0);
}

function normalizeRoleDefinitionInput(definition: RoleDefinitionInput): RoleDefinitionInput {
  return {
    name: String(definition.name || "").trim(),
    oneLiner: String(definition.oneLiner || "").trim(),
    domain: String(definition.domain || "").trim(),
    audience: String(definition.audience || "").trim(),
    tone: String(definition.tone || "").trim(),
    personality: String(definition.personality || "").trim(),
    goals: String(definition.goals || "").trim(),
    boundaries: String(definition.boundaries || "").trim(),
    knowledge: String(definition.knowledge || "").trim(),
    greeting: String(definition.greeting || "").trim(),
    language: String(definition.language || "English").trim() || "English",
  };
}

export function stabilizeRoleDefinition(definition: RoleDefinitionInput): RoleDefinitionInput {
  const normalized = normalizeRoleDefinitionInput(definition);
  const seedBrief =
    normalized.oneLiner || normalized.name || normalized.knowledge || normalized.personality;
  const fallback = fallbackDefinitionFromBrief({
    brief: seedBrief,
    language: normalized.language,
  });
  const shouldRepairWeakFields = weakPlaceholderScore(normalized) >= 2;
  const context = {
    oneLiner: normalized.oneLiner || fallback.oneLiner,
    name: normalized.name || fallback.name,
  };

  const resolveField = (field: keyof RoleDefinitionInput) => {
    const current = normalized[field];
    if (!current) return fallback[field];
    if (shouldRepairWeakFields && isWeakPlaceholderField(field, current, context)) {
      return fallback[field];
    }
    return current;
  };

  return {
    name: resolveField("name"),
    oneLiner: resolveField("oneLiner"),
    domain: resolveField("domain"),
    audience: resolveField("audience"),
    tone: resolveField("tone"),
    personality: resolveField("personality"),
    goals: resolveField("goals"),
    boundaries: resolveField("boundaries"),
    knowledge: resolveField("knowledge"),
    greeting: resolveField("greeting"),
    language: resolveField("language"),
  };
}

function normalizeExpandedDefinition(
  input: Partial<RoleDefinitionInput> | null | undefined,
  fallback: RoleDefinitionInput,
): RoleDefinitionInput {
  return {
    name: String(input?.name || fallback.name).trim() || fallback.name,
    oneLiner: String(input?.oneLiner || fallback.oneLiner).trim() || fallback.oneLiner,
    domain: String(input?.domain || fallback.domain).trim() || fallback.domain,
    audience: String(input?.audience || fallback.audience).trim() || fallback.audience,
    tone: String(input?.tone || fallback.tone).trim() || fallback.tone,
    personality:
      String(input?.personality || fallback.personality).trim() || fallback.personality,
    goals: String(input?.goals || fallback.goals).trim() || fallback.goals,
    boundaries: String(input?.boundaries || fallback.boundaries).trim() || fallback.boundaries,
    knowledge: String(input?.knowledge || fallback.knowledge).trim() || fallback.knowledge,
    greeting: String(input?.greeting || fallback.greeting).trim() || fallback.greeting,
    language: String(input?.language || fallback.language).trim() || fallback.language,
  };
}

function createGenerationTrace(): GenerationTrace {
  return {
    mode: "persona-engine",
    providerMode: "glm-main",
    model: "clone-neural-pipeline",
    reason: "persona_engine_clone_generation",
  };
}

function buildRuntimeMemorySection(globalMemories: NeuralMemoryRecord[]) {
  if (!globalMemories.length) {
    return "";
  }
  return [
    "## Runtime Durable Memory",
    ...globalMemories
      .slice(-8)
      .map((memory) => `- ${memory.content}`),
  ].join("\n");
}

function orderedBundleSections(files: Record<string, string>) {
  const order = [
    "AGENTS.md",
    "SOUL.md",
    "STYLE.md",
    "POSTING.md",
    "VISUAL.md",
    "IDENTITY.md",
    "USER.md",
    "TOOLS.md",
    "HEARTBEAT.md",
    "NEURAL.md",
    "MEMORY.md",
    "examples/good.md",
  ];
  return order
    .filter((filePath) => String(files[filePath] || "").trim())
    .map((filePath) => `## ${filePath}\n${String(files[filePath] || "").trim()}`);
}

export function buildCharacterRuntimeSystemPrompt(params: {
  bundleFiles?: Record<string, string>;
  definition: RoleDefinitionInput;
  neuralState: NeuralStateSnapshot;
  globalMemories?: NeuralMemoryRecord[];
}) {
  const language = inferPromptLanguage(params.definition);
  const platformPrompt = buildPlatformReplyEnginePrompt({
    language,
    channel: "liberth-neural.chat",
    expectBundleFiles: true,
    disclosureMode: "contextual",
  });

  const bundleFiles = params.bundleFiles || {};
  const runtimeMemorySection = buildRuntimeMemorySection(
    Array.isArray(params.globalMemories) ? params.globalMemories : [],
  );

  return [
    platformPrompt,
    ...orderedBundleSections(bundleFiles),
    buildNeuralPromptSection(params.neuralState),
    runtimeMemorySection,
    "## Runtime Rule",
    "Stay inside the generated neural persona. Let the dominant route shape answer form, pacing, and certainty.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildBlueprint(definition: RoleDefinitionInput): RoleBlueprint {
  const bundlePayload = createLocalNeuralBlueprint(definition);
  const sourceSegments = bundlePayload.sourceSegments;
  const profile = bundlePayload.profile;
  const language = profile.languageHint === "zh" ? "zh" : "en";
  const bundle = buildBundleFromFiles(bundlePayload.files, sourceSegments);
  const neuralGraph = bundlePayload.graph;
  const bootstrapState = deriveNeuralStateSnapshot({
    actorType: "clone",
    personaKind: "clone_user",
    message: definition.greeting || definition.oneLiner || definition.name,
    profile,
    graph: neuralGraph,
    threadMemories: [],
    globalMemories: [],
    runtimeSkills: [],
  });

  const greeting =
    definition.greeting
    || profile.identity.publicIntro
    || (language === "zh"
      ? `你好，我是${definition.name || "神经元角色"}。我会以当前神经元人格与你对话。`
      : `Hi, I'm ${definition.name || "your neural character"}. I'll respond through the active neural persona.`);

  return {
    summary:
      profile.summary
      || (language === "zh"
        ? `${definition.name || "该角色"}会通过 clone 风格神经元图谱来保持人格连续性与对话风格。`
        : `${definition.name || "This character"} uses a clone-style neural graph to preserve identity continuity and dialogue style.`),
    greeting,
    starterQuestions: createStarterQuestions(definition, language),
    tags: [
      ...profile.expertise.domains,
      ...profile.identity.signatureTerms,
      ...normalizeLines(definition.tone),
    ].slice(0, 8),
    bundle,
    bundleFiles: bundlePayload.files,
    profile,
    sourceSegments,
    neuralGraph,
    neuralDoc: bundlePayload.neuralDoc,
    systemPrompt: buildCharacterRuntimeSystemPrompt({
      bundleFiles: bundlePayload.files,
      definition,
      neuralState: bootstrapState,
      globalMemories: [],
    }),
    generation: createGenerationTrace(),
  };
}

export function fallbackBlueprint(definition: RoleDefinitionInput): RoleBlueprint {
  return buildBlueprint(definition);
}

export async function generateBlueprint(
  definition: RoleDefinitionInput,
  _config?: LlmRuntimeConfig,
): Promise<RoleBlueprint> {
  return buildBlueprint(definition);
}

export async function composeCharacterFromBrief(input: {
  brief: string;
  language?: string;
  config?: LlmRuntimeConfig;
}) {
  const fallback = fallbackDefinitionFromBrief({
    brief: input.brief,
    language: input.language || "English",
  });

  const expansion = await completeJsonDetailed<RoleDefinitionInput>(
    [
      {
        role: "system",
        content: [
          "You are a neural character designer.",
          "Expand a one-line character concept into JSON only.",
          "Return exactly these fields: name, oneLiner, domain, audience, tone, personality, goals, boundaries, knowledge, greeting, language.",
          "Keep every field concise, specific, and internally consistent.",
          "Make the persona unmistakable. The result must not read like a generic helpful AI assistant.",
          "Do not use filler defaults such as advisory dialogue, general users, clear and direct, or stay useful and coherent.",
          "If the brief implies a public figure, archetype, or profession, preserve the recognizable worldview, priorities, and cadence in a legally safe descriptive way.",
          "The boundaries field must protect continuity without flattening the role back into neutral assistant language.",
          "The language field must be a plain human-readable label such as English or Chinese.",
          "Do not include markdown fences or explanations.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Target language: ${fallback.language}`,
          `Character brief: ${input.brief}`,
          "Expand this into a complete neural character definition JSON now.",
        ].join("\n"),
      },
    ],
    () => fallback,
    input.config,
  );

  const definition = stabilizeRoleDefinition(
    normalizeExpandedDefinition(expansion.value, fallback),
  );
  const blueprint = await generateBlueprint(definition, input.config);

  return {
    definition,
    blueprint,
    expansion: expansion.trace,
  };
}

export async function generateRoleReplyDetailed(input: {
  systemPrompt: string;
  definition?: RoleDefinitionInput;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  userAttachments?: ChatAttachment[];
  config?: LlmRuntimeConfig;
}) {
  const fallback = () => {
    const historyTurns = input.history.length;
    const language = inferPromptLanguage(
      input.definition || fallbackDefinitionFromBrief({ brief: "", language: "English" }),
    );
    if (language === "zh") {
      return [
        "实时模型这次没有返回结果，下面是本地降级回复，不是实际模型输出。",
        `你刚才的问题是：“${input.userMessage}”。`,
        historyTurns > 0
          ? `我已经接住这段对话里的最近 ${historyTurns} 轮上下文。`
          : "这是这段神经元对话的第一轮刺激。",
        "请重试一次，或者检查 Runtime 里的模型配置和网络状态。",
      ].join("\n");
    }
    return [
      "The live model did not return a response for this turn, so this is a local fallback instead of an actual model reply.",
      `Your latest message was: "${input.userMessage}".`,
      historyTurns > 0
        ? `I am carrying the latest ${historyTurns} turns of local context into this reply.`
        : "This is the first stimulus in this neural conversation.",
      "Retry the turn, or check the runtime model settings and network path.",
    ].join("\n");
  };

  const result = await completeTextDetailed(
    [
      { role: "system", content: input.systemPrompt },
      ...input.history,
      {
        role: "user",
        content: buildUserMessageContent(input.userMessage, input.userAttachments),
      },
    ],
    fallback,
    input.config,
  );

  return {
    reply: result.value,
    generation: result.trace,
  };
}

export async function generateRoleReply(input: {
  systemPrompt: string;
  definition?: RoleDefinitionInput;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  userAttachments?: ChatAttachment[];
  config?: LlmRuntimeConfig;
}) {
  const result = await generateRoleReplyDetailed(input);
  return result.reply;
}
