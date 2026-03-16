import "./env";
import type { ChatAttachment, ProviderMode } from "../src/types";
import { getProviderCatalogItem } from "../src/types";

export type LlmImagePart = {
  type: "image";
  mimeType: string;
  dataUrl: string;
};

export type LlmTextPart = {
  type: "text";
  text: string;
};

export type LlmContentPart = LlmTextPart | LlmImagePart;
export type LlmMessageContent = string | LlmContentPart[];

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: LlmMessageContent;
};

export type LlmToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LlmToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  callId?: string;
};

export type LlmConversationMessage =
  | {
      role: "system" | "user";
      content: LlmMessageContent;
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: LlmToolCall[];
    }
  | {
      role: "tool";
      content: string;
      toolName: string;
      toolCallId?: string;
    };

type ProviderApiStyle = "glm-main" | "openai-compatible" | "anthropic" | "google-gemini";
type GenerationMode = "llm" | "fallback";

export type LlmRuntimeConfig = {
  providerMode?: ProviderMode;
  glmModel?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  anthropicVersion?: string;
  googleApiVersion?: string;
};

const DEFAULT_GLM_MODEL = "glm-4-flash-250414";
const ZHIPUAI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export type CompletionTrace = {
  mode: GenerationMode;
  providerMode: ProviderMode;
  model: string;
  reason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  nativeTools?: boolean;
};

type UsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

function resolveEnv(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function pickNonEmpty(primary?: string, fallback = "") {
  return String(primary || "").trim() || fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryFetchError(error: unknown) {
  const message = String((error as any)?.message || "").toLowerCase();
  const causeMessage = String((error as any)?.cause?.message || "").toLowerCase();
  const detail = `${message} ${causeMessage}`.trim();
  if (!detail) return false;
  return (
    detail.includes("fetch failed")
    || detail.includes("networkerror")
    || detail.includes("timeout")
    || detail.includes("timed out")
    || detail.includes("socket")
    || detail.includes("econnreset")
    || detail.includes("enotfound")
    || detail.includes("eai_again")
  );
}

function describeLlmError(error: unknown) {
  const message = String((error as any)?.message || error || "llm_request_failed").trim();
  const causeMessage = String((error as any)?.cause?.message || "").trim();
  if (causeMessage && !message.includes(causeMessage)) {
    return `${message}: ${causeMessage}`;
  }
  return message || "llm_request_failed";
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetryFetchError(error)) {
        throw error;
      }
      await sleep(250 * attempt);
    }
  }
  throw lastError || new Error("fetch failed");
}

function providerApiStyle(mode: ProviderMode): ProviderApiStyle {
  return getProviderCatalogItem(mode).apiStyle;
}

function envPrefixForMode(mode: ProviderMode) {
  switch (mode) {
    case "openrouter":
      return "OPENROUTER";
    case "deepseek":
      return "DEEPSEEK";
    case "siliconflow":
      return "SILICONFLOW";
    case "groq":
      return "GROQ";
    case "ollama":
      return "OLLAMA";
    case "anthropic":
      return "ANTHROPIC";
    case "google-gemini":
      return "GOOGLE";
    case "openai-compatible":
      return "OPENAI";
    default:
      return "OPENAI";
  }
}

function resolveApiKeyForMode(mode: ProviderMode, explicit?: string) {
  const direct = pickNonEmpty(explicit);
  if (direct) return direct;

  switch (mode) {
    case "glm-main":
      return (
        resolveEnv("GLM_API_KEY")
        || resolveEnv("ZHIPUAI_API_KEY")
        || resolveEnv("BIGMODEL_API_KEY")
      );
    case "openrouter":
      return resolveEnv("OPENROUTER_API_KEY");
    case "deepseek":
      return resolveEnv("DEEPSEEK_API_KEY");
    case "siliconflow":
      return resolveEnv("SILICONFLOW_API_KEY");
    case "groq":
      return resolveEnv("GROQ_API_KEY");
    case "anthropic":
      return resolveEnv("ANTHROPIC_API_KEY");
    case "google-gemini":
      return resolveEnv("GOOGLE_API_KEY") || resolveEnv("GEMINI_API_KEY");
    case "ollama":
      return "";
    case "openai-compatible":
    default:
      return resolveEnv("OPENAI_API_KEY");
  }
}

