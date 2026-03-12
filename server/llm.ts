import "./env";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ProviderMode = "glm-main" | "openai-compatible";
type GenerationMode = "llm" | "fallback";

export type LlmRuntimeConfig = {
  providerMode?: ProviderMode;
  glmModel?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
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

function resolveRuntimeConfig(config?: LlmRuntimeConfig) {
  const apiKey = pickNonEmpty(config?.apiKey, resolveEnv("OPENAI_API_KEY"));
  return {
    providerMode:
      config?.providerMode === "glm-main" || config?.providerMode === "openai-compatible"
        ? config.providerMode
        : apiKey
          ? "openai-compatible"
          : "glm-main",
    glmModel: pickNonEmpty(
      config?.glmModel,
      resolveEnv("LIBERTH_NEURAL_GLM_MODEL", DEFAULT_GLM_MODEL),
    ),
    apiKey,
    baseUrl: pickNonEmpty(
      config?.baseUrl,
      resolveEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    ).replace(/\/+$/, ""),
    model: pickNonEmpty(config?.model, resolveEnv("OPENAI_MODEL", "gpt-4.1-mini")),
  };
}

function resolveGlmApiKey() {
  return (
    resolveEnv("ZHIPUAI_API_KEY") ||
    resolveEnv("GLM_API_KEY") ||
    resolveEnv("BIGMODEL_API_KEY")
  );
}

function hasGlmAccess() {
  return Boolean(resolveGlmApiKey());
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
  if (runtime.providerMode === "glm-main") {
    return hasGlmAccess();
  }
  return Boolean(runtime.apiKey);
}

async function openAiCompatibleChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  const apiKey = runtime.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const specificBuilderModel =
    mode === "builder" ? resolveEnv("CHARACTER_BUILDER_MODEL") : "";
  const model = specificBuilderModel || runtime.model;

  const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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

async function mainProjectGlmChat(
  messages: ChatMessage[],
  mode: "builder" | "chat",
  config?: LlmRuntimeConfig,
) {
  const runtime = resolveRuntimeConfig(config);
  const apiKey = resolveGlmApiKey();
  if (!apiKey) {
    throw new Error("ZHIPUAI_API_KEY is not configured");
  }

  const response = await fetch(`${ZHIPUAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    const runtime = resolveRuntimeConfig(config);
    const output =
      runtime.providerMode === "glm-main"
        ? await mainProjectGlmChat(messages, "builder", config)
        : await openAiCompatibleChat(messages, "builder", config);
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
    const runtime = resolveRuntimeConfig(config);
    const output =
      runtime.providerMode === "glm-main"
        ? await mainProjectGlmChat(messages, "chat", config)
        : await openAiCompatibleChat(messages, "chat", config);
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
