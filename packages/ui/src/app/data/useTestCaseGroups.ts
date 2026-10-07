import type { TestCaseGroupSummary } from "./testCases";
import { useGalleryData } from "./galleryContext";

// The repo-defined test-case groups, read from the injected data source (see
// galleryContext) — the thin selector the home page's per-group leaderboards
// consume, beside `useTestCases`. Each host resolves the set its own way (the
// consoles from `GET /test-case-groups`, the static site from the snapshot),
// already in display order; a host that supplies none reads as an empty set,
// and the group section simply does not render.
export function useTestCaseGroups(): TestCaseGroupSummary[] {
  const { testCaseGroups } = useGalleryData();
  return testCaseGroups ?? [];
}