function resolveRuntimeConfig(config?: LlmRuntimeConfig) {
  const requestedMode = config?.providerMode;
  const providerMode: ProviderMode =
    requestedMode && getProviderCatalogItem(requestedMode).id === requestedMode
      ? requestedMode
      : resolveEnv("OPENAI_API_KEY")
        ? "openai-compatible"
        : "glm-main";
  const prefix = envPrefixForMode(providerMode);
  const preset = getProviderCatalogItem(providerMode);

  return {
    providerMode,
    apiStyle: providerApiStyle(providerMode),
    glmModel: pickNonEmpty(
      config?.glmModel,
      resolveEnv("LIBERTH_NEURAL_GLM_MODEL", DEFAULT_GLM_MODEL),
    ),
    apiKey: resolveApiKeyForMode(providerMode, config?.apiKey),
    baseUrl: pickNonEmpty(
      config?.baseUrl,
      resolveEnv(`${prefix}_BASE_URL`, preset.defaultBaseUrl || ""),
    ).replace(/\/+$/, ""),
    model: pickNonEmpty(
      config?.model,
      resolveEnv(`${prefix}_MODEL`, preset.defaultModel),
    ),
    anthropicVersion: pickNonEmpty(
      config?.anthropicVersion,
      resolveEnv("ANTHROPIC_VERSION", "2023-06-01"),
    ),
    googleApiVersion: pickNonEmpty(
      config?.googleApiVersion,
      resolveEnv("GOOGLE_API_VERSION", "v1beta"),
    ),
  };
}

function resolveTrace(config?: LlmRuntimeConfig, mode: GenerationMode = "llm", reason?: string): CompletionTrace {
  const runtime = resolveRuntimeConfig(config);
  return {
    mode,
    providerMode: runtime.providerMode,
    model: runtime.providerMode === "glm-main" ? runtime.glmModel : runtime.model,
    ...(reason ? { reason } : {}),
  };
}

function resolveTraceWithUsage(
  config: LlmRuntimeConfig | undefined,
  mode: GenerationMode,
  options?: {
    reason?: string;
    usage?: UsageSnapshot;
    nativeTools?: boolean;
  },
): CompletionTrace {
  return {
    ...resolveTrace(config, mode, options?.reason),
    ...(options?.usage || {}),
    ...(options?.nativeTools === undefined ? {} : { nativeTools: options.nativeTools }),
  };
}

function normalizeUsage(
  input?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } | null,
): UsageSnapshot {
  if (!input || typeof input !== "object") {
    return {};
  }

  const inputTokens = Number(
    input.prompt_tokens ?? input.input_tokens ?? input.promptTokenCount ?? 0,
  );
  const outputTokens = Number(
    input.completion_tokens ?? input.output_tokens ?? input.candidatesTokenCount ?? 0,
  );
  const totalTokens = Number(
    input.total_tokens ?? input.totalTokenCount ?? (inputTokens + outputTokens) ?? 0,
  );

  return {
    ...(Number.isFinite(inputTokens) && inputTokens > 0 ? { inputTokens } : {}),
    ...(Number.isFinite(outputTokens) && outputTokens > 0 ? { outputTokens } : {}),
    ...(Number.isFinite(totalTokens) && totalTokens > 0 ? { totalTokens } : {}),
  };
}

function safeParseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeOpenAiTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item: any) => String(item?.text || item?.content || "").trim())
    .filter(Boolean)
    .join("\n");
}

function getBase64PayloadFromDataUrl(dataUrl: string) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  return {
    mimeType: String(match[1] || "").trim().toLowerCase(),
    base64: String(match[2] || "").trim(),
  };
}

function normalizeMessageTextContent(content: LlmMessageContent) {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is LlmTextPart => part.type === "text")
    .map((part) => String(part.text || ""))
    .filter(Boolean)
    .join("\n");
}

function normalizeMessageContentParts(content: LlmMessageContent): LlmContentPart[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  return content.filter((part) => {
    if (!part || typeof part !== "object") return false;
    if (part.type === "text") {
      return Boolean(String(part.text || "").trim());
    }
    if (part.type === "image") {
      return Boolean(String(part.mimeType || "").trim() && String(part.dataUrl || "").trim());
    }
    return false;
  });
}

