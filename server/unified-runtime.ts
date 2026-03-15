import type {
  CharacterRecord,
  GenerationTrace,
  MarketListingRecord,
  NeuralMemoryRecord,
  NeuralStateSnapshot,
  RuntimeIntentDecision,
  SkillCatalogItem,
  WorkRunRecord,
} from "../src/types";
import type { LlmRuntimeConfig } from "./llm";
import { executeDirectRuntimePath, executePlannedRuntimePath } from "./runtime-paths";
import { executeGroupedWork } from "./work-orchestrator";

type AttachedSkill = {
  meta: SkillCatalogItem;
  content: string;
};

export type UnifiedRuntimeResult = {
  reply: string;
  generation: GenerationTrace;
  toolEvents: Array<{
    step: number;
    tool: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    summary: string;
  }>;
  workRun?: WorkRunRecord | null;
  marketListing?: MarketListingRecord | null;
};

type UnifiedRuntimeInput = {
  character: CharacterRecord;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  conversationId: string;
  config?: LlmRuntimeConfig;
  availableSkills: SkillCatalogItem[];
  attachedSkills: AttachedSkill[];
  activeSkill?: AttachedSkill | null;
  neuralState: NeuralStateSnapshot;
  globalMemories: NeuralMemoryRecord[];
  decision: RuntimeIntentDecision;
};

export async function executeUnifiedRuntime(
  input: UnifiedRuntimeInput,
): Promise<UnifiedRuntimeResult> {
  if (input.decision.path === "grouped_work" && input.decision.workIntent) {
    return executeGroupedWork({
      character: input.character,
      conversationId: input.conversationId,
      history: input.history,
      userMessage: input.userMessage,
      config: input.config,
      availableSkills: input.availableSkills,
      attachedSkills: input.attachedSkills,
      activeSkill: input.activeSkill,
      neuralState: input.neuralState,
      globalMemories: input.globalMemories,
      intent: input.decision.workIntent,
    });
  }

  if (input.decision.path === "planned_runtime") {
    const result = await executePlannedRuntimePath({
      character: input.character,
      history: input.history,
      userMessage: input.userMessage,
      config: input.config,
      availableSkills: input.availableSkills,
      attachedSkills: input.attachedSkills,
      activeSkill: input.activeSkill,
      neuralState: input.neuralState,
      globalMemories: input.globalMemories,
      planningNotes: [
        `Intent reason: ${input.decision.reason}`,
      ],
    });
    return {
      reply: result.reply,
      generation: {
        ...result.generation,
        reason: "planned_runtime_path",
      },
      toolEvents: result.toolEvents || [],
      workRun: null,
      marketListing: null,
    };
  }

  const result = await executeDirectRuntimePath({
    character: input.character,
    history: input.history,
    userMessage: input.userMessage,
    config: input.config,
    availableSkills: input.availableSkills,
    attachedSkills: input.attachedSkills,
    activeSkill: input.activeSkill,
    neuralState: input.neuralState,
    globalMemories: input.globalMemories,
    planningNotes: [
      `Intent reason: ${input.decision.reason}`,
    ],
  });

  return {
    reply: result.reply,
    generation: {
      ...result.generation,
      reason: input.decision.path === "direct_runtime" ? "direct_runtime_path" : result.generation.reason,
    },
    toolEvents: result.toolEvents || [],
    workRun: null,
    marketListing: null,
  };
}
