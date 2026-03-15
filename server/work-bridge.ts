import type {
  CharacterRecord,
  MarketListingRecord,
  NeuralRoute,
  WorkArtifactKind,
  WorkArtifactRecord,
  WorkIntent,
  WorkRunRecord,
} from "../src/types";
import { randomId } from "./store";

export function createWorkRun(input: {
  character: CharacterRecord;
  conversationId: string;
  userMessage: string;
  sourceRoute: NeuralRoute;
  intent: WorkIntent;
}): WorkRunRecord {
  const now = Date.now();
  return {
    id: randomId("work"),
    characterId: input.character.id,
    conversationId: input.conversationId,
    title: input.intent.title,
    summary: input.intent.summary,
    objective: input.intent.objective,
    taskType: input.intent.taskType,
    sourceRoute: input.sourceRoute,
    executionPath: "grouped_work",
    status: "queued",
    publicationCandidate: input.intent.publicationCandidate,
    createdAt: now,
    updatedAt: now,
    userMessage: input.userMessage,
    stageNotes: [
      "Work run created from the assistant runtime bridge.",
      `Initial stage hints: ${input.intent.stageHints.join(", ")}`,
    ],
    artifacts: [],
    qaStatus: "pending",
  };
}

export function appendWorkArtifact(
  workRun: WorkRunRecord,
  input: {
    kind: WorkArtifactKind;
    title: string;
    content: string;
    status?: WorkArtifactRecord["status"];
    notes?: string[];
  },
): WorkRunRecord {
  const now = Date.now();
  const artifact: WorkArtifactRecord = {
    id: randomId("artifact"),
    kind: input.kind,
    title: input.title,
    content: input.content,
    createdAt: now,
    updatedAt: now,
    status: input.status || "created",
    notes: input.notes,
  };

  return {
    ...workRun,
    updatedAt: now,
    artifacts: [...workRun.artifacts, artifact],
  };
}

export function markWorkRunStatus(
  workRun: WorkRunRecord,
  status: WorkRunRecord["status"],
  notes: string[] = [],
): WorkRunRecord {
  return {
    ...workRun,
    status,
    updatedAt: Date.now(),
    stageNotes: [...workRun.stageNotes, ...notes],
  };
}

export function buildDraftListing(input: {
  character: CharacterRecord;
  workRun: WorkRunRecord;
  artifact: WorkArtifactRecord;
}): MarketListingRecord {
  const now = Date.now();
  return {
    id: randomId("listing"),
    characterId: input.character.id,
    workRunId: input.workRun.id,
    title: input.workRun.title,
    summary: input.workRun.summary,
    artifactKind: input.artifact.kind,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    tags: Array.isArray(input.character.blueprint.tags)
      ? input.character.blueprint.tags.slice(0, 8)
      : [],
  };
}
