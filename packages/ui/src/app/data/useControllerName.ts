import type { ControllerRef } from "@test-cabinet/run-record";
import { canonicalModelId } from "../../modelId";
import { useFindModel } from "./useModels";

// A resolver from an arena/tournament controller to its human name. A controller
// built by a run carries the run's model id in `label`, so resolve that to the
// model's catalog display name (falling back to the canonical id when the model
// is not in the catalog); a baseline has no label, so its id is already its human
// name. Mirrors the model-name resolution the run log and leaderboard use, so the
// arena, tournaments list, and tournament detail all show display names rather
// than raw model slugs.
export function useControllerName(): (c: ControllerRef) => string {
  const findModel = useFindModel();
  return (c) =>
    c.label ? (findModel(c.label)?.name ?? canonicalModelId(c.label)) : c.id;
}
