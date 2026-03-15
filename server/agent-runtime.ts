import { promises as fs } from "fs";
import type {
  AutomationRecord,
  CharacterRecord,
  SearchResultRecord,
} from "../src/types";
import type {
  CompletionTrace,
  LlmConversationMessage,
  LlmRuntimeConfig,
  LlmToolDefinition,
} from "./llm";
import {
  completeTextWithToolsDetailed,
  supportsNativeToolCalling,
} from "./llm";
import { generateRoleReplyDetailed } from "./roles";
import { searchWeb } from "./search";
import {
  attachSkillToCharacter,
  ensureSkillInstalled,
  findSkillById,
  listSkillCatalog,
  resolveCharacterSkills,
} from "./skills";
import { createOrUpdateAutomation } from "./automation";
import { readStore, updateStore, upsertInstalledSkill } from "./store";

type ToolName =
  | "web_search"
  | "search_skills"
  | "list_attached_skills"
  | "read_skill"
  | "install_skill"
  | "create_automation"
  | "list_automations";

type ToolEvent = {
  step: number;
  tool: ToolName;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary: string;
};

type ToolExecutionContext = {
  character: CharacterRecord;
  config?: LlmRuntimeConfig;
  allowMutatingTools: boolean;
};

type ToolExecutionResult = {
  ok: boolean;
  summary: string;
  searchResults?: SearchResultRecord[];
  automation?: AutomationRecord;
};

type RoleAgentTurnInput = {
  character: CharacterRecord;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  config?: LlmRuntimeConfig;
  allowMutatingTools?: boolean;
};

type RoleAgentTurnResult = {
  reply: string;
  generation: CompletionTrace;
  toolEvents: ToolEvent[];
  searchResults: SearchResultRecord[];
};

