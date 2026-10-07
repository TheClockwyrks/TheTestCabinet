// Gantry — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// The assertions themselves are the shared validator harness's
// (`@clockwyrks/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every engineless project throws a message of exactly the shape
// the runner extracts. A case that wrote its own would be restating that
// contract, and a case that drifted from it would report a verdict the console
// could not render.
//
// This file stays because the suites next door say `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.
//
// TWO ARE ADDED HERE, and both are Gantry's own vocabulary rather than a new
// contract: the case states almost every tolerance as an absolute span in world
// units taken straight from `constants.ts` — `PLACE_POS_TOL`, `ATTACH_RADIUS`,
// `PLACE_YAW_TOL` — and almost every quantity it compares is a position.

export * from "./case-harness/assert";

import { assertNear, fail } from "./case-harness/assert";
import type { Vec3 } from "./surface";

/**
 * `actual` is within `tolerance` of `expected`, inclusive.
 *
 * The shared harness spells this `assertNear`, which is the name every other
 * engineless project uses; Gantry's suites read `assertClose`, and the two are
 * the same function rather than two tolerances. Both are exported so a check
 * copied from another case still compiles.
 *
 * IT IS NOT `assertCloseTo`, whose third argument is a DIGIT COUNT. Every
 * tolerance this case states is a span in world units, so `assertCloseTo` would
 * read a stated `0.6` as `0.5 * 10 ** -0.6`, a bound of `0.1256` that no
 * specification here sets — which is why the drawn-geometry points all assert
 * through this one.
 */
export const assertClose = assertNear;

/**
 * Two world positions are within `tolerance` of each other, measured as the
 * straight-line distance between them.
 *
 * Not three `assertNear`s on the axes: `specs/rigging.md` states the set-down
 * tolerance as one distance ("its lift point within `PLACE_POS_TOL` of the
 * target"), so a per-axis reading would pass a load `PLACE_POS_TOL` out on each
 * of three axes — over `1.7` times the tolerance the specification set.
 */
export function assertVec3Near(
  actual: Vec3,
  expected: Vec3,
  tolerance: number,
  context?: string,
): void {
  const gap = Math.hypot(
    actual.x - expected.x,
    actual.y - expected.y,
    actual.z - expected.z,
  );
  if (!Number.isFinite(gap) || gap > tolerance) {
    const where = `(${expected.x}, ${expected.y}, ${expected.z})`;
    fail(
      context === undefined
        ? `within ${tolerance} of ${where}`
        : `within ${tolerance} of ${where} (${context})`,
      `(${actual.x}, ${actual.y}, ${actual.z}), ${gap.toFixed(4)} away`,
    );
  }
}
