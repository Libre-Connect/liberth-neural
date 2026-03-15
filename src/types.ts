export type RoleDefinitionInput = {
  name: string;
  oneLiner: string;
  domain: string;
  audience: string;
  tone: string;
  personality: string;
  goals: string;
  boundaries: string;
  knowledge: string;
  greeting: string;
  language: string;
};

export type ProviderMode =
  | "glm-main"
  | "openai-compatible"
  | "openrouter"
  | "deepseek"
  | "siliconflow"
  | "groq"
  | "ollama"
  | "anthropic"
  | "google-gemini";

export type GenerationMode = "llm" | "persona-engine" | "fallback";

export type ProviderSettings = {
  providerMode: ProviderMode;
  glmModel: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  anthropicVersion: string;
  googleApiVersion: string;
};

export type ProviderCatalogItem = {
  id: ProviderMode;
  label: string;
  description: string;
  apiStyle: "glm-main" | "openai-compatible" | "anthropic" | "google-gemini";
  defaultModel: string;
  defaultBaseUrl?: string;
  apiKeyPlaceholder: string;
};

export const providerCatalog: ProviderCatalogItem[] = [
  {
    id: "glm-main",
    label: "GLM",
    description: "Native Zhipu GLM access for the built-in neural dialogue path.",
    apiStyle: "glm-main",
    defaultModel: "glm-4-flash-250414",
    apiKeyPlaceholder: "Enter GLM API key",
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    description: "Any provider that exposes the OpenAI chat completions format.",
    apiStyle: "openai-compatible",
    defaultModel: "gpt-4.1-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyPlaceholder: "OPENAI_API_KEY",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Router for multiple frontier and open-weight chat models.",
    apiStyle: "openai-compatible",
    defaultModel: "openai/gpt-4.1-mini",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKeyPlaceholder: "OPENROUTER_API_KEY",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "Native DeepSeek hosted chat models through an OpenAI-compatible API.",
    apiStyle: "openai-compatible",
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    apiKeyPlaceholder: "DEEPSEEK_API_KEY",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    description: "Hosted open-weight inference with an OpenAI-compatible surface.",
    apiStyle: "openai-compatible",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    apiKeyPlaceholder: "SILICONFLOW_API_KEY",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Low-latency chat inference via Groq's OpenAI-compatible endpoint.",
    apiStyle: "openai-compatible",
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    apiKeyPlaceholder: "GROQ_API_KEY",
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Run the neural character stack against a local model on your machine.",
    apiStyle: "openai-compatible",
    defaultModel: "qwen2.5:14b",
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKeyPlaceholder: "Optional for reverse proxies",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Native Anthropic Messages API support for Claude models.",
    apiStyle: "anthropic",
    defaultModel: "claude-3-5-haiku-latest",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyPlaceholder: "ANTHROPIC_API_KEY",
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    description: "Native Gemini generateContent support for Google's models.",
    apiStyle: "google-gemini",
    defaultModel: "gemini-2.0-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyPlaceholder: "GOOGLE_API_KEY / GEMINI_API_KEY",
  },
];

export function getProviderCatalogItem(mode: ProviderMode) {
  return providerCatalog.find((item) => item.id === mode) || providerCatalog[0];
}

export type RoleBundle = {
  agents: string;
  soul: string;
  style: string;
  identity: string;
  user: string;
  tools: string;
  heartbeat: string;
  memory: string;
  examples: string[];
};

export type PersonaExtractProfile = {
  languageHint: "zh" | "en";
  identity: {
    publicIntro: string;
    selfConcept: string[];
    signatureTraits: string[];
    signatureTerms: string[];
  };
  soul: {
    coreValues: string[];
    boundaries: string[];
    promises: string[];
  };
  expertise: {
    domains: string[];
    topics: string[];
  };
  preferences: {
    communicationPreferences: string[];
    doNotTouch: string[];
  };
  visual: {
    style: string;
    mood: string;
    tags: string[];
    colors: string[];
    referenceCues: string[];
    postingPrompt: string;
    sampleInsights: string[];
  };
  summary: string;
};

export type NeuralRoute = "respond" | "tool" | "clarify" | "learn" | "reflect";