function toAnthropicContent(content: LlmMessageContent) {
  const parts = normalizeMessageContentParts(content);
  if (!parts.length) {
    return "";
  }
  return parts.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    const image = getBase64PayloadFromDataUrl(part.dataUrl);
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mimeType || image.mimeType,
        data: image.base64,
      },
    };
  });
}

function toOpenAiMessageContent(content: LlmMessageContent) {
  const parts = normalizeMessageContentParts(content);
  if (!parts.some((part) => part.type === "image")) {
    return normalizeMessageTextContent(content);
  }
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          image_url: {
            url: part.dataUrl,
          },
        },
  );
}

function toGeminiMessageParts(content: LlmMessageContent) {
  const parts = normalizeMessageContentParts(content);
  if (!parts.length) {
    return [{ text: "" }];
  }
  return parts.map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }
    const image = getBase64PayloadFromDataUrl(part.dataUrl);
    return {
      inlineData: {
        mimeType: part.mimeType || image.mimeType,
        data: image.base64,
      },
    };
  });
}

export function buildUserMessageContent(
  text: string,
  attachments?: ChatAttachment[] | null,
): LlmMessageContent {
  const normalizedText = String(text || "").trim();
  const imageParts = (attachments || [])
    .filter((attachment) => attachment?.kind === "image")
    .map(
      (attachment): LlmImagePart => ({
        type: "image",
        mimeType: String(attachment.mimeType || "").trim(),
        dataUrl: String(attachment.dataUrl || "").trim(),
      }),
    )
    .filter((part) => part.mimeType && part.dataUrl);

  if (!imageParts.length) {
    return normalizedText;
  }

  return [
    ...(normalizedText ? [{ type: "text", text: normalizedText } satisfies LlmTextPart] : []),
    ...imageParts,
  ];
}

export function supportsNativeToolCalling(config?: LlmRuntimeConfig) {
  const runtime = resolveRuntimeConfig(config);
  return (
    runtime.apiStyle === "openai-compatible" ||
    runtime.apiStyle === "anthropic" ||
    runtime.apiStyle === "google-gemini" ||
    runtime.apiStyle === "glm-main"
  );
}

export function hasLlmAccess(config?: LlmRuntimeConfig) {
  const runtime = resolveRuntimeConfig(config);
  if (runtime.providerMode === "ollama") {
    return Boolean(runtime.baseUrl && runtime.model);
  }
  return Boolean(runtime.apiKey);
}

