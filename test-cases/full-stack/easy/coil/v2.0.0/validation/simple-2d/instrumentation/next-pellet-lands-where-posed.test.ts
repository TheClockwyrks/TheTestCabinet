// instrumentation/next-pellet-lands-where-posed — `setNextPellet` poses the cell
// the next spawn places the pellet on.
//
// WHAT specs/instrumentation.md REQUIRES. The next spawn the game makes, "which
// is step 5 of the tick that eats with respawn on", "places the pellet on that
// cell in place of the random draw when the cell is in the valid set
// specs/board.md defines at that moment", and the snapshot "reports the pose as
// nextPellet". Both halves are read here, against a cell that is in the valid
// set whatever the eat does to the chain: the pose is read back off the snapshot,
// the meal is eaten for real, and the pellet step 5 placed is read back.
//
// WHY IT IS ITS OWN POINT. Every point that decides a draw rather than sampling
// one — the first pellet of a round, the course kept out of the valid set — poses
// its outcome through this operation, so an operation that is present but inert
// has to fail here by name rather than in each of those. That the spawn CONSUMES
// the pose is `next-pellet-consumed-by-the-spawn`, what a posed cell outside the
// valid set does is `next-pellet-outside-the-valid-set-is-discarded`, and what
// respawn being off does to it is `next-pellet-survives-respawn-off`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { Cell } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Ticks of clear travel before the head reaches the pellet. */
const RUN_UP = 3;

/** Ticks run after the eat, with the chain held, so the board is seen settled. */
const SETTLE = 3;

/** The cell posed for the spawn: far from the chain and the meal, on a cleared board. */
const POSED: Cell = { col: 24, row: 13 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places the next pellet on the posed cell", async () => {
  const scene = arrangeEat(h, {
    pelletRespawn: true,
    runUp: RUN_UP + 1,
  });
  h.debug.setNextPellet(POSED.col, POSED.row);
  const posed = h.snapshot();
  assertDeepEqual(posed.nextPellet, POSED, "the pose read back as nextPellet");
  assertDeepEqual(
    posed.pellet,
    scene.pellet,
    "the pellet to be eaten, untouched by the pose",
  );

  const after = await captureReplay(h, "posed", async () => {
    await h.tick(RUN_UP);
    const eaten = await h.tick();
    h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return eaten;
  });

  assertDeepEqual(after.snake[0], scene.pellet, "the head on the eaten cell");
  assertEqual(after.screen, "playing", "the round after the eat");
  assertDeepEqual(
    after.pellet,
    POSED,
    "the pellet the eat placed, on the posed cell",
  );
});
