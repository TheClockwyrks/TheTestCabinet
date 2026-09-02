// hunter/one-axis-at-a-time — no tick moves a bear along both grid axes.
//
// specs/hunter.md states it as a property that holds on every tick: "a tick moves
// a bear along one axis, so no tick changes both its center `x` and its center
// `y`". A bear travels one grid axis at a time and never diagonally, and the
// leftover travel at a tile centre is carried into the NEXT tick rather than
// spent turning the corner within this one.
//
// So the reading is every tick of a real pursuit, taken one tick apart — the
// finest grain the fixed timestep has — and the verdict is that not one of them
// moved the centre on both axes. The bear runs with all three of its faculties,
// because the property is about its travel under its own routing rather than
// under a posed step.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR } from "../constants";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { axisMoved, samplePerTick } from "./harness";

/**
 * The pursuit: a bear three tiles across and three tiles up from the critter.
 *
 * Both differ, so every shortest route between them turns, and six tiles at
 * `BEAR_ICE_SPEED` (3) tiles a second is two seconds of the four — so the corner
 * this property is really about is driven well inside the window. Both tiles are
 * on the ice band, where an emptied strait leaves nothing to interfere.
 */
const BEAR_COL = 20;
const BEAR_ROW = ROW_NEAR - 1;
const CRITTER_COL = BEAR_COL + 3;
const CRITTER_ROW = BEAR_ROW - 3;

/** The seconds of pursuit read, from the item. */
const PURSUIT_SECONDS = 4;

/**
 * Units of movement below which a tick is read as having moved nothing.
 *
 * At level 1 the slowest travel `specs/hunter.md` states is `BEAR_SWIM_SPEED` (2)
 * tiles a second, which is `0.53` units in a tick, so any movement a build means
 * is hundreds of thousands of times this. What is under it is the last bits of a
 * double, not a diagonal.
 */
const MOVE_EPSILON = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the bear along one axis on every tick of a pursuit", async () => {
  startCrossing(h);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const id = poseBear(h, BEAR_COL, BEAR_ROW);

  const samples = await captureReplay(h, "glide", () =>
    samplePerTick(h, ticksFor(PURSUIT_SECONDS)),
  );

  const diagonal: string[] = [];
  let moved = 0;
  for (let k = 1; k < samples.length; k += 1) {
    const before = samples[k - 1].bears.find((entry) => entry.id === id);
    const after = samples[k].bears.find((entry) => entry.id === id);
    if (before === undefined || after === undefined) continue;
    const axis = axisMoved(before, after, MOVE_EPSILON);
    if (axis === "x" || axis === "y") moved += 1;
    if (axis === "both") {
      diagonal.push(
        `tick ${k}: (${before.x}, ${before.y}) to (${after.x}, ${after.y})`,
      );
    }
  }

  // The property below is one a bear that never moved would satisfy without
  // travelling at all, so the scenario is confirmed first: the pursuit really did
  // carry the bear somewhere.
  assertGreaterThanOrEqual(
    moved,
    1,
    `ticks of ${PURSUIT_SECONDS} s of pursuit that moved the bear at all`,
  );
  assertLength(
    diagonal,
    0,
    `ticks of ${PURSUIT_SECONDS} s of pursuit that moved the bear on both ` +
      `axes: ${diagonal.slice(0, 3).join("; ")}`,
  );
});