async function openAiCompatibleChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  const specificBuilderModel =
    mode === "builder" ? resolveEnv("CHARACTER_BUILDER_MODEL") : "";
  const model = specificBuilderModel || runtime.model;
  const requiresApiKey = runtime.providerMode !== "ollama";
  if (requiresApiKey && !runtime.apiKey) {
    throw new Error(`${runtime.providerMode} API key is not configured`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (runtime.apiKey) {
    headers.Authorization = `Bearer ${runtime.apiKey}`;
  }
  if (runtime.providerMode === "openrouter") {
    headers["HTTP-Referer"] = resolveEnv(
      "PUBLIC_BASE_URL",
      "https://github.com/Libre-Connect/liberth-neural",
    );
    headers["X-Title"] = "Liberth Neural";
  }

  const response = await fetchWithRetry(`${runtime.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: mode === "builder" ? 0.6 : 0.8,
      messages: messages.map((message) => ({
        role: message.role,
        content: toOpenAiMessageContent(message.content),
      })),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const content = payload?.choices?.[0]?.message?.content;
  return String(content || "").trim();
}

async function anthropicChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  if (!runtime.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const specificBuilderModel =
    mode === "builder" ? resolveEnv("CHARACTER_BUILDER_MODEL") : "";
  const model = specificBuilderModel || runtime.model;
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => normalizeMessageTextContent(message.content))
    .join("\n\n")
    .trim();
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content:
        message.role === "assistant"
          ? normalizeMessageTextContent(message.content)
          : toAnthropicContent(message.content),
    }));

  const response = await fetchWithRetry(`${runtime.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": runtime.apiKey,
      "anthropic-version": runtime.anthropicVersion,
    },
    body: JSON.stringify({
      model,
      system: system || undefined,
      messages: conversation,
      temperature: mode === "builder" ? 0.45 : 0.8,
      max_tokens: mode === "builder" ? 1400 : 1000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const content = Array.isArray(payload?.content)
    ? payload.content
        .map((part: any) => String(part?.text || "").trim())
        .filter(Boolean)
        .join("\n")
    : "";
  return content;
}

async function googleGeminiChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  if (!runtime.apiKey) {
    throw new Error("GOOGLE_API_KEY is not configured");
  }

  const specificBuilderModel =
    mode === "builder" ? resolveEnv("CHARACTER_BUILDER_MODEL") : "";
  const model = specificBuilderModel || runtime.model;
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => normalizeMessageTextContent(message.content))
    .join("\n\n")
    .trim();
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts:
        message.role === "assistant"
          ? [{ text: normalizeMessageTextContent(message.content) }]
          : toGeminiMessageParts(message.content),
    }));

  const response = await fetchWithRetry(
    `${runtime.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(system
          ? {
              systemInstruction: {
                parts: [{ text: system }],
              },
            }
          : {}),
        contents,
        generationConfig: {
          temperature: mode === "builder" ? 0.45 : 0.8,
          maxOutputTokens: mode === "builder" ? 1400 : 1000,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const content = Array.isArray(payload?.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
        .map((part: any) => String(part?.text || "").trim())
        .filter(Boolean)
        .join("\n")
    : "";
  return content;
}

async function mainProjectGlmChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  if (!runtime.apiKey) {
    throw new Error("GLM API key is not configured");
  }

  const response = await fetchWithRetry(`${ZHIPUAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: runtime.glmModel,
      messages: messages.map((message) => ({
        role: message.role,
        content: toOpenAiMessageContent(message.content),
      })),
      temperature: mode === "builder" ? 0.35 : 0.8,
      max_tokens: mode === "builder" ? 1400 : 1000,
      top_p: mode === "builder" ? 0.8 : 0.95,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GLM request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const content = payload?.choices?.[0]?.message?.content;
  return String(content || "").trim();
}

async function runProviderChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  switch (runtime.apiStyle) {
    case "anthropic":
      return anthropicChat(messages, mode, config);
    case "google-gemini":
      return googleGeminiChat(messages, mode, config);
    case "glm-main":
      return mainProjectGlmChat(messages, mode, config);
    case "openai-compatible":
    default:
      return openAiCompatibleChat(messages, mode, config);
  }
}

function toOpenAiToolSchema(tool: LlmToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function mapOpenAiConversationMessages(messages: LlmConversationMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId || message.toolName,
        content: message.content,
      };
    }

    if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.callId || `${toolCall.name}_call`,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments || {}),
          },
        })),
      };
    }

    return {
      role: message.role,
      content: toOpenAiMessageContent(message.content),
    };
  });
}

