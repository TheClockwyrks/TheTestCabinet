// pathing/route-recomputed-immediately — the route is recomputed the moment the
// walls change, not on the next frame.
//
// WHY THE TIMING IS A REQUIREMENT RATHER THAN A DETAIL. The maze length is what
// the player builds against: `specs/hud.md` has the status bar update it the
// instant a placement or a dismantle changes the route, and the whole build phase
// is untimed precisely so that the player can place, read, dismantle and place
// again. A build that recomputes on its next update shows the previous yard's
// figure for as long as the player leaves the game alone — which, in a build
// phase, is as long as they like.
//
// SO NO FRAME IS RUN ACROSS EITHER CHANGE. A pose and a reading are both
// synchronous under this engine, so the reading is taken either side of the call
// that lands the rock and either side of the call that dismantles it with the
// simulation clock held still across each pair, and the figure has to have moved
// anyway. The one frame between the two pairs is the frame that draws the walled
// yard for the evidence, and each pair is measured from its own side of it.

import { afterEach, beforeEach, it } from "vitest";

import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";

/** The footprint that is landed and then taken away, across the first leg. */
const AT = { col: 20, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the maze length on the placement itself, with no frame between", async () => {
  openYard(h);
  const empty = h.snapshot();

  const id = standCandidate(h, "capacitor", 1, AT.col, AT.row);
  const landed = h.snapshot();

  assertGreaterThan(
    landed.mazeLength,
    empty.mazeLength,
    `the maze length on the call that landed a rock at (${AT.col}, ${AT.row}), ` +
      `with no frame advanced since the ${empty.mazeLength} the empty yard read`,
  );
  assertEqual(
    landed.simTime,
    empty.simTime,
    "the simulation clock across the placement: no frame was advanced",
  );

  // The frame that draws the walled yard, so the evidence shows what was built.
  await h.advance(1);
  captureStill(h, "immediate");
  const walled = h.snapshot();

  h.debug.dismantle(id);
  const removed = h.snapshot();

  assertCloseTo(
    removed.mazeLength,
    empty.mazeLength,
    6,
    `the maze length on the call that dismantled it, with no frame advanced ` +
      `since the ${walled.mazeLength} the walled yard read`,
  );
  assertEqual(
    removed.simTime,
    walled.simTime,
    "the simulation clock across the dismantle: no frame was advanced",
  );
});
