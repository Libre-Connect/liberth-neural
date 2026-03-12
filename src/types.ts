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

export type ProviderMode = "glm-main" | "openai-compatible";

export type GenerationMode = "llm" | "persona-engine" | "fallback";

export type ProviderSettings = {
  providerMode: ProviderMode;
  glmModel: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
};

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

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type ConversationRecord = {
  id: string;
  characterId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
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
    secretToken?: string;
  };
  slack?: {
    botToken: string;
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
  language: "Chinese",
});