type ToolSpec = {
  name: ToolName;
  args: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const TOOL_LOOP_MAX_STEPS = 4;
const TOOL_RESULT_CHAR_LIMIT = 12_000;
const SKILL_CONTENT_CHAR_LIMIT = 8_000;

function serializeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function truncateText(value: string, limit: number) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated]`;
}

function normalizePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function buildToolSpecs(allowMutatingTools: boolean): ToolSpec[] {
  return [
    {
      name: "web_search",
      args: '{ "query": "string", "count": 1-8, "language": "optional string" }',
      description: "Search the web and return result snippets with URLs.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 8 },
          language: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "search_skills",
      args: '{ "query": "string" }',
      description: "Use AI to rewrite a software capability need into search keywords, then search installable external skills.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "list_attached_skills",
      args: "{}",
      description: "List skills already attached to this character workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "read_skill",
      args: '{ "skillId": "string" }',
      description: "Read the selected skill instructions so you can use it correctly.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: { type: "string" },
        },
        required: ["skillId"],
        additionalProperties: false,
      },
    },
    ...(allowMutatingTools
      ? [
          {
            name: "install_skill" as const,
            args: '{ "skillId": "string", "packageRef": "optional owner/repo@skill string" }',
            description: "Install and attach a visible skill into this character workspace. Use packageRef for external search results.",
            inputSchema: {
              type: "object",
              properties: {
                skillId: { type: "string" },
                packageRef: { type: "string" },
              },
              required: ["skillId"],
              additionalProperties: false,
            },
          },
          {
            name: "create_automation" as const,
            args: '{ "name": "string", "prompt": "string", "intervalMinutes": number }',
            description: "Create a recurring automation for this character.",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string" },
                prompt: { type: "string" },
                intervalMinutes: { type: "integer", minimum: 1, maximum: 10080 },
              },
              required: ["name", "prompt", "intervalMinutes"],
              additionalProperties: false,
            },
          },
        ]
      : []),
    {
      name: "list_automations",
      args: "{}",
      description: "List automations already configured for this character.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

function buildLegacyToolPrompt(allowMutatingTools: boolean) {
  const tools = buildToolSpecs(allowMutatingTools);
  return [
    "## BUILTIN_TOOLS.md",
    "You are running inside an OpenClaw-like tool runtime with typed built-in tools.",
    "If a tool is needed, respond with exactly one tool call and no extra prose.",
    "Tool call format:",
    '<tool_call>{"tool":"web_search","arguments":{"query":"OpenClaw skills docs","count":5}}</tool_call>',
    "Rules:",
    "- Emit at most one tool call per assistant message.",
    "- Wait for the tool result before making another tool call.",
    "- Do not repeat the same tool call with identical arguments unless the user explicitly asks.",
    "- Prefer no more than 3 tool calls before giving the final answer.",
    "- If no tool is needed, answer normally.",
    "Available tools:",
    ...tools.map(
      (tool) => `- ${tool.name}: ${tool.description} Args: ${tool.args}`,
    ),
  ].join("\n");
}

function buildNativeToolPrompt(allowMutatingTools: boolean) {
  const tools = buildToolSpecs(allowMutatingTools);
  return [
    "## BUILTIN_TOOLS.md",
    "You are running inside an OpenClaw-like tool runtime with typed built-in tools.",
    "When a tool is genuinely needed, call exactly one native tool.",
    "Wait for the tool result before requesting another tool.",
    "Do not claim tool execution without a real tool result.",
    "If no tool is needed, answer normally.",
    "Prefer no more than 3 tool calls before the final answer.",
    "Available tools:",
    ...tools.map(
      (tool) => `- ${tool.name}: ${tool.description} Args: ${tool.args}`,
    ),
  ].join("\n");
}

function buildNativeTools(allowMutatingTools: boolean): LlmToolDefinition[] {
  return buildToolSpecs(allowMutatingTools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function parseJsonBlock(rawValue: string) {
  return rawValue
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeToolCall(parsed: {
  tool?: ToolName;
  arguments?: Record<string, unknown>;
}) {
  if (!parsed?.tool) return null;
  return {
    tool: parsed.tool,
    arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {},
  };
}

function extractToolCall(reply: string): { tool: ToolName; arguments: Record<string, unknown> } | null {
  const text = String(reply || "").trim();
  if (!text) return null;

  const taggedMatch = text.match(/<tool_call>\s*([\s\S]+?)\s*<\/tool_call>/i);
  if (taggedMatch) {
    return normalizeToolCall(
      JSON.parse(parseJsonBlock(taggedMatch[1])) as {
        tool?: ToolName;
        arguments?: Record<string, unknown>;
      },
    );
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    const parsed = JSON.parse(parseJsonBlock(text)) as {
      tool?: ToolName;
      arguments?: Record<string, unknown>;
    };
    const normalized = normalizeToolCall(parsed);
    if (normalized) return normalized;
  }

  const lineMatch = text.match(
    /^([a-z_]+)\s*\n\s*(\{[\s\S]*\})$/i,
  );
  if (lineMatch) {
    return {
      tool: lineMatch[1] as ToolName,
      arguments: JSON.parse(parseJsonBlock(lineMatch[2])) as Record<string, unknown>,
    };
  }

  const compactMatch = text.match(/^([a-z_]+)\s*(\{[\s\S]*\})$/i);
  if (compactMatch) {
    return {
      tool: compactMatch[1] as ToolName,
      arguments: JSON.parse(parseJsonBlock(compactMatch[2])) as Record<string, unknown>,
    };
  }

  return null;
}

function dedupeSearchResults(results: SearchResultRecord[]) {
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = String(item.url || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatToolResultBlock(
  tool: ToolName,
  args: Record<string, unknown>,
  result: ToolExecutionResult,
) {
  return [
    `<tool_result tool="${tool}" ok="${result.ok ? "true" : "false"}">`,
    `arguments: ${serializeJson(args)}`,
    truncateText(result.summary, TOOL_RESULT_CHAR_LIMIT),
    "</tool_result>",
  ].join("\n");
}

function fallbackReplyText(input: {
  character: CharacterRecord;
  historyCount: number;
  userMessage: string;
}) {
  const language = String(input.character.definition.language || "").toLowerCase();
  const prefersChinese = language.includes("zh") || language.includes("chinese");
  if (prefersChinese) {
    return [
      "实时模型这次没有返回结果，下面是本地降级回复，不是实际模型输出。",
      `你刚才的问题是：“${input.userMessage}”。`,
      input.historyCount > 0
        ? `我已经保留这段会话里的最近 ${input.historyCount} 轮上下文。`
        : "这是当前会话的第一轮输入。",
      "请重试一次，或者检查 Runtime 里的模型配置和网络状态。",
    ].join("\n");
  }
  return [
    "The live model did not return a response for this turn, so this is a local fallback instead of an actual model reply.",
    `Your latest message was: "${input.userMessage}".`,
    input.historyCount > 0
      ? `I am carrying the latest ${input.historyCount} turns of context into this reply.`
      : "This is the first message in the current conversation.",
    "Retry the turn, or check the runtime model settings and network path.",
  ].join("\n");
}

async function executeTool(
  tool: ToolName,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  switch (tool) {
    case "web_search": {
      const query = String(args.query || "").trim();
      if (!query) {
        return { ok: false, summary: "web_search requires a non-empty query." };
      }
      const results = await searchWeb(query, {
        count: normalizePositiveInt(args.count, 6, 8),
        language: String(args.language || context.character.definition.language || "").trim(),
      });
      return {
        ok: true,
        searchResults: results,
        summary: serializeJson({
          query,
          results: results.map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.snippet,
            source: item.source,
          })),
        }),
      };
    }
    case "search_skills": {
      const query = String(args.query || "").trim();
      const skills = (await listSkillCatalog(query, context.config)).slice(0, 8);
      return {
        ok: true,
        summary: serializeJson({
          query,
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            source: skill.source,
            packageRef: skill.packageRef,
          })),
        }),
      };
    }
    case "list_attached_skills": {
      const skills = await resolveCharacterSkills(context.character);
      return {
        ok: true,
        summary: serializeJson({
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            source: skill.source,
          })),
        }),
      };
    }
    case "read_skill": {
      const skillId = String(args.skillId || "").trim();
      if (!skillId) {
        return { ok: false, summary: "read_skill requires skillId." };
      }
      const skill = await findSkillById(skillId, context.character.id);
      if (!skill || !skill.skillFile) {
        return { ok: false, summary: `Skill not found: ${skillId}` };
      }
      const content = await fs.readFile(skill.skillFile, "utf8").catch(() => "");
      return {
        ok: true,
        summary: [
          `Skill: ${skill.name} (${skill.id})`,
          `Source: ${skill.source || "unknown"}`,
          truncateText(content, SKILL_CONTENT_CHAR_LIMIT),
        ].join("\n\n"),
      };
    }
    case "install_skill": {
      if (!context.allowMutatingTools) {
        return {
          ok: false,
          summary: "install_skill is disabled in this runtime context.",
        };
      }
      const skillId = String(args.skillId || "").trim();
      const packageRef = String(args.packageRef || "").trim();
      if (!skillId) {
        return { ok: false, summary: "install_skill requires skillId." };
      }

      let updatedCharacter: CharacterRecord | null = null;
      let resolvedSkillId = skillId;
      await updateStore(async (store) => {
        const record = await ensureSkillInstalled(store, skillId, context.character.id, packageRef);
        upsertInstalledSkill(store, record);
        resolvedSkillId = record.skillId;
        updatedCharacter = await attachSkillToCharacter(store, context.character.id, record.skillId);
      });

      if (updatedCharacter) {
        Object.assign(context.character, updatedCharacter);
      }

      const installed = await findSkillById(resolvedSkillId, context.character.id);
      return {
        ok: true,
        summary: serializeJson({
          installed: true,
          skill: installed
            ? {
                id: installed.id,
                name: installed.name,
                source: installed.source,
              }
            : { id: skillId },
          attachedSkillIds: context.character.skillIds,
        }),
      };
    }
    case "create_automation": {
      if (!context.allowMutatingTools) {
        return {
          ok: false,
          summary: "create_automation is disabled in this runtime context.",
        };
      }

      const name = String(args.name || "").trim();
      const prompt = String(args.prompt || "").trim();
      const intervalMinutes = normalizePositiveInt(args.intervalMinutes, 60, 10_080);
      if (!name || !prompt) {
        return {
          ok: false,
          summary: "create_automation requires both name and prompt.",
        };
      }

      const automation = await createOrUpdateAutomation({
        characterId: context.character.id,
        name,
        prompt,
        intervalMinutes,
        enabled: true,
      });

      return {
        ok: true,
        automation,
        summary: serializeJson({
          id: automation.id,
          name: automation.name,
          intervalMinutes: automation.intervalMinutes,
          nextRunAt: automation.nextRunAt,
        }),
      };
    }
    case "list_automations": {
      const store = await readStore();
      const automations = store.automations
        .filter((item) => item.characterId === context.character.id)
        .slice(0, 10);
      return {
        ok: true,
        summary: serializeJson({
          automations: automations.map((item) => ({
            id: item.id,
            name: item.name,
            intervalMinutes: item.intervalMinutes,
            enabled: item.enabled,
            nextRunAt: item.nextRunAt,
            lastRunAt: item.lastRunAt,
          })),
        }),
      };
    }
    default:
      return {
        ok: false,
        summary: `Unknown tool: ${String(tool || "")}`,
      };
  }
}

async function runLegacyToolLoop(
  input: RoleAgentTurnInput,
  allowMutatingTools: boolean,
): Promise<RoleAgentTurnResult> {
  const toolPrompt = buildLegacyToolPrompt(allowMutatingTools);
  const scratchHistory = [...input.history];
  const toolEvents: ToolEvent[] = [];
  const aggregatedSearchResults: SearchResultRecord[] = [];
  const seenToolCalls = new Set<string>();
  let lastGeneration: CompletionTrace | undefined;
  let shouldFinalize = false;

  for (let step = 1; step <= TOOL_LOOP_MAX_STEPS; step += 1) {
    const result = await generateRoleReplyDetailed({
      systemPrompt: `${input.systemPrompt}\n\n${toolPrompt}`,
      history: scratchHistory,
      userMessage: input.userMessage,
      config: input.config,
    });
    lastGeneration = result.generation;

    let toolCall: { tool: ToolName; arguments: Record<string, unknown> } | null = null;
    try {
      toolCall = extractToolCall(result.reply);
    } catch (error: any) {
      scratchHistory.push({
        role: "assistant",
        content: [
          '<tool_result tool="runtime_parser" ok="false">',
          `The previous tool call could not be parsed: ${String(
            error?.message || error || "invalid_tool_call",
          )}`,
          "</tool_result>",
        ].join("\n"),
      });
      continue;
    }

    if (!toolCall) {
      return {
        reply: result.reply,
        generation: result.generation,
        toolEvents,
        searchResults: dedupeSearchResults(aggregatedSearchResults),
      };
    }

    const signature = `${toolCall.tool}:${JSON.stringify(toolCall.arguments)}`;
    if (seenToolCalls.has(signature)) {
      shouldFinalize = true;
      break;
    }
    seenToolCalls.add(signature);

    const toolResult = await executeTool(toolCall.tool, toolCall.arguments, {
      character: input.character,
      config: input.config,
      allowMutatingTools,
    });

    if (Array.isArray(toolResult.searchResults)) {
      aggregatedSearchResults.push(...toolResult.searchResults);
    }

    toolEvents.push({
      step,
      tool: toolCall.tool,
      arguments: toolCall.arguments,
      ok: toolResult.ok,
      summary: truncateText(toolResult.summary, 1200),
    });

    scratchHistory.push({
      role: "assistant",
      content: `<tool_call>${serializeJson(toolCall)}</tool_call>`,
    });
    scratchHistory.push({
      role: "assistant",
      content: formatToolResultBlock(toolCall.tool, toolCall.arguments, toolResult),
    });
  }

  if (toolEvents.length > 0 || shouldFinalize) {
    const finalResult = await generateRoleReplyDetailed({
      systemPrompt: [
        input.systemPrompt,
        toolPrompt,
        "## TOOL_FINALIZATION.md",
        "Tool execution phase is complete.",
        "Do not call any more tools.",
        "Summarize completed tool actions and answer the user directly.",
      ].join("\n\n"),
      history: scratchHistory,
      userMessage: input.userMessage,
      config: input.config,
    });

    if (!extractToolCall(finalResult.reply)) {
      return {
        reply: finalResult.reply,
        generation: finalResult.generation,
        toolEvents,
        searchResults: dedupeSearchResults(aggregatedSearchResults),
      };
    }
  }

  return {
    reply:
      toolEvents.length > 0
        ? [
            "我已经执行了工具，但模型没有稳定收口。",
            "已完成的动作：",
            ...toolEvents.map(
              (event) =>
                `- ${event.tool}: ${event.ok ? "success" : "error"} - ${event.summary}`,
            ),
          ].join("\n")
        : [
            "我已经执行了可用工具，但在当前限制内没有收敛到稳定答案。",
            "请缩小范围，或者直接指定你要我搜索、安装 skill、还是创建定时任务。",
          ].join("\n"),
    generation:
      lastGeneration ||
      ({
        mode: "fallback",
        providerMode: "glm-main",
        model: "glm-4-flash-250414",
        reason: "tool_loop_limit",
      } satisfies CompletionTrace),
    toolEvents,
    searchResults: dedupeSearchResults(aggregatedSearchResults),
  };
}

async function runNativeToolLoop(
  input: RoleAgentTurnInput,
  allowMutatingTools: boolean,
): Promise<RoleAgentTurnResult | null> {
  const nativeToolPrompt = buildNativeToolPrompt(allowMutatingTools);
  const legacyToolPrompt = buildLegacyToolPrompt(allowMutatingTools);
  const nativeTools = buildNativeTools(allowMutatingTools);
  const allowedToolNames = new Set(nativeTools.map((tool) => tool.name));
  const scratchHistory = [...input.history];
  const nativeMessages: LlmConversationMessage[] = [
    {
      role: "system",
      content: `${input.systemPrompt}\n\n${nativeToolPrompt}`,
    },
    ...input.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user",
      content: input.userMessage,
    },
  ];
  const toolEvents: ToolEvent[] = [];
  const aggregatedSearchResults: SearchResultRecord[] = [];
  const seenToolCalls = new Set<string>();
  let lastGeneration: CompletionTrace | undefined;
  let shouldFinalize = false;

  for (let step = 1; step <= TOOL_LOOP_MAX_STEPS; step += 1) {
    const result = await completeTextWithToolsDetailed({
      messages: nativeMessages,
      tools: nativeTools,
      fallback: () =>
        fallbackReplyText({
          character: input.character,
          historyCount: input.history.length,
          userMessage: input.userMessage,
        }),
      config: input.config,
    });
    lastGeneration = result.trace;

    if (!result.toolCall) {
      if (step === 1 && result.trace.mode === "fallback") {
        return null;
      }
      return {
        reply: result.value,
        generation: result.trace,
        toolEvents,
        searchResults: dedupeSearchResults(aggregatedSearchResults),
      };
    }

    const toolName = String(result.toolCall.name || "").trim() as ToolName;
    const toolArguments =
      result.toolCall.arguments && typeof result.toolCall.arguments === "object"
        ? result.toolCall.arguments
        : {};
    const signature = `${toolName}:${JSON.stringify(toolArguments)}`;
    if (seenToolCalls.has(signature)) {
      shouldFinalize = true;
      break;
    }
    seenToolCalls.add(signature);

    const toolResult = allowedToolNames.has(toolName)
      ? await executeTool(toolName, toolArguments, {
          character: input.character,
          config: input.config,
          allowMutatingTools,
        })
      : {
          ok: false,
          summary: `Unknown tool: ${toolName}`,
        };

    if (Array.isArray(toolResult.searchResults)) {
      aggregatedSearchResults.push(...toolResult.searchResults);
    }

    toolEvents.push({
      step,
      tool: toolName,
      arguments: toolArguments,
      ok: toolResult.ok,
      summary: truncateText(toolResult.summary, 1200),
    });

    nativeMessages.push({
      role: "assistant",
      content: result.value || "",
      toolCalls: [
        {
          name: toolName,
          arguments: toolArguments,
          callId: result.toolCall.callId,
        },
      ],
    });
    nativeMessages.push({
      role: "tool",
      content: truncateText(toolResult.summary, TOOL_RESULT_CHAR_LIMIT),
      toolName,
      toolCallId: result.toolCall.callId,
    });

    scratchHistory.push({
      role: "assistant",
      content: `<tool_call>${serializeJson({
        tool: toolName,
        arguments: toolArguments,
      })}</tool_call>`,
    });
    scratchHistory.push({
      role: "assistant",
      content: formatToolResultBlock(toolName, toolArguments, toolResult),
    });
  }

  if (toolEvents.length > 0 || shouldFinalize) {
    const finalResult = await generateRoleReplyDetailed({
      systemPrompt: [
        input.systemPrompt,
        legacyToolPrompt,
        "## TOOL_FINALIZATION.md",
        "Native tool execution phase is complete.",
        "Do not call any more tools.",
        "Summarize completed tool actions and answer the user directly.",
      ].join("\n\n"),
      history: scratchHistory,
      userMessage: input.userMessage,
      config: input.config,
    });

    if (!extractToolCall(finalResult.reply)) {
      return {
        reply: finalResult.reply,
        generation: {
          ...finalResult.generation,
          nativeTools: true,
        },
        toolEvents,
        searchResults: dedupeSearchResults(aggregatedSearchResults),
      };
    }
  }

  return {
    reply:
      toolEvents.length > 0
        ? [
            "我已经完成工具调用，但模型在原生工具模式下没有稳定收口。",
            "已完成的动作：",
            ...toolEvents.map(
              (event) =>
                `- ${event.tool}: ${event.ok ? "success" : "error"} - ${event.summary}`,
            ),
          ].join("\n")
        : [
            "我已经尝试原生工具模式，但没有收敛到稳定答案。",
            "请缩小范围，或者直接指定你要我搜索、安装 skill、还是创建定时任务。",
          ].join("\n"),
    generation: {
      ...(lastGeneration ||
        ({
          mode: "fallback",
          providerMode: "glm-main",
          model: "glm-4-flash-250414",
          reason: "native_tool_loop_limit",
        } satisfies CompletionTrace)),
      nativeTools: true,
    },
    toolEvents,
    searchResults: dedupeSearchResults(aggregatedSearchResults),
  };
}

export async function runRoleAgentTurn(input: RoleAgentTurnInput) {
  const allowMutatingTools = input.allowMutatingTools !== false;

  if (supportsNativeToolCalling(input.config)) {
    const nativeResult = await runNativeToolLoop(input, allowMutatingTools);
    if (nativeResult) {
      return nativeResult;
    }
  }

  return runLegacyToolLoop(input, allowMutatingTools);
}
