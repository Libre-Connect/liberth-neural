import type { CharacterRecord, MarketListingRecord, WorkRunRecord } from "../src/types";
import { buildDraftListing } from "./work-bridge";

export function maybeCreateDraftListing(input: {
  character: CharacterRecord;
  workRun: WorkRunRecord;
}): MarketListingRecord | null {
  if (!input.workRun.publicationCandidate) {
    return null;
  }

  const publicationArtifact =
    [...input.workRun.artifacts]
      .reverse()
      .find((artifact) => artifact.kind === "delivery" || artifact.kind === "publication")
    || input.workRun.artifacts[input.workRun.artifacts.length - 1];

  if (!publicationArtifact) {
    return null;
  }

  return buildDraftListing({
    character: input.character,
    workRun: input.workRun,
    artifact: publicationArtifact,
  });
}
