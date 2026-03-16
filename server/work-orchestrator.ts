import type {
  CharacterRecord,
  ChatAttachment,
  GenerationTrace,
  MarketListingRecord,
  NeuralMemoryRecord,
  NeuralStateSnapshot,
  SkillCatalogItem,
  WorkIntent,
  WorkRunRecord,
} from "../src/types";
import type { LlmRuntimeConfig } from "./llm";
import { completeJsonDetailed } from "./llm";
import { maybeCreateDraftListing } from "./market-publisher";
import { runBoundedWorkStage } from "./bounded-work-runner";
import {
  appendWorkArtifact,
  createWorkRun,
  markWorkRunStatus,
} from "./work-bridge";

type AttachedSkill = {
  meta: SkillCatalogItem;
  content: string;
};

type WorkPlan = {
  title: string;
  summary: string;
  objective: string;
  deliveryBrief: string;
  stageNotes: string[];
  qaChecklist: string[];
  publicationCandidate: boolean;
};

type GroupedWorkResult = {
  reply: string;
  generation: GenerationTrace;
  toolEvents: Array<{
    step: number;
    tool: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    summary: string;
  }>;
  workRun: WorkRunRecord;
  marketListing: MarketListingRecord | null;
};

function fallbackPlan(intent: WorkIntent): WorkPlan {
  return {
    title: intent.title,
    summary: intent.summary,
    objective: intent.objective,
    deliveryBrief: `Produce a clean ${intent.taskType} artifact that resolves the request: ${intent.objective}`,
    stageNotes: [
      "Start from the incoming user objective.",
      "Build a legible internal plan before drafting the final artifact.",
      "Run a final quality check and tighten the answer if it is vague.",
    ],
    qaChecklist: [
      "The output should be materially useful, not a placeholder.",
      "The output should preserve persona coherence and technical clarity.",
      "The output should expose assumptions and residual risks when relevant.",
    ],
    publicationCandidate: intent.publicationCandidate,
  };
}

function scoreDeliveryQuality(content: string) {
  const text = String(content || "").trim();
  const hasStructure = /(^#|\n#|\n- |\n\d+\. )/m.test(text);
  const hasSubstance = text.length >= 220;
  const hasMultipleParagraphs = text.split(/\n{2,}/).filter(Boolean).length >= 2;
  return {
    pass: hasStructure && hasSubstance && hasMultipleParagraphs,
    notes: [
      hasStructure ? "Structured formatting detected." : "Delivery lacked explicit structure.",
      hasSubstance ? "Delivery length looks sufficient." : "Delivery was too short to be a durable artifact.",
      hasMultipleParagraphs ? "Delivery contains multiple coherent sections." : "Delivery reads like a single shallow block.",
    ],
  };
}

async function deriveWorkPlan(input: {
  intent: WorkIntent;
  neuralState: NeuralStateSnapshot;
  config?: LlmRuntimeConfig;
}): Promise<WorkPlan> {
  const fallback = fallbackPlan(input.intent);
  const result = await completeJsonDetailed<WorkPlan>(
    [
      {
        role: "system",
        content: [
          "You are a work planner inside Liberth Neural Standalone.",
          "Output JSON only.",
          "Plan the task as grouped internal work with planning, delivery, QA, and optional publication.",
          "Keep stage notes concise and practical.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          title: input.intent.title,
          summary: input.intent.summary,
          objective: input.intent.objective,
          taskType: input.intent.taskType,
          dominantRoute: input.neuralState.dominantRoute,
          broadcastSummary: input.neuralState.broadcastSummary,
          publicationCandidate: input.intent.publicationCandidate,
        }, null, 2),
      },
    ],
    () => fallback,
    input.config,
  );

  return {
    ...fallback,
    ...result.value,
    title: String(result.value.title || fallback.title).trim() || fallback.title,
    summary: String(result.value.summary || fallback.summary).trim() || fallback.summary,
    objective: String(result.value.objective || fallback.objective).trim() || fallback.objective,
    deliveryBrief:
      String(result.value.deliveryBrief || fallback.deliveryBrief).trim() || fallback.deliveryBrief,
    stageNotes:
      Array.isArray(result.value.stageNotes) && result.value.stageNotes.length > 0
        ? result.value.stageNotes.map((note) => String(note || "").trim()).filter(Boolean)
        : fallback.stageNotes,
    qaChecklist:
      Array.isArray(result.value.qaChecklist) && result.value.qaChecklist.length > 0
        ? result.value.qaChecklist.map((note) => String(note || "").trim()).filter(Boolean)
        : fallback.qaChecklist,
    publicationCandidate: result.value.publicationCandidate === true || fallback.publicationCandidate,
  };
}

function mergeToolEvents(
  ...eventGroups: Array<
    Array<{
      step: number;
      tool: string;
      arguments: Record<string, unknown>;
      ok: boolean;
      summary: string;
    }>
  >
) {
  return eventGroups.flat().map((event, index) => ({
    ...event,
    step: index + 1,
  }));
}

