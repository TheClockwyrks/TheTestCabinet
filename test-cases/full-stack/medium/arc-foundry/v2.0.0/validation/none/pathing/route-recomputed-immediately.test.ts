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
// SO NO FRAME IS RUN. The reading is taken either side of the call that lands the
// rock and either side of the call that dismantles it, with the simulation clock
// held still across all four, and the figure has to have moved anyway.

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

afterEach(async () => {
  await h.dispose();
});

it("moves the maze length on the placement itself, with no frame between", async () => {
  await openYard(h);
  const empty = await h.snapshot();

  const id = await standCandidate(h, "capacitor", 1, AT.col, AT.row);
  const landed = await h.snapshot();
  await captureStill(h, "immediate");

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

  await h.debug.dismantle(id);
  const removed = await h.snapshot();

  assertCloseTo(
    removed.mazeLength,
    empty.mazeLength,
    6,
    `the maze length on the call that dismantled it, with no frame advanced ` +
      `since the ${landed.mazeLength} the walled yard read`,
  );
  assertEqual(
    removed.simTime,
    empty.simTime,
    "the simulation clock across the dismantle: no frame was advanced",
  );
});
