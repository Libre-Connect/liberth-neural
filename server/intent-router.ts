import type {
  NeuralStateSnapshot,
  RuntimeIntentDecision,
  WorkIntent,
} from "../src/types";

function normalizeTitle(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
}

function inferTaskType(message: string): WorkIntent["taskType"] {
  const normalized = String(message || "").toLowerCase();
  if (/(spec|design|architecture|blueprint|workflow|roadmap|plan)/.test(normalized)) {
    return "spec";
  }
  if (/(implement|build|ship|deliver|refactor|modify|apply)/.test(normalized)) {
    return "delivery";
  }
  return "analysis";
}

function buildWorkIntent(message: string, publicationCandidate: boolean): WorkIntent {
  const title = normalizeTitle(message) || "Structured grouped work";
  const taskType = inferTaskType(message);
  return {
    title,
    summary:
      taskType === "spec"
        ? "Structured planning work that should yield a reusable architecture or specification artifact."
        : taskType === "delivery"
          ? "Structured delivery work that should convert intent into an executable outcome."
          : "Structured analysis work that should consolidate reasoning into a reusable artifact.",
    objective: String(message || "").trim(),
    taskType,
    stageHints:
      taskType === "spec"
        ? ["brief", "plan", "delivery", "qa", "publication"]
        : taskType === "delivery"
          ? ["brief", "plan", "delivery", "qa", "repair", "publication"]
          : ["brief", "plan", "delivery", "qa"],
    publicationCandidate,
  };
}

export function deriveUnifiedRuntimeDecision(input: {
  message: string;
  commandType: string;
  neuralState: NeuralStateSnapshot;
}): RuntimeIntentDecision {
  const normalized = String(input.message || "").toLowerCase();
  const publicationCandidate = /(publish|template|share|catalog|market|reusable|open source|oss|starter)/.test(
    normalized,
  );

  if (input.commandType !== "none") {
    return {
      path: "direct_runtime",
      reason: "Explicit runtime command takes precedence over intent routing.",
      confidence: 0.98,
      publicationCandidate,
    };
  }

  const groupedWork =
    /(architecture|blueprint|workflow|spec|roadmap|implementation plan|refactor|modify|apply|report|research|audit|design|system)/.test(
      normalized,
    ) && normalized.length >= 24;

  if (groupedWork) {
    return {
      path: "grouped_work",
      reason: "The request implies multi-stage work that benefits from bridged planning, delivery, and QA.",
      confidence: 0.86,
      publicationCandidate,
      workIntent: buildWorkIntent(input.message, publicationCandidate),
    };
  }

  if (input.neuralState.dominantRoute === "learn" || input.neuralState.dominantRoute === "reflect") {
    return {
      path: "planned_runtime",
      reason: "The neural state favors reflective or learning-heavy execution, so a structured runtime pass is preferred.",
      confidence: 0.72,
      publicationCandidate,
    };
  }

  return {
    path: "direct_runtime",
    reason: "A direct runtime answer is sufficient for this turn.",
    confidence: 0.78,
    publicationCandidate,
  };
}
