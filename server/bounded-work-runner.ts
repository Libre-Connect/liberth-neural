import type {
  CharacterRecord,
  NeuralMemoryRecord,
  NeuralStateSnapshot,
  SkillCatalogItem,
} from "../src/types";
import type { LlmRuntimeConfig } from "./llm";
import type { RuntimePathResult } from "./runtime-paths";
import { executePlannedRuntimePath } from "./runtime-paths";

type AttachedSkill = {
  meta: SkillCatalogItem;
  content: string;
};

export async function runBoundedWorkStage(input: {
  character: CharacterRecord;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  config?: LlmRuntimeConfig;
  availableSkills: SkillCatalogItem[];
  attachedSkills: AttachedSkill[];
  activeSkill?: AttachedSkill | null;
  neuralState: NeuralStateSnapshot;
  globalMemories: NeuralMemoryRecord[];
  objective: string;
  stageName: string;
  instructions: string[];
}): Promise<RuntimePathResult> {
  return executePlannedRuntimePath({
    character: input.character,
    history: input.history,
    userMessage: input.objective,
    config: input.config,
    availableSkills: input.availableSkills,
    attachedSkills: input.attachedSkills,
    activeSkill: input.activeSkill,
    neuralState: input.neuralState,
    globalMemories: input.globalMemories,
    planningNotes: [
      `Current stage: ${input.stageName}`,
      ...input.instructions,
    ],
  });
}
