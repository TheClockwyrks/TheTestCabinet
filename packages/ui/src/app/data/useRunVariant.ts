import type { RunSubject } from "@test-cabinet/run-record";
import type { CatalogStatus } from "./galleryContext";
import type { VariantSummary } from "./testCases";
import { useTestCase } from "./useTestCase";

/** The resolution of a run's catalog variant, alongside the load state of the
 * catalog it was resolved against — so a caller can tell "still fetching" apart
 * from "this host does not have the case". */
export interface RunVariantState {
  /** The resolved variant, or undefined while the case is still being fetched
   * and whenever this host holds no such case/variant. Always check
   * {@link status} before treating an undefined variant as unavailable. */
  variant: VariantSummary | undefined;
  /** The case fetch's load state (see {@link CatalogStatus}). */
  status: CatalogStatus;
}

// Resolve the catalog variant a run exercised, so the run's Inputs tab can render
// the same prompt, specs, and references the test-case section does. A run record
// only records its subject's identity (test case slug, version, variant) — not the
// specs themselves — so we fetch the run's case by slug and look the variant up in
// it. The case detail carries the latest version's variants, so a run against an
// older version resolves against those — acceptable since variant specs rarely
// diverge across versions and the catalog has nothing older.
//
// The load state is returned alongside the variant because the two undefined
// cases are not the same thing: while the case is still being fetched nothing is
// resolvable *yet*, and reporting that as "unavailable" makes a wait read as a
// dead end. Only a settled fetch with no match is genuinely unavailable.
export function useRunVariant(subject: RunSubject): RunVariantState {
  const { testCase, status } = useTestCase(subject.testCaseSlug);
  return {
    variant: testCase?.variants.find((entry) => entry.slug === subject.variant),
    status,
  };
}
