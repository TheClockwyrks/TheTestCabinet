// collision/tail-follow-safe — chasing the vacating tail is safe.
//
// specs/movement.md's tail rule, first row: on a tick that "Eats nothing, so the
// tail moves", the current tail cell is "Free. The head may enter it, and a snake
// may safely chase its own tail."
//
// WHY IT IS ITS OWN POINT, AND THE HARDER HALF. The rule has two directions and
// they are two different mistakes. A build that treats every body cell as solid
// kills a player for a manoeuvre the game is supposed to allow, which is the one a
// good player uses to survive a long chain in a tight space; that is this point.
// A build that treats the tail as free on every tick is `growth-tail-fatal`.
//
// The chain is posed as a closed ring so the head's next cell IS the tail, with
// the pellet off the board so the tick eats nothing and the tail really does
// vacate. What is read is that the round carries on, that the head took the cell,
// and that the chain kept its length — a build that "survived" by growing has not
// applied step 4 either.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  ahead,
  captureReplay,
  createHarness,
  poseScene,
  type Cell,
  type Harness,
} from "../harness";

/**
 * A closed ring of four cells, head first.
 *
 * The head at `(10, 8)` faces right onto `(11, 8)`, which is the chain's last
 * cell and so its tail. Each cell is orthogonally adjacent to the one before it
 * and none repeats.
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

it("carries the round on when the head takes the cell the tail leaves", async () => {
  const tail = CHAIN[CHAIN.length - 1];
  const posed = poseScene(h, { snake: CHAIN, dir: "right", pellet: null });
  assertDeepEqual(
    ahead(CHAIN[0], "right"),
    tail,
    "the tail cell the head enters",
  );
  assertEqual(posed.pellet, null, "the board the tick runs over");

  const after = await captureReplay(h, "tail", async () => {
    const resolved = await h.tick();
    await h.tick(SETTLE);
    return resolved;
  });

  assertEqual(
    after.screen,
    "playing",
    "the round after the head took the tail cell",
  );
  assertDeepEqual(after.snake[0], tail, "the head on the cell the tail left");
  assertLength(
    after.snake,
    CHAIN.length,
    "the chain after a tick that ate nothing",
  );
});
