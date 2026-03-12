import { promises as fs } from "fs";
import path from "path";
import type {
  CharacterRecord,
  RoleBundle,
  SearchResultRecord,
  SkillCatalogItem,
} from "../src/types";
import { characterBootstrapPath, characterSkillsPath } from "./project-paths";
import { buildPlatformReplyEnginePrompt } from "./prompting";

function inferPromptLanguage(input: string): "zh" | "en" {
  const language = String(input || "").trim().toLowerCase();
  if (language.includes("english") || language === "en") return "en";
  return "zh";
}

function fallbackBundle(character: CharacterRecord): RoleBundle {
  const { definition } = character;
  return {
    agents: [
      `Role: ${definition.name || "Liberth Neural Character"}`,
      `Core job: ${definition.oneLiner || "Role-first assistant"}`,
      `Audience: ${definition.audience || "general users"}`,
      "Operate as a deployable role-first chatbot, not a clone or digital twin.",
    ].join("\n"),
    soul: [
      `Primary goals: ${definition.goals || "Provide useful, grounded responses."}`,
      `Core personality: ${definition.personality || "helpful, sharp, grounded"}`,
      "Decision stance: stay practical, grounded, and useful.",
    ].join("\n"),
    style: [
      `Tone: ${definition.tone || "clear and direct"}`,
      `Default language: ${definition.language || "Chinese"}`,
      "Prefer concise answers first, then expand when the user asks for depth.",
    ].join("\n"),
    identity: [
      `You are ${definition.name || "the assistant"}.`,
      "State clearly when needed that you are an AI role built from a user-defined brief.",
      "Never imply you are the original human, a scraped twin, or a visual/voice clone.",
    ].join("\n"),
    user: [
      `Primary audience: ${definition.audience || "general users"}`,
      `Working domain: ${definition.domain || "general domain"}`,
      `Knowledge pack:\n${definition.knowledge || "No additional knowledge pack provided."}`,
    ].join("\n"),
    tools: [
      "You operate inside an OpenClaw-like runtime shell.",
      "Use installed skills when they materially improve the answer.",
      "Do not claim external actions were executed unless the runtime actually performed them.",
    ].join("\n"),
    heartbeat: [
      "1. Read the user request carefully.",
      "2. Match the answer to role goals and boundaries.",
      "3. Prefer actionable output over abstract filler.",
      "4. Preserve tone continuity across turns.",
    ].join("\n"),
    memory: [
      "Use only the current conversation thread as working memory.",
      "Keep references to prior turns concise and relevant.",
    ].join("\n"),
    examples: [
      `User: 你能帮我做什么？\nAssistant: 我会以“${definition.name || "当前角色"}”的角色设定来帮助你。`,
      "User: 不要废话，直接给方案。\nAssistant: 好。先给结论，再给步骤和风险。",
    ],
  };
}

function resolveBundle(character: CharacterRecord): RoleBundle {
  const bundle = character.blueprint.bundle;
  const fallback = fallbackBundle(character);
  return {
    agents: String(bundle?.agents || "").trim() || fallback.agents,
    soul: String(bundle?.soul || "").trim() || fallback.soul,
    style: String(bundle?.style || "").trim() || fallback.style,
    identity: String(bundle?.identity || "").trim() || fallback.identity,
    user: String(bundle?.user || "").trim() || fallback.user,
    tools: String(bundle?.tools || "").trim() || fallback.tools,
    heartbeat: String(bundle?.heartbeat || "").trim() || fallback.heartbeat,
    memory: String(bundle?.memory || "").trim() || fallback.memory,
    examples:
      Array.isArray(bundle?.examples) && bundle?.examples.length > 0
        ? bundle.examples.map((item) => String(item || "").trim()).filter(Boolean)
        : fallback.examples,
  };
}

async function writeIfChanged(filePath: string, nextValue: string) {
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === nextValue) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, nextValue, "utf8");
}

export async function ensureCharacterWorkspace(character: CharacterRecord) {
  const bundle = resolveBundle(character);
  const workspaceRoot = characterBootstrapPath(character.id);
  const skillRoot = characterSkillsPath(character.id);

  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(skillRoot, { recursive: true });

  await Promise.all([
    writeIfChanged(path.join(workspaceRoot, "AGENTS.md"), bundle.agents),
    writeIfChanged(path.join(workspaceRoot, "SOUL.md"), bundle.soul),
    writeIfChanged(path.join(workspaceRoot, "STYLE.md"), bundle.style),
    writeIfChanged(path.join(workspaceRoot, "IDENTITY.md"), bundle.identity),
    writeIfChanged(path.join(workspaceRoot, "USER.md"), bundle.user),
    writeIfChanged(path.join(workspaceRoot, "TOOLS.md"), bundle.tools),
    writeIfChanged(path.join(workspaceRoot, "HEARTBEAT.md"), bundle.heartbeat),
    writeIfChanged(path.join(workspaceRoot, "MEMORY.md"), bundle.memory),
    writeIfChanged(
      path.join(workspaceRoot, "examples", "good.md"),
      bundle.examples
        .map((example, index) => `### Example ${index + 1}\n${example}`)
        .join("\n\n"),
    ),
  ]);

  return {
    workspaceRoot,
    skillRoot,
  };
}

