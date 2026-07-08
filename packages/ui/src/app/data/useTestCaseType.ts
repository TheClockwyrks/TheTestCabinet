import type { TestType } from "@test-cabinet/run-record";
import { useTestCases } from "./useTestCases";

// A resolver bound to the host's current catalog, mapping a run's `testCaseSlug`
// to its test type. Every surface that has only a run's slug (notably the run
// log's in-progress rows, which carry launch identity and not a produced record)
// uses this to show the run's category before it finishes. Returns null when the
// catalog doesn't know the slug, so the caller can fall back to a placeholder.
export function useTestCaseType(): (slug: string) => TestType | null {
  const { testCases } = useTestCases();
  return (slug) => testCases.find((c) => c.slug === slug)?.testType ?? null;
}