export type NeuralBundleGraph = {
  manifest: {
    schemaVersion: string;
    actorType: string;
    blueprintId: string;
    name: string;
    summary: string;
    rootRegions: string[];
    neuronCount: number;
    synapseCount: number;
    circuitCount: number;
  };
  regions: Array<{
    id: string;
    label: string;
    description: string;
    role: string;
    baselineWeight: number;
  }>;
  neurons: Array<{
    id: string;
    regionId: string;
    label: string;
    neuronClass: string;
    description: string;
    baseline: number;
    threshold: number;
    decay: number;
  }>;
  synapses: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    weight: number;
    plasticity: number;
    kind: string;
    description: string;
  }>;
  circuits: Array<{
    id: string;
    route: NeuralRoute;
    label: string;
    description: string;
    neuronIds: string[];
    bias: number;
  }>;
  plasticity: {
    reinforcementThreshold: number;
    memoryConsolidationThreshold: number;
    preferenceThreshold: number;
    cautionDampening: number;
    notes: string[];
  };
  skillAffinities: Array<{
    skillId: string;
    neuronIds: string[];
    baselineWeight: number;
    reason: string;
  }>;
  consciousness?: {
    model: string;
    workspaceRegionIds: string[];
    workspaceNeuronIds: string[];
    selfModelRegionIds: string[];
    selfModelNeuronIds: string[];
    broadcastSynapseIds: string[];
    continuityNeuronIds: string[];
    notes: string[];
  } | null;
};

export type NeuralStateSnapshot = {
  version: string;
  actorType: string;
  graphVersion?: string;
  baselineMode: string;
  modulators: {
    focus: number;
    novelty: number;
    sociality: number;
    caution: number;
    confidence: number;
  };
  dominantRoute: NeuralRoute;
  routeScores: Array<{
    route: NeuralRoute;
    weight: number;
    reason: string;
  }>;
  skillWeights: Array<{
    id: string;
    weight: number;
    reason: string;
  }>;
  regionActivations: Array<{
    regionId: string;
    activation: number;
    role: string;
  }>;
  topNeurons: Array<{
    neuronId: string;
    activation: number;
    reason: string;
  }>;
  pathwayActivations: Array<{
    circuitId: string;
    route: NeuralRoute;
    activation: number;
    reason: string;
  }>;
  workspaceContents: Array<{
    id: string;
    kind: "neuron" | "region" | "route" | "self_model";
    label: string;
    activation: number;
    reason: string;
  }>;
  broadcastSummary: string;
  selfModelState: {
    identityStability: number;
    narrativeContinuity: number;
    agency: number;
    reflectivePressure: number;
    summary: string;
  };
  routeInspector: {
    dominantRoute: NeuralRoute;
    dominantWeight: number;
    runnerUpRoute?: NeuralRoute;
    runnerUpWeight?: number;
    margin: number;
    because: string[];
    supportingNeurons: Array<{
      neuronId: string;
      activation: number;
      reason: string;
    }>;
    alternatives: Array<{
      route: NeuralRoute;
      weight: number;
      gap: number;
      whyNot: string;
    }>;
  };
  memoryDirective: {
    writeGlobalMemory: boolean;
    consolidatePreference: boolean;
    preferenceStrength: number;
    reason: string;
  };
  summary: string;
};

export type NeuralMemoryRecord = {
  id: string;
  scope: "thread" | "global";
  content: string;
  createdAt: number;
  sourceRoute?: NeuralRoute;
};

export type GenerationTrace = {
  mode: GenerationMode;
  providerMode: ProviderMode;
  model: string;
  reason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  compacted?: boolean;
  compactionCount?: number;
  nativeTools?: boolean;
};

export type NeuralRecord = {
  recordedAt: number;
  dominantRoute: NeuralRoute;
  turnSummary: string;
  broadcastSummary: string;
  routeInspector: NeuralStateSnapshot["routeInspector"];
  modulators: NeuralStateSnapshot["modulators"];
  workspaceContents: NeuralStateSnapshot["workspaceContents"];
  topNeurons: NeuralStateSnapshot["topNeurons"];
  memoryDirective: NeuralStateSnapshot["memoryDirective"] & {
    durableMemoryCandidate?: string | null;
  };
  provider: GenerationTrace;
};

export type RuntimeExecutionPath =
  | "direct_runtime"
  | "planned_runtime"
  | "grouped_work";

export type RuntimeIntentDecision = {
  path: RuntimeExecutionPath;
  reason: string;
  confidence: number;
  publicationCandidate: boolean;
  workIntent?: WorkIntent | null;
};

export type WorkIntent = {
  title: string;
  summary: string;
  objective: string;
  taskType: "analysis" | "spec" | "delivery";
  stageHints: string[];
  publicationCandidate: boolean;
};

export type WorkArtifactKind =
  | "brief"
  | "plan"
  | "delivery"
  | "qa"
  | "repair"
  | "publication";

export type WorkArtifactRecord = {
  id: string;
  kind: WorkArtifactKind;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  status: "created" | "accepted" | "rejected";
  notes?: string[];
};

