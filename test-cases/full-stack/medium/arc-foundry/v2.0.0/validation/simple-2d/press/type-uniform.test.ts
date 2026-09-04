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
// A LONG RUN, ON ONE FOOTPRINT. Each rock is dropped, read and dismantled, so the
// run is as long as the count below rather than as long as the yard has room for
// — dismantling returns nothing and reopens the tiles, which is exactly what a
// repeated draw needs. The bounds are the item's: every type appears, and no type
// takes more than a quarter of the draws. At this many rolls a uniform press
// clears both by a distance no plausible run of luck closes.

import { afterEach, beforeEach, it } from "vitest";

import {
  COMPONENT_TYPES,
  REFINEMENT_MAX,
  STAMPS_PER_LEVEL,
} from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  lastStructure,
  openYard,
  refillStamps,
  type Harness,
} from "../harness";

/** How many rocks are rolled. */
const ROLLS = 400;

/** The share of the draws no single type may take. */
const CEILING = 0.25;

/** The footprint every rock is dropped on. */
const AT = { col: 20, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every base type, and none of them more than a quarter of the time", async () => {
  // At the top of the refinement track, so a build that leaked the quality bias
  // into the type roll has every chance to show it.
  openYard(h, { refinement: REFINEMENT_MAX });

  const drawn = new Map<string, number>();
  for (let roll = 0; roll < ROLLS; roll += 1) {
    if (roll % STAMPS_PER_LEVEL === 0) refillStamps(h);
    h.debug.placeRock(AT.col, AT.row);
    const candidate = lastStructure(h.snapshot());
    const type = String(candidate.type);
    drawn.set(type, (drawn.get(type) ?? 0) + 1);
    // Dismantling returns nothing and reopens the tiles, so the next rock lands
    // on the same footprint and the run is as long as it needs to be.
    h.debug.dismantle(candidate.id);
  }

  h.debug.placeRock(AT.col, AT.row);
  await h.advance(1);
  captureStill(h, "spread");

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
