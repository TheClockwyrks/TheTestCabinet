// press/type-uniform — the press rolls a type uniformly over the eight base
// types, and refinement never touches that axis.
//
// TWO AXES, AND ONLY ONE OF THEM IS BUYABLE. `specs/scrap-press.md` rolls type
// and quality independently: quality is what the refinement track biases, and
// type stays flat at `0.125` each for the whole run. That is what makes a
// recipe's ingredient list a matter of patience rather than of purchase, and a
// build whose type roll drifts toward a favourite makes half the recipe book
// unreachable while the recipe overlay goes on offering it.
//
// A BOUNDED SAMPLE OF THE ONE DRAW. `specs/instrumentation.md` carries
// `rollPress`, which performs one press roll exactly as a dropped rock rolls and
// lands nothing, so the sample is the draw alone rather than four hundred trips
// through the placement path. The bounds are the item's: every type appears, and
// no type takes more than a quarter of the draws. At this many rolls a uniform
// press clears both by a distance no plausible run of luck closes — a type's
// count sits at `50 ± 6.6`, so a quarter of the draws is seven standard
// deviations out, and a type never drawn at all is beyond any count.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { COMPONENT_TYPES, REFINEMENT_MAX, TYPE_ROLL_ODDS } from "../constants";
import { captureStill, createHarness, openYard, type Harness } from "../harness";

/** How many rolls are drawn. */
const ROLLS = 400;

/**
 * The share of the draws no single type may take: twice its own uniform share.
 *
 * `specs/scrap-press.md` fixes the roll as uniform over the eight base types, so a
 * type taking more than double its share over four hundred rolls is a bias rather
 * than the sampling noise a fair roll leaves.
 */
const CEILING = TYPE_ROLL_ODDS * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every base type, and none of them more than a quarter of the time", async () => {
  // At the top of the refinement track, so a build that leaked the quality bias
  // into the type roll has every chance to show it.
  await openYard(h, { refinement: REFINEMENT_MAX });

  const drawn = new Map<string, number>();
  for (let roll = 0; roll < ROLLS; roll += 1) {
    const { type } = await h.debug.rollPress();
    assertContains(COMPONENT_TYPES, type, `the type roll ${roll + 1} drew`);
    drawn.set(type, (drawn.get(type) ?? 0) + 1);
  }

  await h.advance(1);
  await captureStill(h, "spread");

  const ceiling = Math.floor(ROLLS * CEILING);
  for (const type of COMPONENT_TYPES) {
    const count = drawn.get(type) ?? 0;
    assertGreaterThan(
      count,
      0,
      `draws of \`${type}\` in ${ROLLS} rolls, over a type axis uniform at ` +
        `0.125 for each of the ${COMPONENT_TYPES.length} base types`,
    );
    assertLessThanOrEqual(
      count,
      ceiling,
      `draws of \`${type}\` in ${ROLLS} rolls, against a quarter of them`,
    );
  }
});
