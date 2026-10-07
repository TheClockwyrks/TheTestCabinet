// instrumentation/next-pellet-survives-respawn-off — an eat that makes no spawn
// leaves the pose standing.
//
// specs/instrumentation.md, of the `pelletRespawn` switch while it is off: "Step
// 5 places none ... and a cell setNextPellet posed stays posed", and of the pose
// itself: only "the next spawn the game makes" consumes it. So a point may hold
// respawn off while it arranges a board, pose the spawn it wants, and turn
// respawn back on for the eat that is about; a build that dropped the pose on an
// eat that placed nothing would hand that point a random pellet instead.
//
// The eat leaving the board without a pellet is `pellet-respawn-switch`; here
// the pose standing after it is the reading.

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

/** Ticks run after the eat, so what it left behind is on the recording. */
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

it("keeps the posed cell through an eat that spawns nothing", async () => {
  const scene = arrangeEat(h, {
    pelletRespawn: false,
    runUp: RUN_UP + 1,
    nextPellet: POSED,
  });
  assertEqual(
    scene.snapshot.pelletRespawn,
    false,
    "the switch the scene posed",
  );
  assertDeepEqual(
    scene.snapshot.nextPellet,
    POSED,
    "the pose standing before the eat",
  );

  const after = await captureReplay(h, "kept", async () => {
    await h.tick(RUN_UP);
    const eaten = await h.tick();
    await h.tick(SETTLE);
    return eaten;
  });

  assertDeepEqual(after.snake[0], scene.pellet, "the head on the eaten cell");
  assertEqual(after.pellet, null, "pellet with respawn off");
  assertDeepEqual(
    after.nextPellet,
    POSED,
    "the pose standing after an eat that made no spawn",
  );
});
