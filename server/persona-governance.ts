import type { CharacterRecord, RoleBlueprint, RoleDefinitionInput } from "../src/types";
import type { LlmRuntimeConfig } from "./llm";
import { generateBlueprint } from "./roles";

export async function buildGovernedBlueprint(
  definition: RoleDefinitionInput,
  config?: LlmRuntimeConfig,
): Promise<RoleBlueprint> {
  return generateBlueprint(definition, config);
}

export function applyGovernedBlueprint(
  character: CharacterRecord,
  blueprint: RoleBlueprint,
): CharacterRecord {
  return {
    ...character,
    blueprint,
    globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
    lastNeuralState: character.lastNeuralState || null,
    updatedAt: Date.now(),
  };
}

export async function ensureGovernedCharacter(
  character: CharacterRecord,
  config?: LlmRuntimeConfig,
): Promise<CharacterRecord> {
  const needsBlueprint =
    !character.blueprint?.profile
    || !character.blueprint?.neuralGraph
    || !character.blueprint?.bundleFiles;
  if (!needsBlueprint) {
    return {
      ...character,
      globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
      lastNeuralState: character.lastNeuralState || null,
    };
  }

  const blueprint = await buildGovernedBlueprint(character.definition, config);
  return applyGovernedBlueprint(character, blueprint);
}
