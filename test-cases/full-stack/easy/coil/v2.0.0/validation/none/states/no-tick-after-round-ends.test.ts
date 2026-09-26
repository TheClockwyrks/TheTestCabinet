// states/no-tick-after-round-ends — an ended round advances nothing.
//
// specs/movement.md: "Ticks run only on the `playing` screen. A round that has
// ended, a paused game, and every menu screen leave the simulation where it
// stands." So the chain the death left is the chain the game-over screen keeps,
// however long it is left there.
//
// The round is ended for real — the chain posed one cell short of the wall and
// one tick run — because what this decides is the state AFTER an ending the build
// itself reached, and a posed `gameover` screen would leave the accumulator
// wherever the pose found it. Four seconds is 32 ticks, so a build whose loop
// kept ticking would have marched the dead snake a third of the way across the
// board.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  WALL_CELL,
  arrangeApproach,
  captureReplay,
  createHarness,
  secondFrames,
  type Harness,
} from "../harness";

/** Seconds of game time the ended round is left for: 32 ticks' worth. */
const HELD_SECONDS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resolves no tick once the round has ended", async () => {
  await arrangeApproach(h, WALL_CELL, { dir: "left" });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the death ended on");

  const after = await captureReplay(h, "still", async () => {
    await h.advance(secondFrames(HELD_SECONDS));
    return h.snapshot();
  });

  assertEqual(after.ticks, ended.ticks, "the ticks resolved after the ending");
  assertDeepEqual(after.snake, ended.snake, "the chain the ending left");
});
