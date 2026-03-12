# Liberth Neural

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL%20v3-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-43853d.svg)](https://nodejs.org/)

Liberth Neural is an open-source neural character studio for building role-driven conversational agents.

It turns a plain-text role definition into a structured persona profile, a local neural bundle, a runnable system prompt, and a chat-ready character with durable memory.

This project is intentionally narrow. It focuses on neural-character dialogue, not avatar cloning, voice cloning, vision pipelines, or scraped digital-twin reconstruction.

## Features

- Build a character from text fields such as tone, personality, goals, boundaries, and memory cues.
- Compile character definitions into local bundle files such as `AGENTS.md`, `SOUL.md`, and `NEURAL.md`.
- Run a local neural-route model with character actions like `respond`, `clarify`, `learn`, `reflect`, and `tool`.
- Test and iterate in a browser-based chat workspace.
- Persist character memory locally for stable long-term behavior.
- Use either Zhipu GLM or any OpenAI-compatible API endpoint.

## Non-Goals

- Voice cloning
- Face or avatar generation
- Vision analysis
- Scraped persona reconstruction
- Human identity impersonation

## Tech Stack

- React 18
- Vite 5
- Express 4
- TypeScript 5
- esbuild
- tsx

## Requirements

- Node.js `>= 18.18.0`
- npm

## Quick Start

```bash
git clone https://github.com/Libre-Connect/liberth-neural.git
cd liberth-neural
npm install
cp .env.example .env
npm run dev
```

Open the client at `http://localhost:5178`.

## Scripts

```bash
npm run dev          # start server + client
npm run dev:server   # start the Express API
npm run dev:client   # start the Vite client
npm run build        # build client and server
npm run start        # run the built server
npm run typecheck    # run TypeScript checks
```

## Environment

Liberth Neural can run with either GLM or an OpenAI-compatible API.

Main variables:

- `ZHIPUAI_API_KEY`
- `GLM_API_KEY`
- `BIGMODEL_API_KEY`
- `LIBERTH_NEURAL_GLM_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `CHARACTER_BUILDER_MODEL`
- `PORT`

See [.env.example](.env.example) for a working template.

## Project Structure

```text
src/                      React client
server/                   Express API and neural runtime
server/neural-engine.ts   Persona extraction and neural state engine
server/prompting.ts       System and platform prompt assembly
data/                     Local runtime store
skills/                   Optional local skills
```

## Local Data

Runtime data is stored in:

```text
data/store.json
```

That file is intentionally git-ignored. Treat it as local state, not source.

## Development Notes

- The project is self-contained and does not import code from a parent monorepo.
- The neural engine lives inside this repository.
- The open-source surface is optimized for character simulation and chat iteration.

## License

This project is licensed under `AGPL-3.0-or-later`. See [LICENSE](LICENSE).
