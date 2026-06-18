import { testCases as catalogTestCases } from "./testCases";
import { sampleTestCases } from "./sampleTestCases";
import type { TestCaseSummary } from "./testCases";

export interface TestCasesState {
  /** The test cases to display. */
  testCases: TestCaseSummary[];
  /** True when the displayed cases are design-preview samples, not the catalog. */
  usingSamples: boolean;
}

// Assembles the Test Cases section's data. Mirrors `useRuns`: it shows the
// published catalog dataset (the backend's R2 snapshot) when it has entries, and
// falls back to the design-preview samples only when the catalog is empty so the
// UI always has content. Unlike runs, the catalog is fully static (no dev-only
// on-disk merge), so this is a plain selector rather than an effect.
export function useTestCases(): TestCasesState {
  const usingSamples = catalogTestCases.length === 0;
  return {
    testCases: usingSamples ? sampleTestCases : catalogTestCases,
    usingSamples,
  };
}
