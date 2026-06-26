import type { TestCaseSummary } from "./testCases";
import type { CatalogStatus } from "./galleryContext";
import { useGalleryData } from "./galleryContext";

export interface TestCasesState {
  /** The test cases to display. */
  testCases: TestCaseSummary[];
  /** The catalog's load state: loading, ready (possibly empty), or error (the
   * host could not reach its source). See {@link CatalogStatus}. */
  status: CatalogStatus;
}

// The Test Cases section's data, read from the injected data source (see
// galleryContext). Each host resolves the catalog its own way — the consoles
// from a backend, the static site from the build-time snapshot — and reports its
// load state; this is a thin selector over that context, so the pages that
// consume it stay the same.
export function useTestCases(): TestCasesState {
  const { testCases, testCasesStatus } = useGalleryData();
  return { testCases, status: testCasesStatus };
}