async function openAiCompatibleChatWithTools(
  messages: LlmConversationMessage[],
  tools: LlmToolDefinition[],
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  const isGlmMain = runtime.apiStyle === "glm-main";
  const requiresApiKey = runtime.providerMode !== "ollama";
  if (requiresApiKey && !runtime.apiKey) {
    throw new Error(`${runtime.providerMode} API key is not configured`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (runtime.apiKey) {
    headers.Authorization = `Bearer ${runtime.apiKey}`;
  }
  if (runtime.providerMode === "openrouter") {
    headers["HTTP-Referer"] = resolveEnv(
      "PUBLIC_BASE_URL",
      "https://github.com/Libre-Connect/liberth-neural",
    );
    headers["X-Title"] = "Liberth Neural";
  }

  const response = await fetchWithRetry(
    isGlmMain ? `${ZHIPUAI_BASE_URL}/chat/completions` : `${runtime.baseUrl}/chat/completions`,
    {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: isGlmMain ? runtime.glmModel : runtime.model,
      temperature: 0.8,
      messages: mapOpenAiConversationMessages(messages),
      ...(tools.length
        ? {
            tools: tools.map(toOpenAiToolSchema),
            tool_choice: "auto",
          }
        : {}),
    }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM tool request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const message = payload?.choices?.[0]?.message || {};
  const toolCall = message?.tool_calls?.[0]
    ? {
        name: String(message.tool_calls[0]?.function?.name || "").trim(),
        arguments: safeParseToolArguments(message.tool_calls[0]?.function?.arguments),
        callId: String(message.tool_calls[0]?.id || "").trim() || undefined,
      }
    : null;

  return {
    content: normalizeOpenAiTextContent(message?.content),
    toolCall,
    usage: normalizeUsage(payload?.usage),
  };
}

function mapAnthropicConversation(messages: LlmConversationMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => normalizeMessageTextContent(message.content))
    .join("\n\n")
    .trim();

  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId || message.toolName,
              content: message.content,
              is_error: false,
            },
          ],
        };
      }

      if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
        const blocks: any[] = [];
        if (message.content.trim()) {
          blocks.push({ type: "text", text: message.content.trim() });
        }
        for (const toolCall of message.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: toolCall.callId || `${toolCall.name}_call`,
            name: toolCall.name,
            input: toolCall.arguments || {},
          });
        }
        return {
          role: "assistant",
          content: blocks,
        };
      }

      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content:
          message.role === "assistant"
            ? normalizeMessageTextContent(message.content)
            : toAnthropicContent(message.content),
      };
    });

  return { system, conversation };
}

async function anthropicChatWithTools(
  messages: LlmConversationMessage[],
  tools: LlmToolDefinition[],
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  if (!runtime.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const mapped = mapAnthropicConversation(messages);
  const response = await fetchWithRetry(`${runtime.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": runtime.apiKey,
      "anthropic-version": runtime.anthropicVersion,
    },
    body: JSON.stringify({
      model: runtime.model,
      system: mapped.system || undefined,
      messages: mapped.conversation,
      temperature: 0.8,
      max_tokens: 1000,
      ...(tools.length
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema,
            })),
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic tool request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks
    .filter((block: any) => String(block?.type || "").trim() === "text")
    .map((block: any) => String(block?.text || "").trim())
    .filter(Boolean)
    .join("\n");
  const toolUse = blocks.find((block: any) => String(block?.type || "").trim() === "tool_use");

  return {
    content: text,
    toolCall: toolUse
      ? {
          name: String(toolUse.name || "").trim(),
          arguments:
            toolUse.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input)
              ? toolUse.input
              : {},
          callId: String(toolUse.id || "").trim() || undefined,
        }
      : null,
    usage: normalizeUsage(payload?.usage),
  };
}

function mapGeminiConversation(messages: LlmConversationMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => normalizeMessageTextContent(message.content))
    .join("\n\n")
    .trim();

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: message.toolName,
                response: {
                  name: message.toolName,
                  content: message.content,
                },
              },
            },
          ],
        };
      }

      if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
        const parts: any[] = [];
        if (message.content.trim()) {
          parts.push({ text: message.content.trim() });
        }
        for (const toolCall of message.toolCalls) {
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: toolCall.arguments || {},
            },
          });
        }
        return {
          role: "model",
          parts,
        };
      }

      return {
        role: message.role === "assistant" ? "model" : "user",
        parts:
          message.role === "assistant"
            ? [{ text: normalizeMessageTextContent(message.content) }]
            : toGeminiMessageParts(message.content),
      };
    });

  return { system, contents };
}

async function googleGeminiChatWithTools(
  messages: LlmConversationMessage[],
  tools: LlmToolDefinition[],
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  if (!runtime.apiKey) {
    throw new Error("GOOGLE_API_KEY is not configured");
  }

  const mapped = mapGeminiConversation(messages);
  const response = await fetchWithRetry(
    `${runtime.baseUrl}/models/${encodeURIComponent(runtime.model)}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(mapped.system
          ? {
              systemInstruction: {
                parts: [{ text: mapped.system }],
              },
            }
          : {}),
        contents: mapped.contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1000,
        },
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  })),
                },
              ],
              toolConfig: {
                functionCallingConfig: {
                  mode: "AUTO",
                },
              },
            }
          : {}),
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini tool request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as any;
  const parts = Array.isArray(payload?.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
    : [];
  const content = parts
    .map((part: any) => String(part?.text || "").trim())
    .filter(Boolean)
    .join("\n");
  const functionCallPart = parts.find((part: any) => part?.functionCall);

  return {
    content,
    toolCall: functionCallPart?.functionCall
      ? {
          name: String(functionCallPart.functionCall.name || "").trim(),
          arguments:
            functionCallPart.functionCall.args
            && typeof functionCallPart.functionCall.args === "object"
            && !Array.isArray(functionCallPart.functionCall.args)
              ? functionCallPart.functionCall.args
              : {},
        }
      : null,
    usage: normalizeUsage(payload?.usageMetadata),
  };
}

