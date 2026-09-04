// world/buildings-separated — the camp's buildings stand apart from one another.
//
// `specs/world.md`: "No two footprints overlap, and any two footprints are
// separated horizontally by at least `BUILDING_GAP` (`40`) units of clear
// ground." One measurement says both: a pair separated by forty units of clear
// ground is a pair that does not overlap, so the two clauses are the same rule
// read at one bound rather than two behaviors.
//
// THE CAVE MOUTH IS ITS OWN POINT. `world/buildings-clear-of-the-cave-mouth`
// decides that no footprint stands over the one way down out of the camp, which
// is a separate rule about a separate thing: a camp whose buildings are properly
// spaced and whose shaft is blocked must grade differently from one where neither
// holds.
//
// The gap is measured between every pair, in both orders, and reported naming the
// two buildings that are too close.

import { afterEach, beforeEach, it } from "vitest";
import { BUILDING_GAP } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { campFootprints } from "./buildings";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves 40 units of clear ground between any two buildings", async () => {
  const boxes = await campFootprints(h);
  captureStill(h, "gaps");

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      assertGreaterThanOrEqual(
        gap,
        BUILDING_GAP,
        `clear ground between "${a.id}" and "${b.id}"`,
      );
    }
  }
});
