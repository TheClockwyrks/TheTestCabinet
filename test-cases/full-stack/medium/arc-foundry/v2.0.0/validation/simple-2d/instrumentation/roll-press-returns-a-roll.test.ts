// instrumentation/roll-press-returns-a-roll — `rollPress` returns what one
// press roll decided.
//
// `specs/instrumentation.md`: "`type` is one of the eight base component
// identifiers and `quality` is a tier the current refinement level's row of
// `REFINEMENT_ODDS` gives a non-zero weight." The two rows that make the second
// half readable without a sample's luck are the ends of the track: `R0` weights
// Scrap alone, so every roll is quality `1`, and `R8` weights Scrap at zero, so
// no roll is. Every return is held to the row it was drawn under.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import { COMPONENT_TYPES, REFINEMENT_MAX, REFINEMENT_ODDS } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** How many rolls are drawn at each end of the track. */
const ROLLS = 60;

/** The tiers a row weights above zero, numbered from `1`. */
function reachable(level: number): number[] {
  return REFINEMENT_ODDS[level]!.map((weight, index) =>
    weight > 0 ? index + 1 : 0,
  ).filter((tier) => tier !== 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns a base type and a tier the current row weights", async () => {
  openYard(h);
  for (const level of [0, REFINEMENT_MAX]) {
    h.debug.setRefinement(level);
    const tiers = reachable(level);
    for (let roll = 0; roll < ROLLS; roll += 1) {
      const drawn = h.debug.rollPress();
      assertContains(
        COMPONENT_TYPES,
        drawn.type,
        `the type of roll ${roll + 1} at R${level} (specs/instrumentation.md)`,
      );
      assertContains(
        tiers,
        drawn.quality,
        `the quality of roll ${roll + 1} at R${level}, whose row weights tiers ` +
          `${tiers.join(", ")} (specs/scrap-press.md)`,
      );
    }
  }
  await h.advance(1);
  captureStill(h, "rolled");
});
