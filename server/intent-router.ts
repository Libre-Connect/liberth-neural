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

function hasRecurringAutomationIntent(message: string) {
  const normalized = String(message || "").toLowerCase();
  return /(every minute|every hour|every day|every week|hourly|daily|weekly|schedule|scheduled|recurring|repeat|periodic|monitor|monitoring|notify|notification|alert|automation|automate|cron)/.test(
    normalized,
  ) || /(每分钟|每小時|每小时|每天|每周|定时|排程|周期|自動化|自动化|監控|监控|提醒|通知|告警)/.test(message);
}

function hasLiveDataNeed(message: string) {
  const normalized = String(message || "").toLowerCase();
  return /(price|pricing|quote|ticker|行情|价格|報價|报价|币价|幣價|eth|btc|bitcoin|crypto|stock|market|news)/.test(
    normalized,
  );
}

function buildAutomationExecutionHints(message: string) {
  const trimmed = String(message || "").trim();
  const hints = [
    "Automation intent detected. Do not stop at a plain explanatory answer if the runtime tools can execute the request.",
    "If the user wants recurring monitoring, scheduling, alerts, or periodic reports, prefer an actual automation flow.",
    "Use list_attached_skills to inspect current capability coverage when relevant.",
    "If no attached skill clearly covers the job, use search_skills to discover an installable skill for the requested capability.",
    "If a discovered skill is a strong fit, install it before finalizing the recurring workflow.",
    "If live or refreshed data is requested, prefer real tool-backed retrieval over a generic limitation message.",
    "If the user is asking for recurring execution, finish by calling create_automation with a concrete name, prompt, and intervalMinutes.",
  ];

  if (trimmed) {
    hints.push(`Automation objective: ${trimmed}`);
  }

  return hints;
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

  const automationIntent = hasRecurringAutomationIntent(input.message);
  const liveDataNeed = hasLiveDataNeed(input.message);

  if (automationIntent || liveDataNeed) {
    return {
      path: "planned_runtime",
      reason: automationIntent
        ? "The request asks for recurring automation or monitoring and should be executed through tool-backed planning."
        : "The request asks for live or refreshed data, so tool-backed runtime execution should be preferred over a static reply.",
      confidence: automationIntent && liveDataNeed ? 0.93 : 0.84,
      publicationCandidate,
      executionHints: buildAutomationExecutionHints(input.message),
    };
  }

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
