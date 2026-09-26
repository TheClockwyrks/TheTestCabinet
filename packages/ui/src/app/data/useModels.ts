import { useGalleryData, useGalleryDataOptional } from "./galleryContext";
import type { CatalogStatus } from "./galleryContext";
import type { ModelSummary } from "./models";

export interface ModelsState {
  /** The models to display. */
  models: ModelSummary[];
  /** The catalog's load state, so the UI can tell loading and an unreachable
   * backend apart from a genuinely empty catalog. */
  status: CatalogStatus;
}

// The Models section's data, resolved from the gallery context the host injects:
// the console fetches it from the backend (`GET /models`), the static site reads
// it from the build-time snapshot. A thin selector, mirroring `useTestCases`.
export function useModels(): ModelsState {
  const { models, modelsStatus } = useGalleryData();
  return { models, status: modelsStatus };
}

/**
 * A resolver from a run's `modelId` (optionally with its harness slug, for
 * harness-aware canonicalization) to its catalog entry, bound to the loaded
 * catalog. Use in components that translate a run to its model (the run log,
 * leaderboard, metric charts, home feature, failures list).
 */
export function useFindModel(): (
  modelId: string,
  harnessSlug?: string,
) => ModelSummary | undefined {
  const { modelForId } = useGalleryData();
  return modelForId;
}

/**
 * Like {@link useFindModel}, but resolves to a resolver only when a gallery
 * provider is actually in scope, and to `undefined` otherwise. For consumers that
 * enrich their view with the catalog when it is present but must still render
 * without it — the gg run views (live monitor, finished-run tab) derive a run's
 * per-class cost from catalog prices when they can, yet also render in a bare
 * harness context that never mounts the provider.
 */
export function useFindModelOptional():
  | ((modelId: string, harnessSlug?: string) => ModelSummary | undefined)
  | undefined {
  return useGalleryDataOptional()?.modelForId;
}
