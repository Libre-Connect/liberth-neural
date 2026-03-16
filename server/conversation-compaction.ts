import type {
  ChatMessage,
  ConversationCompaction,
  ConversationRecord,
} from "../src/types";
import {
  completeTextDetailed,
  hasLlmAccess,
  type LlmRuntimeConfig,
} from "./llm";

const COMPACTION_KEEP_TAIL = 8;
const AUTO_COMPACTION_THRESHOLD = 14;
const AUTO_COMPACTION_REFRESH_MARGIN = 4;
const TRANSCRIPT_CHAR_LIMIT = 14_000;

function truncateText(value: string, limit: number) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated]`;
}

function compactWhitespace(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function summarizeMessageForHistory(message: Pick<ChatMessage, "content" | "attachments">) {
  const parts = [compactWhitespace(message.content)];
  const imageCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
  if (imageCount > 0) {
    parts.push(`[Attached ${imageCount} image${imageCount > 1 ? "s" : ""}]`);
  }
  return parts.filter(Boolean).join(" ");
}

function formatTranscript(messages: ChatMessage[]) {
  return truncateText(
    messages
      .map((message, index) => {
        const prefix = message.role === "user" ? "USER" : "ASSISTANT";
        return `${index + 1}. ${prefix}: ${summarizeMessageForHistory(message)}`;
      })
      .join("\n"),
    TRANSCRIPT_CHAR_LIMIT,
  );
}

function fallbackSummary(messages: ChatMessage[], instructions?: string) {
  const recent = messages
    .slice(-6)
    .map((message) => `${message.role}: ${summarizeMessageForHistory(message)}`)
    .filter(Boolean);

  const lines = [
    "Compacted session summary:",
    instructions ? `Focus: ${compactWhitespace(instructions)}` : "",
    ...recent.map((line) => `- ${line}`),
  ].filter(Boolean);

  return truncateText(lines.join("\n"), 1_800);
}

async function summarizeMessages(params: {
  messages: ChatMessage[];
  config?: LlmRuntimeConfig;
  instructions?: string;
}) {
  const fallback = fallbackSummary(params.messages, params.instructions);
  if (!hasLlmAccess(params.config)) {
    return fallback;
  }

  const result = await completeTextDetailed(
    [
      {
        role: "system",
        content: [
          "You summarize chat sessions for later LLM context restoration.",
          "Preserve only stable facts: user intent, decisions, constraints, installed skills, automations, unresolved questions, and promised follow-up.",
          "Do not add new facts.",
          "Keep it compact and factual.",
          "Output plain text only.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          params.instructions
            ? `Compaction focus: ${compactWhitespace(params.instructions)}`
            : "",
          "Summarize this transcript for future assistant context:",
          formatTranscript(params.messages),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    () => fallback,
    params.config,
  );

  return compactWhitespace(result.value) || fallback;
}

function shouldCompact(params: {
  conversation: ConversationRecord;
  force?: boolean;
  keepTail?: number;
}) {
  const keepTail = Math.max(1, params.keepTail || COMPACTION_KEEP_TAIL);
  const sourceCount = Math.max(0, params.conversation.messages.length - keepTail);
  if (sourceCount < 2) {
    return false;
  }
  if (params.force) {
    return true;
  }
  if (sourceCount < AUTO_COMPACTION_THRESHOLD) {
    return false;
  }
  const previous = params.conversation.compaction?.sourceMessageCount || 0;
  return sourceCount >= previous + AUTO_COMPACTION_REFRESH_MARGIN;
}

export async function compactConversationIfNeeded(params: {
  conversation: ConversationRecord;
  config?: LlmRuntimeConfig;
  force?: boolean;
  instructions?: string;
  keepTail?: number;
}): Promise<{
  conversation: ConversationRecord;
  compacted: boolean;
  summaryUsed: boolean;
}> {
  const keepTail = Math.max(1, params.keepTail || COMPACTION_KEEP_TAIL);
  if (!shouldCompact(params)) {
    return {
      conversation: params.conversation,
      compacted: false,
      summaryUsed: Boolean(params.conversation.compaction?.summary),
    };
  }

  const sourceMessages = params.conversation.messages.slice(
    0,
    Math.max(0, params.conversation.messages.length - keepTail),
  );
  if (sourceMessages.length < 2) {
    return {
      conversation: params.conversation,
      compacted: false,
      summaryUsed: Boolean(params.conversation.compaction?.summary),
    };
  }

  const summary = await summarizeMessages({
    messages: sourceMessages,
    config: params.config,
    instructions: params.instructions,
  });

  const compaction: ConversationCompaction = {
    summary,
    updatedAt: Date.now(),
    sourceMessageCount: sourceMessages.length,
    count: (params.conversation.compaction?.count || 0) + 1,
    instructions: compactWhitespace(params.instructions || "") || undefined,
  };

  return {
    conversation: {
      ...params.conversation,
      compaction,
    },
    compacted: true,
    summaryUsed: true,
  };
}

export function buildConversationHistory(
  conversation: ConversationRecord,
  keepTail = COMPACTION_KEEP_TAIL,
) {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (conversation.compaction?.summary) {
    history.push({
      role: "assistant",
      content: [
        "[Compacted session summary]",
        conversation.compaction.summary,
      ].join("\n"),
    });
  }

  const tail = conversation.messages.slice(-Math.max(1, keepTail));
  history.push(
    ...tail.map((message) => ({
      role: message.role,
      content: summarizeMessageForHistory(message),
    })),
  );

  return history;
}
