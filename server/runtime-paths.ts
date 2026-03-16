import type {
  CharacterRecord,
  ChatAttachment,
  NeuralMemoryRecord,
  NeuralStateSnapshot,
  SkillCatalogItem,
} from "../src/types";
import type { LlmRuntimeConfig } from "./llm";
import { buildRuntimeSystemPrompt } from "./workspace";
import { runRoleAgentTurn } from "./agent-runtime";
import { buildNeuralRuntimeSection } from "./neural-memory";

type AttachedSkill = {
  meta: SkillCatalogItem;
  content: string;
};

type ActiveSkill = AttachedSkill | null | undefined;

export type RuntimePathResult = Awaited<ReturnType<typeof runRoleAgentTurn>>;

type RuntimePathInput = {
  character: CharacterRecord;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  userAttachments?: ChatAttachment[];
  config?: LlmRuntimeConfig;
  availableSkills: SkillCatalogItem[];
  attachedSkills: AttachedSkill[];
  activeSkill?: ActiveSkill;
  neuralState: NeuralStateSnapshot;
  globalMemories: NeuralMemoryRecord[];
  planningNotes?: string[];
};

async function buildPathSystemPrompt(input: RuntimePathInput) {
  const base = await buildRuntimeSystemPrompt({
    character: input.character,
    availableSkills: input.availableSkills,
    attachedSkills: input.attachedSkills,
    activeSkill: input.activeSkill,
  });

  const planningSection = input.planningNotes?.length
    ? ["## EXECUTION_ENVELOPE.md", ...input.planningNotes].join("\n")
    : "";

  return [base, buildNeuralRuntimeSection({
    neuralState: input.neuralState,
    globalMemories: input.globalMemories,
  }), planningSection]
    .filter(Boolean)
    .join("\n\n");
}

export async function executeDirectRuntimePath(input: RuntimePathInput): Promise<RuntimePathResult> {
  const systemPrompt = await buildPathSystemPrompt(input);
  return runRoleAgentTurn({
    character: input.character,
    systemPrompt,
    history: input.history,
    userMessage: input.userMessage,
    userAttachments: input.userAttachments,
    config: input.config,
    allowMutatingTools: true,
  });
}

export async function executePlannedRuntimePath(input: RuntimePathInput): Promise<RuntimePathResult> {
  const planningNotes = [
    "Operate in structured execution mode.",
    "Think in explicit stages: objective, constraints, staged plan, final output, residual risks.",
    "Return the final answer as a polished artifact, but make the internal structure legible.",
    ...(input.planningNotes || []),
  ];

  return executeDirectRuntimePath({
    ...input,
    planningNotes,
  });
}