export async function completeTextWithToolsDetailed(params: {
  messages: LlmConversationMessage[];
  tools: LlmToolDefinition[];
  fallback: () => string;
  config?: LlmRuntimeConfig;
}): Promise<{ value: string; trace: CompletionTrace; toolCall: LlmToolCall | null }> {
  if (!hasLlmAccess(params.config)) {
    return {
      value: params.fallback(),
      trace: resolveTraceWithUsage(params.config, "fallback", {
        reason: "no_llm_access",
        nativeTools: true,
      }),
      toolCall: null,
    };
  }

  try {
    const runtime = resolveRuntimeConfig(params.config);
    const result =
      runtime.apiStyle === "anthropic"
        ? await anthropicChatWithTools(params.messages, params.tools, params.config)
        : runtime.apiStyle === "google-gemini"
          ? await googleGeminiChatWithTools(params.messages, params.tools, params.config)
          : await openAiCompatibleChatWithTools(params.messages, params.tools, params.config);

    return {
      value: result.content || params.fallback(),
      trace: resolveTraceWithUsage(params.config, "llm", {
        usage: result.usage,
        nativeTools: true,
      }),
      toolCall: result.toolCall && result.toolCall.name ? result.toolCall : null,
    };
  } catch (error: any) {
    return {
      value: params.fallback(),
      trace: resolveTraceWithUsage(params.config, "fallback", {
        reason: describeLlmError(error),
        nativeTools: true,
      }),
      toolCall: null,
    };
  }
}

export async function completeJsonDetailed<T>(
  messages: ChatMessage[],
  fallback: () => T,
  config?: LlmRuntimeConfig,
): Promise<{ value: T; trace: CompletionTrace }> {
  if (!hasLlmAccess(config)) {
    return {
      value: fallback(),
      trace: resolveTrace(config, "fallback", "no_llm_access"),
    };
  }

  try {
    const output = await runProviderChat(messages, "builder", config);
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        value: fallback(),
        trace: resolveTrace(config, "fallback", "json_not_found"),
      };
    }
    return {
      value: JSON.parse(match[0]) as T,
      trace: resolveTrace(config, "llm"),
    };
  } catch (error: any) {
    return {
      value: fallback(),
      trace: resolveTrace(config, "fallback", describeLlmError(error)),
    };
  }
}

export async function completeJson<T>(
  messages: ChatMessage[],
  fallback: () => T,
  config?: LlmRuntimeConfig,
): Promise<T> {
  const result = await completeJsonDetailed(messages, fallback, config);
  return result.value;
}

export async function completeTextDetailed(
  messages: ChatMessage[],
  fallback: () => string,
  config?: LlmRuntimeConfig,
): Promise<{ value: string; trace: CompletionTrace }> {
  if (!hasLlmAccess(config)) {
    return {
      value: fallback(),
      trace: resolveTrace(config, "fallback", "no_llm_access"),
    };
  }

  try {
    const output = await runProviderChat(messages, "chat", config);
    return {
      value: output || fallback(),
      trace: resolveTrace(config, "llm"),
    };
  } catch (error: any) {
    return {
      value: fallback(),
      trace: resolveTrace(config, "fallback", describeLlmError(error)),
    };
  }
}

export async function completeText(
  messages: ChatMessage[],
  fallback: () => string,
  config?: LlmRuntimeConfig,
): Promise<string> {
  const result = await completeTextDetailed(messages, fallback, config);
  return result.value;
}
