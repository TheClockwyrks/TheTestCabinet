import type { RunSubject } from "@test-cabinet/run-record";
import type { VariantSummary } from "./testCases";
import { useTestCases } from "./useTestCases";

// Resolve the catalog variant a run exercised, so the run's Specifications and
// References tabs can render the same specs/references the test-case section
// does. A run record only records its subject's identity (test case slug,
// version, variant) — not the specs themselves — so we look the variant up in the
// injected catalog by slug and variant. Returns `undefined` when the case or
// variant is not in the catalog (e.g. it has since been removed, or the run's
// version predates the catalog's variants), which the tabs turn into an
// unavailable state. The catalog carries the latest version's variants, so a run
// against an older version resolves against those — acceptable since variant
// specs rarely diverge across versions and the catalog has nothing older.
export function useRunVariant(
  subject: RunSubject,
): VariantSummary | undefined {
  const { testCases } = useTestCases();
  const testCase = testCases.find((entry) => entry.slug === subject.testCaseSlug);
  return testCase?.variants.find((entry) => entry.slug === subject.variant);
}
