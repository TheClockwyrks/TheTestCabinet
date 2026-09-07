// board/pellet-avoids-obstacles — no pellet the game places lands on the course.
//
// WHAT THE SPECIFICATION FIXES. specs/board.md's valid set, the set a pellet is
// "drawn from ... at a uniformly random cell", holds a cell only when all four of
// its conditions hold, and one of them is "It is not an obstacle cell."
// specs/mode.md says the same from the course's side: "An obstacle cell is never
// a valid pellet cell, so a pellet never spawns on the course. It counts against
// the valid set that decides the board-cleared win."
//
// THE DRAW IS POSED RATHER THAN SAMPLED. There is no way to ask a build what its
// valid set is, and a run of draws long enough to catch a build that ignores the
// course only ever makes the miss unlikely. So a cell of the course is posed as
// the next spawn with `setNextPellet`, which specs/instrumentation.md honors
// "when the cell is in the valid set specs/board.md defines at that moment" and
// discards otherwise. A build that keeps the course out of its valid set drops
// the pose and draws elsewhere; a build that does not puts the pellet on the
// obstacle it was handed. The meal is placed by hand with `setPellet`, which "is
// not spawning one", so what is read is the build's own spawn and nothing else.
//
// THE COURSE IS THE BUILD'S OWN, read back off the board, because whether the
// laid course is the right eighteen cells is `board/obstacles-layout`. What this
// point asks is whether the cells a build treats as obstacles are kept out of its
// draw.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import type { Cell } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  holdsCell,
  type Harness,
} from "../harness";

/** Ticks of clear travel before the head reaches the pellet. */
const RUN_UP = 3;

/** Ticks run after the eat, with the chain held, so the board is seen settled. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never spawns a pellet on a cell of the course", async () => {
  // The course as the build lays it, so the cell posed is one it really holds.
  // The chain runs along the starting row, which specs/mode.md keeps clear.
  const scene = arrangeEat(h, {
    obstacles: "course",
    pelletRespawn: true,
    runUp: RUN_UP + 1,
  });
  const course = scene.snapshot.obstacles;
  assertGreaterThan(
    course.length,
    0,
    "obstacle cells on the board of a mode that lays a course",
  );
  const target: Cell = course[0];
  h.debug.setNextPellet(target.col, target.row);

  const after = await captureReplay(h, "avoid", async () => {
    await h.tick(RUN_UP);
    const eaten = await h.tick();
    h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return eaten;
  });

  assertEqual(after.screen, "playing", "the round after the eat");
  assertNotNull(after.pellet, "a replacement pellet after the eat");
  const pellet = after.pellet as Cell;
  assertEqual(
    holdsCell(course, pellet),
    false,
    `the pellet drawn at (${pellet.col}, ${pellet.row}) with (${target.col}, ${target.row}) of the course posed`,
  );
  assertNull(
    after.nextPellet,
    "nextPellet once the discarded pose is consumed",
  );
});
