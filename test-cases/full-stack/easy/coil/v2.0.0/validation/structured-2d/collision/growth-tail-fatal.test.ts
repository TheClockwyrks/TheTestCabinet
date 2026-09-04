// collision/growth-tail-fatal — entering the tail on a growth tick is fatal.
//
// specs/movement.md's tail rule, second row: on a tick that "Eats the pellet, so
// the tail stays", the current tail cell is "Solid. The head entering it ends the
// round."
//
// The other direction of the rule `tail-follow-safe` reads, and the edge case the
// game turns on: the same manoeuvre is safe or fatal depending on whether the tick
// eats, because step 4 decides whether the tail vacates. A build that answers the
// tail rule from the chain alone, without looking at the pellet, gets exactly one
// of the two points and that is what the split is for.
//
// HOW THE PELLET IS PUT UNDER THE TAIL. specs/instrumentation.md has `setPellet`
// take "an interior cell holding no snake segment", so the pellet is placed
// BEFORE the chain is laid over it — and the same file has `setSnake` set "the
// chain alone. The direction, the turn buffer, the pellet, and the score are left
// as they stand", so the pellet is still there when the chain arrives. That is
// why this point poses its world by hand rather than through the shared scene
// helper, whose order is the ordinary one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ahead,
  captureReplay,
  clearObstacles,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/**
 * A closed ring of four cells, head first, exactly as `tail-follow-safe` poses
 * it. The head at `(10, 8)` faces right onto the chain's tail at `(11, 8)`.
 */
const CHAIN: Cell[] = [
  { col: 10, row: 8 },
  { col: 10, row: 9 },
  { col: 11, row: 9 },
  { col: 11, row: 8 },
];

/** Ticks run after the tick this point reads, so its outcome is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the round when the head enters a tail the eat keeps", async () => {
  const { debug } = h;
  const tail = CHAIN[CHAIN.length - 1];
  assertDeepEqual(
    ahead(CHAIN[0], "right"),
    tail,
    "the tail cell the head enters",
  );

  debug.reset();
  clearObstacles(h);
  // The pellet first, while the cell is free; then the chain over it.
  debug.setPellet(tail.col, tail.row);
  debug.setSnake(CHAIN);
  debug.setDirection("right");
  debug.clearTurns();
  debug.setPelletRespawn(false);
  debug.setScreen("playing");

  const posed = h.snapshot();
  assertDeepEqual(posed.snake, CHAIN, "the posed chain");
  assertDeepEqual(posed.pellet, tail, "the pellet under the tail");

  const after = await captureReplay(h, "growthtail", async () => {
    const resolved = await h.tick();
    await h.tick(SETTLE);
    return resolved;
  });

  assertEqual(after.ticks, 1, "ticks resolved");
  assertEqual(after.screen, "gameover", "the screen the fatal tick reached");
});
