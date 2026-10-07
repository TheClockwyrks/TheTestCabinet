import type { TestCaseSummary } from "./testCases";

// Which cases carry a bundled REFERENCE PLAYBACK — the third shape a case's reference
// takes, beside a deployed `referenceBuild` and a published `referenceSheet`.
//
// The other two are per-variant signals the backend sends with the catalog. This one
// is not, and cannot be: a performance case's reference is its scored factories
// played through the authoritative engine, and both the engine and the scenarios
// SHIP WITH THE UI BUNDLE (vendored from the case bundle by
// `scripts/vendor-lattice-assets.mjs`; see `pages/runs/lattice/reference.ts`). There
// is nothing for a host to send, and nothing for a host to be missing — the tab works
// identically on the web console and the static site, with no backend
// and no snapshot bucket.
//
// The trade-off of shipping it rather than serving it is that the set is fixed at
// build time, so the predicate has to name the case it was vendored for. Keying on
// the test type ALONE would show Lattice's factories on any future performance case,
// confidently and wrongly.

/**
 * The performance case whose reference factories are vendored into this bundle.
 * Matches the on-disk slug of `test-cases/performance/hard/lattice/`, which is where
 * `scripts/vendor-lattice-assets.mjs` copies them from.
 */
export const REFERENCE_PLAYBACK_SLUG = "lattice";

/**
 * Whether this case's reference is a browser playback of its scored factories.
 *
 * Read by the detail layout (to offer the Reference tab at all) and by the Reference
 * page (to pick which of the three reference views to render), so the two can never
 * disagree about whether the tab has a body.
 */
export function hasReferencePlayback(testCase: TestCaseSummary): boolean {
  return (
    testCase.testType === "performance" &&
    testCase.slug === REFERENCE_PLAYBACK_SLUG
  );
}
