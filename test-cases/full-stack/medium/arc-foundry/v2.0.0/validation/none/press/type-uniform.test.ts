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
// through the placement path. The rate is the spec's, `0.125` a type, and the
// band each type's count is held to is derived from that figure alone: its
// expected count over the sample, six standard deviations either side. A press
// rolling at the stated rate never falls outside a band that wide by chance, and
// the alternatives the spec makes meaningful — a type never rolled, a type
// rolled at twice its share — sit outside it.

import { afterEach, beforeEach, it } from "vitest";
import {
  COMPONENT_TYPES,
  REFINEMENT_MAX,
  SAMPLE_BAND_SIGMAS,
  TYPE_ROLL_ODDS,
} from "../constants";
import { assertBetween, assertContains } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** How many rolls are drawn. */
const ROLLS = 400;

/** The count a type's share of the sample comes to: `50` of `400`. */
const EXPECTED = ROLLS * TYPE_ROLL_ODDS;

/** The standard deviation of that count over a binomial sample: `6.6`. */
const SIGMA = Math.sqrt(ROLLS * TYPE_ROLL_ODDS * (1 - TYPE_ROLL_ODDS));

/** The band a type's count is held to, six standard deviations either side. */
const FLOOR = Math.ceil(EXPECTED - SAMPLE_BAND_SIGMAS * SIGMA);
const CEILING = Math.floor(EXPECTED + SAMPLE_BAND_SIGMAS * SIGMA);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each base type at its uniform share, inside a six-sigma band", async () => {
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

  for (const type of COMPONENT_TYPES) {
    assertBetween(
      drawn.get(type) ?? 0,
      FLOOR,
      CEILING,
      `draws of \`${type}\` in ${ROLLS} rolls, over a type axis uniform at ` +
        `${TYPE_ROLL_ODDS} for each of the ${COMPONENT_TYPES.length} base types ` +
        `(specs/scrap-press.md), inside ${SAMPLE_BAND_SIGMAS} standard ` +
        `deviations of ${EXPECTED}`,
    );
  }
});
