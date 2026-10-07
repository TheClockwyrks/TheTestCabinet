// instrumentation/next-pellet-consumed-by-the-spawn — the spawn that takes a
// posed cell leaves no pose behind.
//
// specs/instrumentation.md: "that spawn consumes the pose, and every spawn after
// it draws at random again until the next call", and the snapshot reports
// `nextPellet` as "null once it is consumed". What is read is the field after the
// eat: a pose that outlived the spawn that took it would land every later spawn
// on the same cell, which is a lottery no later point could tell from a build
// that draws honestly.
//
// That the pellet LANDS on the posed cell is `next-pellet-lands-where-posed`;
// here the pose standing before the eat and gone after it is the whole reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
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

afterEach(async () => {
  await h.dispose();
});

it("leaves nextPellet null once the spawn has taken the pose", async () => {
  const scene = await arrangeEat(h, {
    pelletRespawn: true,
    runUp: RUN_UP + 1,
    nextPellet: POSED,
  });
  assertDeepEqual(
    scene.snapshot.nextPellet,
    POSED,
    "the pose standing before the eat",
  );

  const after = await captureReplay(h, "consumed", async () => {
    await h.tick(RUN_UP);
    const eaten = await h.tick();
    await h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return eaten;
  });

  assertDeepEqual(after.snake[0], scene.pellet, "the head on the eaten cell");
  assertEqual(after.pellet === null, false, "a pellet placed by the eat");
  assertNull(after.nextPellet, "nextPellet once the spawn has run");
});
