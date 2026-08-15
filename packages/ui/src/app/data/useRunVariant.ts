import type { RunSubject } from "@test-cabinet/run-record";
import type { CatalogStatus } from "./galleryContext";
import type { VariantSummary } from "./testCases";
import { useTestCases } from "./useTestCases";

/** The resolution of a run's catalog variant, alongside the load state of the
 * catalog it was resolved against — so a caller can tell "still fetching" apart
 * from "this host does not have the case". */
export interface RunVariantState {
  /** The resolved variant, or undefined while the catalog is still loading and
   * whenever it holds no such case/variant. Always check {@link status} before
   * treating an undefined variant as unavailable. */
  variant: VariantSummary | undefined;
  /** The catalog's load state (see {@link CatalogStatus}). */
  status: CatalogStatus;
}

// Resolve the catalog variant a run exercised, so the run's Inputs tab can render
// the same prompt, specs, and references the test-case section does. A run record
// only records its subject's identity (test case slug, version, variant) — not the
// specs themselves — so we look the variant up in the injected catalog by slug and
// variant. The catalog carries the latest version's variants, so a run against an
// older version resolves against those — acceptable since variant specs rarely
// diverge across versions and the catalog has nothing older.
//
// The catalog's load state is returned alongside the variant because the two
// undefined cases are not the same thing: while the catalog is still loading
// nothing is resolvable *yet*, and reporting that as "unavailable" makes a wait
// read as a dead end. Only a `ready` catalog with no match is genuinely
// unavailable.
export function useRunVariant(subject: RunSubject): RunVariantState {
  const { testCases, status } = useTestCases();
  const testCase = testCases.find(
    (entry) => entry.slug === subject.testCaseSlug,
  );
  return {
    variant: testCase?.variants.find((entry) => entry.slug === subject.variant),
    status,
  };
}