export async function executeGroupedWork(input: {
  character: CharacterRecord;
  conversationId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  userAttachments?: ChatAttachment[];
  config?: LlmRuntimeConfig;
  availableSkills: SkillCatalogItem[];
  attachedSkills: AttachedSkill[];
  activeSkill?: AttachedSkill | null;
  neuralState: NeuralStateSnapshot;
  globalMemories: NeuralMemoryRecord[];
  intent: WorkIntent;
}): Promise<GroupedWorkResult> {
  const plan = await deriveWorkPlan({
    intent: input.intent,
    neuralState: input.neuralState,
    config: input.config,
  });

  let workRun = createWorkRun({
    character: input.character,
    conversationId: input.conversationId,
    userMessage: input.userMessage,
    sourceRoute: input.neuralState.dominantRoute,
    intent: {
      ...input.intent,
      title: plan.title,
      summary: plan.summary,
      objective: plan.objective,
      publicationCandidate: plan.publicationCandidate,
    },
  });

  workRun = markWorkRunStatus(workRun, "running", [
    "Grouped work orchestration started.",
    ...plan.stageNotes,
  ]);

  workRun = appendWorkArtifact(workRun, {
    kind: "brief",
    title: "User brief",
    content: input.userMessage,
    status: "accepted",
  });

  const planningStage = await runBoundedWorkStage({
    character: input.character,
    history: input.history,
    config: input.config,
    availableSkills: input.availableSkills,
    attachedSkills: input.attachedSkills,
    activeSkill: input.activeSkill,
    neuralState: input.neuralState,
    globalMemories: input.globalMemories,
    objective: plan.objective,
    stageName: "planning",
    instructions: [
      `Task title: ${plan.title}`,
      `Task summary: ${plan.summary}`,
      "Produce a concise internal work plan with phases, checkpoints, and risks.",
    ],
  });

  workRun = appendWorkArtifact(workRun, {
    kind: "plan",
    title: "Internal work plan",
    content: planningStage.reply,
    status: "accepted",
  });

  const deliveryStage = await runBoundedWorkStage({
    character: input.character,
    history: input.history,
    config: input.config,
    availableSkills: input.availableSkills,
    attachedSkills: input.attachedSkills,
    activeSkill: input.activeSkill,
    neuralState: input.neuralState,
    globalMemories: input.globalMemories,
    objective: plan.deliveryBrief,
    stageName: "delivery",
    instructions: [
      `Task title: ${plan.title}`,
      `Task summary: ${plan.summary}`,
      "Use the planning stage as internal guidance and return a polished final artifact.",
      "The final artifact should stand on its own for a human reader.",
      `Planning context:\n${planningStage.reply}`,
    ],
  });

  workRun = appendWorkArtifact(workRun, {
    kind: "delivery",
    title: "Primary delivery artifact",
    content: deliveryStage.reply,
    status: "accepted",
  });

  let finalStage = deliveryStage;
  const quality = scoreDeliveryQuality(deliveryStage.reply);
  workRun = appendWorkArtifact(workRun, {
    kind: "qa",
    title: "Quality review",
    content: [
      `Pass: ${quality.pass ? "yes" : "no"}`,
      ...plan.qaChecklist.map((item) => `Checklist: ${item}`),
      ...quality.notes.map((item) => `Finding: ${item}`),
    ].join("\n"),
    status: quality.pass ? "accepted" : "rejected",
  });

  workRun = {
    ...workRun,
    qaStatus: quality.pass ? "passed" : "failed",
    updatedAt: Date.now(),
  };

  if (!quality.pass) {
    const repairStage = await runBoundedWorkStage({
      character: input.character,
      history: input.history,
      config: input.config,
      availableSkills: input.availableSkills,
      attachedSkills: input.attachedSkills,
      activeSkill: input.activeSkill,
      neuralState: input.neuralState,
      globalMemories: input.globalMemories,
      objective: plan.deliveryBrief,
      stageName: "repair",
      instructions: [
        "Repair the artifact using the QA findings.",
        `Original delivery:\n${deliveryStage.reply}`,
        ...quality.notes.map((item) => `QA finding: ${item}`),
      ],
    });

    workRun = appendWorkArtifact(workRun, {
      kind: "repair",
      title: "Repaired delivery artifact",
      content: repairStage.reply,
      status: "accepted",
      notes: quality.notes,
    });

    finalStage = repairStage;
    workRun = {
      ...workRun,
      qaStatus: "passed",
      updatedAt: Date.now(),
      stageNotes: [...workRun.stageNotes, "Delivery was repaired after QA."],
    };
  }

  workRun = markWorkRunStatus(workRun, "completed", [
    "Grouped work orchestration completed.",
  ]);

  let marketListing = maybeCreateDraftListing({
    character: input.character,
    workRun,
  });

  if (marketListing) {
    workRun = {
      ...workRun,
      marketListingId: marketListing.id,
      updatedAt: Date.now(),
    };
    workRun = appendWorkArtifact(workRun, {
      kind: "publication",
      title: "Draft market publication",
      content: [
        `Listing title: ${marketListing.title}`,
        `Listing summary: ${marketListing.summary}`,
        `Listing status: ${marketListing.status}`,
      ].join("\n"),
      status: "accepted",
    });
  }

  const replySuffix = marketListing
    ? "\n\n[Grouped work completed. A draft publication artifact was prepared for this result.]"
    : "\n\n[Grouped work completed inside the standalone runtime.]";

  return {
    reply: `${finalStage.reply}${replySuffix}`,
    generation: {
      ...finalStage.generation,
      reason: "grouped_work_orchestration",
    },
    toolEvents: mergeToolEvents(
      planningStage.toolEvents || [],
      deliveryStage.toolEvents || [],
      finalStage === deliveryStage ? [] : finalStage.toolEvents || [],
    ),
    workRun,
    marketListing,
  };
}
