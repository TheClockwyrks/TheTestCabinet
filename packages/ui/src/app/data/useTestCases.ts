import type { TestCaseSummary } from "./testCases";
import { useGalleryData } from "./galleryContext";

export interface TestCasesState {
  /** The test cases to display. */
  testCases: TestCaseSummary[];
  /** True when the displayed cases are design-preview samples, not the catalog. */
  usingSamples: boolean;
}

// The Test Cases section's data, read from the injected data source (see
// galleryContext). Each host decides whether the catalog is the published one or
// the design-preview samples; this is a thin selector over that context, so the
// pages that consume it stay the same.
export function useTestCases(): TestCasesState {
  const { testCases, testCasesUsingSamples } = useGalleryData();
  return { testCases, usingSamples: testCasesUsingSamples };
}