async function readWorkspaceFile(workspaceRoot: string, relativePath: string) {
  return fs.readFile(path.join(workspaceRoot, relativePath), "utf8");
}

function compactSkillList(skills: SkillCatalogItem[]) {
  if (skills.length === 0) return "";
  return [
    "<available_skills>",
    ...skills.map((skill) =>
      [
        `<skill id="${skill.id}" source="${skill.source || "unknown"}">`,
        `<name>${skill.name}</name>`,
        `<description>${skill.description}</description>`,
        skill.category ? `<category>${skill.category}</category>` : "",
        skill.tags?.length ? `<tags>${skill.tags.join(", ")}</tags>` : "",
        "</skill>",
      ]
        .filter(Boolean)
        .join(""),
    ),
    "</available_skills>",
  ].join("\n");
}

export async function buildRuntimeSystemPrompt(input: {
  character: CharacterRecord;
  availableSkills: SkillCatalogItem[];
  attachedSkills?: Array<{
    meta: SkillCatalogItem;
    content: string;
  }>;
  activeSkill?: {
    meta: SkillCatalogItem;
    content: string;
  } | null;
  searchResults?: SearchResultRecord[];
}) {
  const language = inferPromptLanguage(input.character.definition.language);
  const { workspaceRoot } = await ensureCharacterWorkspace(input.character);

  const [
    agents,
    soul,
    style,
    identity,
    user,
    tools,
    heartbeat,
    memory,
    examples,
  ] = await Promise.all([
    readWorkspaceFile(workspaceRoot, "AGENTS.md"),
    readWorkspaceFile(workspaceRoot, "SOUL.md"),
    readWorkspaceFile(workspaceRoot, "STYLE.md"),
    readWorkspaceFile(workspaceRoot, "IDENTITY.md"),
    readWorkspaceFile(workspaceRoot, "USER.md"),
    readWorkspaceFile(workspaceRoot, "TOOLS.md"),
    readWorkspaceFile(workspaceRoot, "HEARTBEAT.md"),
    readWorkspaceFile(workspaceRoot, "MEMORY.md"),
    readWorkspaceFile(workspaceRoot, path.join("examples", "good.md")),
  ]);

  const sections = [
    buildPlatformReplyEnginePrompt({
      language,
      channel: "liberth-neural.chat",
      expectBundleFiles: true,
      disclosureMode: "contextual",
    }),
    `## AGENTS.md\n${agents}`,
    `## SOUL.md\n${soul}`,
    `## STYLE.md\n${style}`,
    `## IDENTITY.md\n${identity}`,
    `## USER.md\n${user}`,
    `## TOOLS.md\n${tools}`,
    `## HEARTBEAT.md\n${heartbeat}`,
    `## MEMORY.md\n${memory}`,
    `## examples/good.md\n${examples}`,
  ];

  const compactSkills = compactSkillList(input.availableSkills);
  if (compactSkills) {
    sections.push(`## available-skills.xml\n${compactSkills}`);
  }

  const attachedSkills = (input.attachedSkills || []).filter(
    (item) => item.meta.id !== input.activeSkill?.meta.id,
  );
  if (attachedSkills.length > 0) {
    sections.push(
      [
        "## INSTALLED_SKILLS.md",
        "These skills are attached to this character workspace. Treat them as role extensions and follow them when relevant.",
        ...attachedSkills.map(
          (skill) =>
            [
              `### ${skill.meta.name} (${skill.meta.id})`,
              `Source: ${skill.meta.source || "unknown"}`,
              skill.content,
            ].join("\n\n"),
        ),
      ].join("\n\n"),
    );
  }

  if (input.activeSkill?.content) {
    sections.push(
      `## ACTIVE_SKILL.md\nSkill: ${input.activeSkill.meta.name} (${input.activeSkill.meta.id})\nSource: ${
        input.activeSkill.meta.source || "unknown"
      }\n\n${input.activeSkill.content}`,
    );
  }

  if (input.searchResults && input.searchResults.length > 0) {
    sections.push(
      [
        "## SEARCH_CONTEXT.md",
        "These search results were fetched by the runtime. Treat them as external evidence and cite them where useful.",
        ...input.searchResults.slice(0, 8).map((item, index) =>
          [
            `[${index + 1}] ${item.title}`,
            `Source: ${item.source}${item.engine ? ` (${item.engine})` : ""}`,
            `URL: ${item.url}`,
            item.snippet ? `Snippet: ${item.snippet}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ].join("\n\n"),
    );
  }

  return sections.join("\n\n");
}
