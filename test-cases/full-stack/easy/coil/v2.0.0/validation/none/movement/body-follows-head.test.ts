// movement/body-follows-head — after a tick that eats nothing, every segment
// holds the cell the segment ahead of it held.
//
// specs/board.md: "The body always traces the exact path the head has taken, with
// no gap and no branch." specs/movement.md's step 4 says how: on a tick that eats
// nothing the new head is prepended and the tail cell is dropped, which is the
// same statement read one segment at a time.
//
// THE CHAIN IS BENT ON PURPOSE. A straight chain is satisfied by a build that
// simply redraws a straight line of the right length behind its head, and that
// build has no body at all: it has a head and a ruler. A chain with two corners
// in it can only come out right if each segment really took the cell in front of
// it, so the corners travel down the body as the head moves on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { type Cell } from "../constants";
import {
  ahead,
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/**
 * A chain with two corners in it, head first.
 *
 * Head at `(12, 8)` travelling right, the body running back to `(11, 8)`, down
 * the column at `(11, 9)` and `(11, 10)`, then left along `(10, 10)` and
 * `(9, 10)`. Each cell is orthogonally adjacent to the one before it and none
 * repeats, which is what specs/instrumentation.md requires of a posed chain.
 */
const CHAIN: Cell[] = [
  { col: 12, row: 8 },
  { col: 11, row: 8 },
  { col: 11, row: 9 },
  { col: 11, row: 10 },
  { col: 10, row: 10 },
  { col: 9, row: 10 },
];

/** Ticks of clear travel before the tick this point reads. */
const RUN_UP = 3;

/** Ticks run after it, so what it left behind is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands every segment the cell the one ahead of it held", async () => {
  const posed = await poseScene(h, {
    snake: CHAIN,
    dir: "right",
    pellet: null,
  });
  assertDeepEqual(posed.snake, CHAIN, "the posed chain");

  const run = await captureReplay(h, "follow", async () => {
    const before = await h.tick(RUN_UP);
    const stepped = await h.tick();
    await h.tick(SETTLE);
    return { before, stepped };
  });
  const { before, stepped: after } = run;

  assertLength(
    after.snake,
    CHAIN.length,
    "the chain after a tick that ate nothing",
  );
  assertDeepEqual(
    after.snake[0],
    ahead(before.snake[0], "right"),
    "the head after the tick",
  );
  for (let i = 1; i < CHAIN.length; i += 1) {
    assertDeepEqual(
      after.snake[i],
      before.snake[i - 1],
      `segment ${i} takes the cell segment ${i - 1} held`,
    );
  }
});
