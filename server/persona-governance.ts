import type { CharacterRecord, RoleBlueprint, RoleDefinitionInput } from "../src/types";
import type { LlmRuntimeConfig } from "./llm";
import { generateBlueprint, stabilizeRoleDefinition } from "./roles";

export async function buildGovernedBlueprint(
  definition: RoleDefinitionInput,
  config?: LlmRuntimeConfig,
): Promise<RoleBlueprint> {
  return generateBlueprint(stabilizeRoleDefinition(definition), config);
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
  const nextDefinition = stabilizeRoleDefinition(character.definition);
  const definitionChanged =
    JSON.stringify(nextDefinition) !== JSON.stringify(character.definition);
  const needsBlueprint =
    definitionChanged
    || !character.blueprint?.summary
    || !character.blueprint?.profile
    || !character.blueprint?.neuralGraph
    || !character.blueprint?.bundleFiles;
  if (!needsBlueprint) {
    return {
      ...character,
      definition: nextDefinition,
      globalMemories: Array.isArray(character.globalMemories) ? character.globalMemories : [],
      lastNeuralState: character.lastNeuralState || null,
    };
  }

  const blueprint = await buildGovernedBlueprint(nextDefinition, config);
  return applyGovernedBlueprint(
    {
      ...character,
      definition: nextDefinition,
      updatedAt: definitionChanged ? Date.now() : character.updatedAt,
    },
    blueprint,
  );
}
