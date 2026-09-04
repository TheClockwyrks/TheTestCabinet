// progression/setback-screen — a cell spent with cells remaining reaches the
// setback screen.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings", one row of
// its table: "| A cell spent with cells remaining | `setback` | the same level,
// after the interlude |". `specs/ui.md` names the same screen among the seven.
//
// WHY IT IS A POINT. It is the fork the run takes on every spend but the last,
// and it is the one a build is most likely to leave unfinished: a build that
// spends the cell correctly and drops straight back into `playing`, or that ends
// the run on the first spend, passes every other cell point and fails this one.
// `progression/game-over` decides the other side of the same fork.
//
// THE DRIVE. One arrival over a hall left at the three cells a run opens with, so
// the spend is one "with cells remaining". The reading is the screen on the tick
// the cell count moved.
//
// TOLERANCE. None: a screen name is one of seven and the case grades it exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { driveArrival, type Setback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to the setback screen when a cell is spent with cells remaining", async () => {
  const setback: Setback = await captureReplay(h, "setback", () =>
    driveArrival(h),
  );

  // The spend really was one with cells remaining, which is the branch the row
  // covers: a hall posed with one cell would take the other one.
  assertGreaterThan(
    setback.spent.cells,
    0,
    "the cells left after the spend, which is what makes it a setback",
  );
  assertEqual(
    setback.spent.screen,
    "setback",
    "the screen on the tick a cell was spent with cells remaining",
  );
});
