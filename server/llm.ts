import "./env";
import type { ProviderMode } from "../src/types";
import { getProviderCatalogItem } from "../src/types";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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
};

function resolveEnv(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function pickNonEmpty(primary?: string, fallback = "") {
  return String(primary || "").trim() || fallback;
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
      return "";
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

  const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: mode === "builder" ? 0.6 : 0.8,
      messages,
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
    .map((message) => message.content)
    .join("\n\n")
    .trim();
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  const response = await fetch(`${runtime.baseUrl}/messages`, {
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
    .map((message) => message.content)
    .join("\n\n")
    .trim();
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const response = await fetch(
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

  const response = await fetch(`${ZHIPUAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: runtime.glmModel,
      messages,
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
      trace: resolveTrace(
        config,
        "fallback",
        String(error?.message || error || "llm_request_failed"),
      ),
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
      trace: resolveTrace(
        config,
        "fallback",
        String(error?.message || error || "llm_request_failed"),
      ),
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
