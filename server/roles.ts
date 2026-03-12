import type {
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

export async function generateRoleReplyDetailed(input: {
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  config?: LlmRuntimeConfig;
}) {
  const fallback = () => {
    const historyTurns = input.history.length;
    return [
      "我会按当前神经元角色设定来回答。",
      `你刚才的问题是：“${input.userMessage}”。`,
      historyTurns > 0
        ? `我已经接住这段对话里的最近 ${historyTurns} 轮上下文。`
        : "这是这段神经元对话的第一轮刺激。",
      "如果你想改变人格、目标或边界，请回到角色工作台重新生成角色。",
    ].join("\n");
  };

  const result = await completeTextDetailed(
    [
      { role: "system", content: input.systemPrompt },
      ...input.history,
      { role: "user", content: input.userMessage },
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
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  config?: LlmRuntimeConfig;
}) {
  const result = await generateRoleReplyDetailed(input);
  return result.reply;
}
