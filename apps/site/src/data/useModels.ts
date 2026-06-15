import { models as catalogModels } from "./models";
import { sampleModels } from "./sampleModels";
import type { ModelSummary } from "./models";

export interface ModelsState {
  /** The models to display. */
  models: ModelSummary[];
  /** True when the displayed models are design-preview samples, not the catalog. */
  usingSamples: boolean;
}

// Assembles the Models section's data. Mirrors `useTestCases`: it shows the
// published catalog dataset (`models.json`) when it has entries and falls back
// to the design-preview samples only when the catalog is empty. The catalog is
// fully static, so this is a plain selector rather than an effect.
export function useModels(): ModelsState {
  const usingSamples = catalogModels.length === 0;
  return {
    models: usingSamples ? sampleModels : catalogModels,
    usingSamples,
  };
}
