import type {
  ConversationRecord,
  NeuralMemoryRecord,
  NeuralRecord,
  NeuralRoute,
  NeuralStateSnapshot,
} from "../src/types";

function normalizeMemoryText(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function toThreadMemories(conversation: ConversationRecord): NeuralMemoryRecord[] {
  const memories: NeuralMemoryRecord[] = [];
  if (conversation.compaction?.summary) {
    memories.push({
      id: "thread_compaction",
      scope: "thread",
      content: `[Compacted session summary]\n${conversation.compaction.summary}`,
      createdAt: conversation.compaction.updatedAt,
      sourceRoute: undefined,
    });
  }

  return [
    ...memories,
    ...conversation.messages.slice(-10).map((message, index) => ({
      id: `thread_${index + 1}`,
      scope: "thread" as const,
      content: `${message.role}: ${message.content}`,
      createdAt: message.createdAt,
      sourceRoute: undefined,
    })),
  ];
}

export function appendGlobalMemory(
  memories: NeuralMemoryRecord[],
  content: string | null,
  sourceRoute?: NeuralRoute,
) {
  const normalized = normalizeMemoryText(content || "");
  if (!normalized) return memories;
  if (memories.some((item) => normalizeMemoryText(item.content) === normalized)) {
    return memories;
  }
  const nextMemory: NeuralMemoryRecord = {
    id: `mem_${Date.now().toString(36)}`,
    scope: "global",
    content: String(content || "").trim(),
    createdAt: Date.now(),
    sourceRoute,
  };
  return [...memories, nextMemory].slice(-24);
}

export function buildNeuralRuntimeSection(input: {
  neuralState: NeuralStateSnapshot | null | undefined;
  globalMemories: NeuralMemoryRecord[];
}) {
  const neuralState = input.neuralState;
  if (!neuralState) return "";

  const memoryLines = input.globalMemories
    .slice(-6)
    .map((memory) => `- ${memory.content}`)
    .join("\n");

  const supportingNeurons = neuralState.routeInspector.supportingNeurons
    .slice(0, 6)
    .map((item) => `${item.neuronId} ${Math.round(item.activation * 100)}%`)
    .join(", ");

  return [
    "## NEURAL_RUNTIME.md",
    `dominantRoute: ${neuralState.dominantRoute}`,
    `summary: ${neuralState.summary}`,
    `broadcastSummary: ${neuralState.broadcastSummary || "-"}`,
    `focus: ${Math.round(neuralState.modulators.focus * 100)}%`,
    `novelty: ${Math.round(neuralState.modulators.novelty * 100)}%`,
    `caution: ${Math.round(neuralState.modulators.caution * 100)}%`,
    `supportingNeurons: ${supportingNeurons || "-"}`,
    neuralState.memoryDirective.reason
      ? `memoryDirective: ${neuralState.memoryDirective.reason}`
      : "",
    memoryLines ? `recentDurableMemories:\n${memoryLines}` : "",
    "Let the dominant route shape the reply, but keep the output practical and direct.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAssistantNeuralRecord(input: {
  provider: NeuralRecord["provider"];
  neuralState: NeuralStateSnapshot | null | undefined;
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
      provider: input.provider,
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
    provider: input.provider,
  };
}