export type WorkRunRecord = {
  id: string;
  characterId: string;
  conversationId: string;
  title: string;
  summary: string;
  objective: string;
  taskType: WorkIntent["taskType"];
  sourceRoute: NeuralRoute;
  executionPath: RuntimeExecutionPath;
  status: "queued" | "running" | "completed" | "failed";
  publicationCandidate: boolean;
  createdAt: number;
  updatedAt: number;
  userMessage: string;
  stageNotes: string[];
  artifacts: WorkArtifactRecord[];
  qaStatus: "pending" | "passed" | "failed";
  marketListingId?: string;
};

export type MarketListingRecord = {
  id: string;
  characterId: string;
  workRunId: string;
  title: string;
  summary: string;
  artifactKind: WorkArtifactKind;
  status: "draft" | "published";
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export type RoleBlueprint = {
  summary: string;
  greeting: string;
  systemPrompt: string;
  starterQuestions: string[];
  tags: string[];
  bundle?: RoleBundle;
  bundleFiles?: Record<string, string>;
  profile?: PersonaExtractProfile;
  sourceSegments?: string[];
  neuralGraph?: NeuralBundleGraph;
  neuralDoc?: string;
  generation?: GenerationTrace;
};

export type CharacterRecord = {
  id: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  definition: RoleDefinitionInput;
  blueprint: RoleBlueprint;
  globalMemories?: NeuralMemoryRecord[];
  lastNeuralState?: NeuralStateSnapshot | null;
  skillIds: string[];
};

export type ToolEventRecord = {
  step: number;
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  generation?: GenerationTrace | null;
  neuralRecord?: NeuralRecord | null;
  toolEvents?: ToolEventRecord[];
};

export type ConversationCompaction = {
  summary: string;
  updatedAt: number;
  sourceMessageCount: number;
  count: number;
  instructions?: string;
};

export type ConversationRecord = {
  id: string;
  characterId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  compaction?: ConversationCompaction | null;
};

export type DeploymentChannel = "telegram" | "slack" | "webhook";
export type DeploymentPlatformKey =
  | "telegram"
  | "slack"
  | "discord"
  | "feishu"
  | "teams"
  | "webhook";

export type DeploymentRecord = {
  id: string;
  characterId: string;
  secret: string;
  channel: DeploymentChannel;
  platformKey: DeploymentPlatformKey;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  sessionByConversation: Record<string, string>;
  telegram?: {
    botToken: string;
    chatId: string;
    secretToken?: string;
  };
  slack?: {
    botToken: string;
    channelId: string;
    signingSecret: string;
  };
  webhook?: {
    outboundUrl?: string;
    outboundAuthHeader?: string;
  };
};

export type SkillCatalogItem = {
  id: string;
  name: string;
  level: string;
  description: string;
  tags: string[];
  category?: string;
  outputs?: string[];
  useCases?: string[];
  source?: "workspace" | "local" | "bundled" | "external";
  sourcePath?: string;
  packageRef?: string;
  installUrl?: string;
  installs?: number;
};

export type InstalledSkillRecord = {
  skillId: string;
  installedAt: number;
  enabled: boolean;
  source: "workspace" | "local" | "bundled" | "external";
};

export type SearchResultRecord = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  engine?: string;
};

export type AutomationRecord = {
  id: string;
  characterId: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
};

export type AutomationRunRecord = {
  id: string;
  automationId: string;
  characterId: string;
  prompt: string;
  status: "success" | "error";
  reply: string;
  createdAt: number;
  generation?: GenerationTrace;
  error?: string;
};

export type StoreShape = {
  characters: CharacterRecord[];
  conversations: ConversationRecord[];
  deployments: DeploymentRecord[];
  installedSkills: InstalledSkillRecord[];
  automations: AutomationRecord[];
  automationRuns: AutomationRunRecord[];
  workRuns: WorkRunRecord[];
  marketListings: MarketListingRecord[];
  settings: {
    provider: ProviderSettings;
  };
};

export const emptyRoleDefinition = (): RoleDefinitionInput => ({
  name: "",
  oneLiner: "",
  domain: "",
  audience: "",
  tone: "",
  personality: "",
  goals: "",
  boundaries: "",
  knowledge: "",
  greeting: "",
  language: "English",
});

export const emptyProviderSettings = (): ProviderSettings => {
  const preset = getProviderCatalogItem("glm-main");
  return {
    providerMode: "glm-main",
    glmModel: preset.defaultModel,
    apiKey: "",
    baseUrl: "",
    model: "",
    anthropicVersion: "2023-06-01",
    googleApiVersion: "v1beta",
  };
};
