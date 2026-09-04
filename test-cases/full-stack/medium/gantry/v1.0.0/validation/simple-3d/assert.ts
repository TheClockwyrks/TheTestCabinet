// Gantry — the suite's assertions, for a build on the SIMPLE 3D engine.
// CASE-PROVIDED, over the shared harness.
//
// THE SAME VOCABULARY THE ENGINELESS PROJECT ASSERTS THROUGH, and reached the
// same way rather than copied out of it. What matters is that every name, every
// signature and every message is the same, so a `<category>/<id>.test.ts` file
// importing `from "../assert"` is the same file in all three engines'
// directories — and the cheapest way to hold that is for all three to say the
// same thing.
//
// THE SHARED HARNESS IS STAGED HERE TOO, which is the fact that decides it. The
// runner copies `validation/<engine>/` into the produced tree and then lays
// `@test-cabinet/case-harness` down beside it, for every engine rather than for
// `none` alone; fifty-nine files in this directory already read draw calls and
// text through `../case-harness/…`. Its assertions import nothing whatsoever —
// no browser, no page, no Playwright — so an engine project takes them exactly as
// an engineless one does, and there is no second list to keep in step by hand.
//
// The helpers themselves are the runner's contract rather than this case's: it
// stores each failed check as an expected/actual pair and the console renders
// that pair to the reviewer, so every check in every project throws a message of
// exactly the shape the runner extracts. A case that wrote its own would be
// restating that contract, and a case that drifted from it would report a verdict
// the console could not render.
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
 * project uses; Gantry's suites read `assertClose`, and the two are the same
 * function rather than two tolerances. Both are exported so a check copied from
 * another case still compiles.
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
