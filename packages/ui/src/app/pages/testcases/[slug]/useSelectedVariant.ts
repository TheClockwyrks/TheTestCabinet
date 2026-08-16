import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";

// The query-string key the selected variant is carried in. Keeping the variant
// in the URL (rather than component state) is what lets the single page-level
// selector drive every tab at once and survive navigation between them, and
// makes a specific variant's page linkable.
const VARIANT_PARAM = "variant";

/**
 * Resolve the variant the visitor has selected for a case, reading it from the
 * `?variant=` query string and falling back to the default (first) variant.
 *
 * Returns the resolved variant — `undefined` only when the case itself has no
 * variants — and a setter that writes the selection back to the URL. The default
 * variant is represented as the absence of the parameter so its URL stays clean;
 * the write replaces the history entry so flipping variants does not pile up
 * back-button stops.
 */
export function useSelectedVariant(
  testCase: TestCaseDetail | undefined,
): [VariantSummary | undefined, (slug: string) => void] {
  const [params, setParams] = useSearchParams();
  const variants = testCase?.variants ?? [];
  const requested = params.get(VARIANT_PARAM);
  const selected = variants.find((v) => v.slug === requested) ?? variants[0];

  const setVariant = useCallback(
    (slug: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (variants[0]?.slug === slug) {
            next.delete(VARIANT_PARAM);
          } else {
            next.set(VARIANT_PARAM, slug);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams, variants],
  );

  return [selected, setVariant];
}
