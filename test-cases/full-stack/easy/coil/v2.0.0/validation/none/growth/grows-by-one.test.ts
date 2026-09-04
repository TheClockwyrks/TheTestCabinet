// growth/grows-by-one — the tick that eats a pellet lengthens the chain by
// exactly one cell.
//
// specs/movement.md fixes it twice: step 4, "If the new head cell holds the
// pellet, prepend the new head and keep the tail", and the rule it amounts to,
// "Eating a pellet lengthens the snake by exactly one cell, because step 4 keeps
// the tail on that tick."
//
// So two readings of the same tick. The length is one more than it was, which is
// the rule as a player meets it, and the TAIL CELL is exactly the cell it was,
// which is the mechanism: a build that grew by appending some new cell at the far
// end, or that grew by two, or that grew while also retracting, all read
// differently on one of the two.
//
// The pellet is placed one cell ahead of the head and its respawn is off, so what
// resolves on the driven tick is one eat and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The chain posed under the eat: long enough that a kept tail is visibly kept. */
const LENGTH = 5;

/** Ticks of clear travel before the head reaches the pellet. */
const RUN_UP = 3;

/** Ticks run after the eat, so what it left behind is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the tail and adds the head on the tick that eats", async () => {
  const scene = await arrangeEat(h, { length: LENGTH, runUp: RUN_UP + 1 });
  assertLength(scene.snapshot.snake, LENGTH, "the posed chain");

  const run = await captureReplay(h, "grow", async () => {
    const before = await h.tick(RUN_UP);
    const eaten = await h.tick();
    await h.tick(SETTLE);
    return { before, eaten };
  });
  const { before, eaten: after } = run;

  assertDeepEqual(after.snake[0], scene.pellet, "the head on the eaten cell");
  assertLength(after.snake, LENGTH + 1, "the chain after the eat");
  assertDeepEqual(
    after.snake[after.snake.length - 1],
    before.snake[before.snake.length - 1],
    "the tail cell the eat kept",
  );
  assertEqual(after.ticks, RUN_UP + 1, "ticks resolved");
});
