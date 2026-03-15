# Liberth Neural

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL%20v3-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-43853d.svg)](https://nodejs.org/)

Liberth Neural is an architecture research project for inspectable,
role-defined dialogue systems. It studies how you can turn a plain-language
character definition into a structured runtime made of a persona profile, a
neural graph, a prompt bundle, a memory layer, and a per-turn neural trace.

The current standalone now applies Liberth's unified neural runtime model. The
runtime is split into persona governance, neural memory, intent routing, and
three execution paths: direct runtime, planned runtime, and grouped work. That
lets you study the dialogue core as a compact architecture seam instead of a
single monolithic chat loop.

> **Note:** This is a preview feature currently under active development.

This repository is intentionally narrow. It does not try to solve general
agent orchestration, multimodal impersonation, or production-grade
multi-tenant serving. It focuses on one question: how do you build a dialogue
runtime that stays legible after every turn?

## Relationship to Liberth

This repository is a standalone extraction of the neural dialogue runtime that
originally lives inside the main Liberth project. In Liberth, this runtime
acts as a dependency component for character dialogue and state inspection.
Here, it is isolated so you can study the subsystem without the full
application surface around it.

That split serves two goals:

- It gives the main Liberth project a smaller architectural seam around neural
  dialogue.
- It gives researchers and contributors a focused codebase they can read,
  modify, and reuse without inheriting the entire product stack.

## Why this repository exists

This repository is best read as a systems experiment, not a generic chatbot
template. The code explores a small set of architecture questions that are
easy to describe and hard to keep coherent in implementation.

- Can you compile loose role notes into stable runtime artifacts instead of
  relying on one opaque system prompt?
- Can you expose a readable per-turn trace without dumping raw hidden state?
- Can you combine local memory, route selection, and provider abstraction in
  one runtime that you can inspect end to end?
- Can you keep the stack local-first so you can replay and audit behavior
  without external orchestration infrastructure?

## Purpose and comparison with traditional architectures

This section is intentionally bilingual. It explains the project purpose and
how the architecture differs from a more traditional LLM application stack in
both English and Chinese.

### English

Liberth Neural exists to make role-defined dialogue systems easier to inspect,
debug, and reason about. In a traditional chatbot stack, you often author one
large system prompt, append some message history, call a model, and accept the
result as mostly opaque runtime behavior. That approach is fast to ship, but
it is hard to audit after the fact.

Liberth Neural takes a different path. It compiles a character definition into
stable runtime artifacts, derives an explicit turn state before generation,
records a public neural trace after generation, and stores memory locally.
The goal is not to look more intelligent. The goal is to make the runtime more
legible.

| Aspect | Traditional architecture | Liberth Neural |
| --- | --- | --- |
| Primary goal | Ship a general assistant quickly | Study inspectable role-driven dialogue |
| Character design | Usually one prompt or prompt template | Compiled into profile, graph, bundle, and prompt artifacts |
| Runtime state | Mostly implicit inside prompt text and model behavior | Explicit `NeuralStateSnapshot` derived on each turn |
| Memory | Often hidden in prompt construction or external retrieval | Local thread memory plus local durable character memory |
| Turn trace | Limited logs or provider metadata | Public `NeuralRecord` attached to assistant turns |
| Architecture style | Completion-first | State-derivation-first, then generation |
| Operating stance | Product-oriented assistant surface | Research-oriented, local-first runtime seam |

### 中文

Liberth Neural 的目的，不是再做一个通用聊天机器人，而是把“角色对话系统”
做成一个更容易观察、调试、复盘的运行时。传统 LLM 应用通常是写一大段
system prompt，再拼接历史消息，调用模型，然后把结果当成黑箱输出。这样
实现很快，但事后很难解释“这一轮为什么这样回答”。

Liberth Neural 走的是另一条路：先把角色定义编译成稳定的运行时工件，再在
每一轮对话前推导显式状态，在生成后附加公开的神经记录，并把记忆保存在本地。
它追求的不是“更像人”，而是“更可读、可查、可审计”的角色运行时。

| 维度 | 传统架构 | Liberth Neural |
| --- | --- | --- |
| 核心目标 | 快速交付通用助手 | 研究可观测的角色对话运行时 |
| 角色构建方式 | 一段 prompt 或 prompt 模板 | 编译成 profile、graph、bundle、prompt 等工件 |
| 运行时状态 | 大多隐含在 prompt 和模型内部 | 每轮显式推导 `NeuralStateSnapshot` |
| 记忆方式 | 常隐藏在 prompt 拼接或外部检索里 | 本地 thread memory + 本地 durable memory |
| 回合追踪 | 只有有限日志或 provider 元数据 | 每条 assistant 回复都可附带 `NeuralRecord` |
| 架构顺序 | 先生成，再观察结果 | 先推导状态，再生成内容 |
| 使用定位 | 产品化助手 | 面向研究的、本地优先的运行时架构 |

## Research stance

Liberth Neural treats "neural" as an architectural metaphor, not as a claim of
novel model training. The repository does not train a model, fine-tune
weights, or simulate biological cognition. It builds a symbolic runtime that
borrows neural vocabulary to make state transitions easier to reason about.

The central stance is simple: if a character runtime has memory, routes,
modulators, and priorities, you should be able to inspect those pieces as
first-class records.

## How it works

Liberth Neural now runs as a unified runtime rather than a single chat loop.
It still starts by compiling a role definition into a stable blueprint, but it
then routes each turn through a governance layer, a neural memory layer, an
intent router, and one of three execution paths.

At a high level, the runtime works like this:

1. You define a character in plain language through fields such as identity,
   tone, goals, boundaries, and knowledge.
2. The governance layer compiles or repairs the character blueprint so the
   runtime always has a usable persona profile, neural graph, and bundle.
3. When a user sends a message, the runtime derives thread memories and global
   memories, then uses them to build a `NeuralStateSnapshot`.
4. The intent router converts that neural state and the current message into a
   `RuntimeIntentDecision`.
5. The unified runtime chooses one of three paths:
   - `direct_runtime` for normal single-turn execution
   - `planned_runtime` for reflective or learning-heavy execution
   - `grouped_work` for multi-stage work that needs planning, delivery, QA,
     and optional publication
6. The selected path builds the runtime prompt, calls the provider adapter,
   and returns a reply plus an explicit provider trace.
7. The runtime then writes back a public `NeuralRecord`, an optional durable
   memory candidate, and, for grouped work, a `WorkRunRecord` plus an optional
   `MarketListingRecord`.

The practical effect is that one assistant message is no longer treated as a
raw completion. It is the output of a repeatable pipeline: definition,
governance, state derivation, path selection, execution, trace attachment, and
local writeback.

## System boundary

You can think of the project as a single-node runtime with explicit internal
subsystems. Each subsystem exists to keep the dialogue core inspectable even
when a request expands beyond a normal answer.

```mermaid
flowchart LR
  A["Role definition"] --> B["Persona governance"]
  B --> C["Blueprint compiler"]
  C --> D["Persona profile"]
  C --> E["Neural graph"]
  C --> F["Prompt bundle"]
  D --> G["Neural memory"]
  E --> H["State derivation"]
  F --> I["Unified runtime"]
  G --> H
  H --> J["Intent router"]
  J --> K["Direct runtime"]
  J --> L["Planned runtime"]
  J --> M["Grouped work orchestrator"]
  K --> N["Provider adapter"]
  L --> N
  M --> N
  M --> O["Work run artifacts"]
  M --> P["Draft publication"]
  N --> Q["Assistant reply"]
  H --> R["Neural record"]
  R --> S["Conversation store"]
  O --> S
  P --> S
```

Within that boundary, the repository currently includes:

- a local blueprint compiler and persona governance seam
- a neural memory layer for thread and durable memory handling
- a unified runtime with direct, planned, and grouped-work execution
- a local persistence layer for characters, conversations, work runs, and
  draft market listings
- a provider abstraction over native and OpenAI-compatible APIs
- a browser workspace for editing, chatting, and replaying neural records

Outside that boundary, the repository explicitly avoids:

- voice impersonation
- avatar impersonation
- scraped identity reconstruction
- distributed memory infrastructure
- high-scale serving guarantees
- production-grade autonomous agent fleets

## Core artifacts

The runtime is easier to understand if you treat each artifact as a stable
interface rather than as incidental app state.

| Artifact | Purpose | Defined in |
| --- | --- | --- |
| `RoleDefinitionInput` | Human-authored role notes that seed the system | [`src/types.ts`](./src/types.ts) |
| `PersonaExtractProfile` | Structured identity, values, expertise, and style | [`server/neural-engine.ts`](./server/neural-engine.ts) |
| `NeuralBundleGraph` | Regions, neurons, circuits, synapses, and plasticity settings | [`src/types.ts`](./src/types.ts) |
| `RoleBlueprint` | Compiled output that packages profile, graph, bundle files, and system prompt | [`server/roles.ts`](./server/roles.ts) |
| `NeuralStateSnapshot` | Turn-level neural state derived from the current message and local memory | [`server/neural-engine.ts`](./server/neural-engine.ts) |
| `RuntimeIntentDecision` | Execution-path decision that maps a turn into direct, planned, or grouped work | [`src/types.ts`](./src/types.ts) |
| `NeuralRecord` | Public trace attached to an assistant turn | [`server/neural-memory.ts`](./server/neural-memory.ts) |
| `WorkRunRecord` | Persisted record of grouped planning, delivery, QA, and repair artifacts | [`src/types.ts`](./src/types.ts) |
| `MarketListingRecord` | Draft publication artifact created from reusable grouped work | [`src/types.ts`](./src/types.ts) |

Those artifacts are the real product of the system. The chat reply is only one
projection of them.

## Compilation pipeline

The repository starts from a plain-language role definition and compiles it
into a reusable blueprint. This keeps authoring separate from runtime
execution.

1. Parse the role form into `RoleDefinitionInput`.
2. Extract a normalized persona profile from the authored fields.
3. Build a local neural graph with regions, neurons, circuits, and plasticity
   rules.
4. Generate bundle files such as `AGENTS.md`, `SOUL.md`, `STYLE.md`, and
   `MEMORY.md`.
5. Assemble a `RoleBlueprint` that the runtime can consume on every turn.

The current implementation performs that compilation locally in
[`server/roles.ts`](./server/roles.ts) and
[`server/neural-engine.ts`](./server/neural-engine.ts). It does not require a
remote builder model to produce the baseline blueprint.

## Runtime loop

The runtime loop is the core research object in this repository. For each user
message, the system derives state first, then selects an execution path, then
generates text, then decides what to persist.

```mermaid
sequenceDiagram
  participant U as User
  participant G as Persona governance
  participant M as Neural memory
  participant S as State derivation
  participant I as Intent router
  participant R as Unified runtime
  participant P as Provider
  participant W as Work bridge
  participant D as Local store

  U->>G: Submit message against character
  G->>M: Ensure governed blueprint and load memory context
  M->>S: Build thread + global memory inputs
  S->>I: Derive NeuralStateSnapshot
  I->>R: Emit RuntimeIntentDecision
  alt Direct or planned runtime
    R->>P: Generate assistant reply
    P-->>R: Reply + provider trace
  else Grouped work
    R->>W: Open grouped work run
    W->>P: Planning and delivery stages
    P-->>W: Stage replies
    W->>W: Run QA and optional repair
    W-->>R: Final artifact + optional draft listing
  end
  R->>D: Persist conversation, neural record, memory, and optional work artifacts
  R-->>U: Reply + inspectable trace
```

In concrete terms, the runtime entry in [`server/index.ts`](./server/index.ts)
does the following:

1. Load the selected character and latest conversation.
2. Repair or reuse the governed blueprint for that character.
3. Convert recent messages into thread memories and load durable character
   memory.
4. Combine memory, persona profile, and neural graph into a
   `NeuralStateSnapshot`.
5. Convert that state into a `RuntimeIntentDecision`.
6. Execute the selected runtime path.
7. Attach a compact `NeuralRecord` to the assistant message.
8. Optionally consolidate durable memory and persist grouped work artifacts.

The important design choice is ordering. State derivation happens before model
generation, path selection happens before execution, and memory writeback
happens after generation. That separation keeps the architecture inspectable.

## Neural routes and runtime paths

Liberth Neural now uses two vocabularies that serve different purposes. The
goal is to separate what the neural layer is "leaning toward" from how the
runtime actually executes the turn.

The neural route set is:

- `respond`
- `tool`
- `clarify`
- `learn`
- `reflect`

The dominant neural route becomes part of the public neural record. The
runtime also keeps route alternatives, supporting neurons, modulators,
workspace contents, and memory directives inside the same trace structure.

The runtime path set is:

- `direct_runtime`
- `planned_runtime`
- `grouped_work`

The intent router bridges the two layers. A turn might have a neural route of
`learn`, for example, while still being executed through `planned_runtime`.
Likewise, a turn can keep a neural route of `respond` but be upgraded into
`grouped_work` if the request implies multi-stage planning, delivery, and QA.

## Memory model

The memory model is deliberately conservative. The repository stores local
thread context, local durable memories, and grouped-work artifacts. It does
not implement retrieval augmentation over external databases or semantic
vector search.

There are two memory scopes:

- `thread` memory from recent conversation turns
- `global` memory attached to the character record

On each turn, the runtime may derive a durable memory candidate. If the
candidate is strong enough and not duplicated, it is appended to the character
store and trimmed to the latest local window.

Grouped work uses a parallel artifact history. Instead of folding every
planning or QA step into global memory, the runtime stores those steps inside a
`WorkRunRecord` so you can inspect the work trail without polluting the
character memory lane.

## Provider abstraction

The provider layer is part of the research design because it tests whether the
runtime can keep its architecture stable while the generation backend changes.
The dialogue logic sits above the provider adapters.

The current provider matrix includes:

| Provider | API style | Default model |
| --- | --- | --- |
| GLM | Native GLM | `glm-4-flash-250414` |
| OpenAI Compatible | OpenAI chat completions | `gpt-4.1-mini` |
| OpenRouter | OpenAI chat completions | `openai/gpt-4.1-mini` |
| DeepSeek | OpenAI chat completions | `deepseek-chat` |
| SiliconFlow | OpenAI chat completions | `Qwen/Qwen2.5-72B-Instruct` |
| Groq | OpenAI chat completions | `llama-3.3-70b-versatile` |
| Ollama | OpenAI chat completions | `qwen2.5:14b` |
| Anthropic | Native Messages API | `claude-3-5-haiku-latest` |
| Google Gemini | Native generateContent API | `gemini-2.0-flash` |

The provider adapter lives in [`server/llm.ts`](./server/llm.ts). The runtime
passes a compiled system prompt and short conversation history into that layer,
then stores the resulting provider trace alongside the assistant reply. GLM now
follows the same manual runtime-key flow as the other hosted providers, and the
API never returns saved provider keys to the frontend.

## Repository layout

The repository is small enough that you can read it as a single-node system.
The directory split reflects runtime concerns more than product features.

```text
liberth-neural-standalone/
├── server/        # Express API, runtime, providers, storage, and automation
├── src/           # React client and shared runtime types
├── data/          # Local persisted records
├── skills/        # Local skill workspace placeholder
├── .env.example   # Provider configuration template
└── package.json   # Dev, build, and typecheck commands
```

The highest-value files for architecture reading are:

- [`server/index.ts`](./server/index.ts) for the API boundary and runtime loop
- [`server/persona-governance.ts`](./server/persona-governance.ts) for
  blueprint repair and governance
- [`server/neural-memory.ts`](./server/neural-memory.ts) for memory shaping and
  neural record construction
- [`server/neural-engine.ts`](./server/neural-engine.ts) for state derivation
- [`server/intent-router.ts`](./server/intent-router.ts) for path selection
- [`server/unified-runtime.ts`](./server/unified-runtime.ts) for execution-path
  dispatch
- [`server/work-orchestrator.ts`](./server/work-orchestrator.ts) for grouped
  work planning, delivery, QA, and repair
- [`server/roles.ts`](./server/roles.ts) for blueprint compilation
- [`server/llm.ts`](./server/llm.ts) for provider adaptation
- [`server/store.ts`](./server/store.ts) for local persistence
- [`src/types.ts`](./src/types.ts) for the artifact contracts

## API surface

The API is intentionally local and compact. It exists to expose the architecture
to the browser workspace, not to present a finished public platform contract.

The main routes are:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Return local runtime health |
| `GET` | `/api/providers` | Return provider catalog and active provider |
| `GET` | `/api/settings/provider` | Load current provider settings |
| `PUT` | `/api/settings/provider` | Persist provider settings |
| `GET` | `/api/characters` | List local character records |
| `POST` | `/api/characters/generate` | Compile a blueprint preview |
| `POST` | `/api/characters` | Create a character |
| `PUT` | `/api/characters` | Update a character |
| `GET` | `/api/conversations?characterId=...` | Load latest conversation |
| `POST` | `/api/chat` | Execute one unified runtime turn |
| `GET` | `/api/deployments?characterId=...` | List outbound route records |
| `POST` | `/api/deployments` | Create or update an outbound route |
| `POST` | `/api/deployments/:deploymentId/send-test` | Send a test delivery |
| `GET` | `/api/conversations/:conversationId/export?format=json|markdown` | Export a conversation |
| `GET` | `/api/characters/:characterId/neural-state` | Inspect latest neural state |
| `GET` | `/api/conversations/:conversationId/neural-records` | Replay assistant traces |

The outbound layer is intentionally narrow. It currently supports three local
delivery targets:

- `webhook` for full JSON payload delivery
- `slack` for text summaries through `chat.postMessage`
- `telegram` for text summaries through `sendMessage`

Those endpoints live in [`server/index.ts`](./server/index.ts). They are useful
for routing local dialogue traces into surrounding tools, but they remain an
adjunct surface around the core runtime rather than the architectural center of
the project.

## Local-first persistence

The storage model is intentionally simple because the research focus is
inspectability, not infrastructure abstraction. Characters, conversations,
global memories, provider settings, grouped work runs, and draft market
listings are stored locally and updated through the server layer.

This choice has two effects:

- You can inspect state transitions directly without standing up a database.
- You do not get transactional guarantees, horizontal scaling, or production
  isolation out of the box.

If you evaluate the repository as a research codebase, that tradeoff is
deliberate. If you evaluate it as a hosted product backend, that tradeoff is a
clear limitation.

## Running the project

You can run the repository locally as a single Node.js application with a Vite
client and an Express server.

1. Clone the repository.
2. Install dependencies.
3. Copy the environment template.
4. Start the development servers.

```bash
git clone https://github.com/Libre-Connect/liberth-neural.git
cd liberth-neural
npm install
cp .env.example .env
npm run dev
```

The Vite client runs at `http://localhost:5178`. The Express server defaults
to `http://localhost:4318`.

## Environment

You can configure provider access in two places: local environment defaults and
the runtime provider settings UI. [`.env.example`](./.env.example) includes
editable server-side defaults for GLM, OpenAI-compatible endpoints,
OpenRouter, DeepSeek, SiliconFlow, Groq, Ollama, Anthropic, and Google Gemini.
The bundled workspace also lets you load and persist provider settings through
the API.

If you only want local inspection without live model calls, you can still read
the compiled blueprint path and type contracts. If you want full chat runtime
behavior, you must configure at least one provider.

## Development commands

The repository uses a small command surface. It is enough to build, run, and
typecheck the architecture without extra tooling.

```bash
npm run dev
npm run dev:server
npm run dev:client
npm run build
npm run build:client
npm run build:server
npm run check
```

At the moment, `npm run check` runs the TypeScript typecheck. The repository
does not yet ship a broader automated test suite.

## What this repository is good for

You should use this repository if you want to study or extend:

- role-to-runtime compilation
- inspectable dialogue routing
- execution-path routing across direct, planned, and grouped work
- compact memory writeback rules
- local grouped work orchestration with visible QA artifacts
- provider-agnostic character chat runtimes
- local-first research prototypes for agent architecture

You should not use this repository as-is if you need:

- production-grade multi-user isolation
- audited security boundaries
- distributed storage
- retrieval pipelines over large corpora
- long-running autonomous tools

## Current limitations

The current implementation favors readability and architectural clarity over
completeness. That means several limits are explicit rather than hidden.

- The blueprint compiler is local and heuristic.
- Memory writeback is simple and window-bounded.
- Grouped work orchestration is local and single-node only.
- Draft publication is metadata-only and not a marketplace backend.
- The runtime uses local file-backed storage.
- The API is shaped for the bundled workspace.
- The project is still early-stage and exploratory.

## Open-source vision

The long-term open-source vision is not to publish another opaque "AI chat
app." The goal is to make the neural dialogue layer of Liberth legible,
extractable, and reusable as a public architecture artifact.

In practical terms, that means the project aims to move toward:

- a reusable runtime boundary that can live outside the main Liberth product
- inspectable role compilation instead of hidden prompt assembly
- portable neural records that other interfaces can replay or audit
- portable grouped-work records that other shells can inspect or publish
- local-first experimentation for memory policy, route policy, and provider
  policy
- community forks that can swap storage, providers, or UI shells without
  rewriting the core dialogue model

If that vision works, Liberth benefits from a cleaner dependency seam, and the
open-source ecosystem gets a small but concrete reference for explainable
character-runtime design.

## License

This repository is released under [AGPL-3.0-or-later](./LICENSE).

## Next steps

If you want to work on this repository as an architecture artifact, start with
[`server/neural-engine.ts`](./server/neural-engine.ts),
[`server/intent-router.ts`](./server/intent-router.ts), and
[`src/types.ts`](./src/types.ts). If you want to push it toward a reusable
open-source runtime, the next obvious steps are test coverage, release
packaging, stronger work-run replay tooling, and separation of the core
runtime from the browser workspace.
