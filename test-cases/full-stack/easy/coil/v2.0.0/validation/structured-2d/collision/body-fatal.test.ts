// collision/body-fatal — the head entering a solid body cell ends the round.
//
// specs/movement.md lists "A cell holding a body segment, subject to the tail
// rule" among the fatal cells, and closes the tail rule with "Every other body
// cell is solid on every tick". Step 3 tests the new head cell alone, before the
// tail is resolved, and the round ends at once.
//
// THE SEGMENT ENTERED IS A MIDDLE ONE, deliberately: neither the head, which the
// snake cannot enter, nor the tail, whose two cases are the two points beside this
// one. The posed chain doubles back on itself so the cell directly ahead of the
// head is its own fourth segment, with two more cells of body behind it — so the
// cell under test is solid on any reading of the tail rule.
//
// The pellet is off the board, so this tick eats nothing and the tail is
// vacating; that is what makes the entered cell's solidity the only thing the
// verdict rests on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ahead,
  captureReplay,
  createHarness,
  poseScene,
  type Cell,
  type Harness,
} from "../harness";

/**
 * A chain doubled back on itself, head first.
 *
 * The head at `(10, 8)` faces down onto `(10, 9)`, which is the chain's fourth
 * cell; `(9, 9)` and `(9, 8)` carry on behind it, so the entered cell is neither
 * the head nor the tail. Each cell is orthogonally adjacent to the one before it
 * and none repeats.
 */
const CHAIN: Cell[] = [
  { col: 10, row: 8 },
  { col: 11, row: 8 },
  { col: 11, row: 9 },
  { col: 10, row: 9 },
  { col: 9, row: 9 },
  { col: 9, row: 8 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the round on the tick the head enters its own body", async () => {
  const posed = poseScene(h, { snake: CHAIN, dir: "down", pellet: null });
  const entering = ahead(CHAIN[0], "down");
  assertDeepEqual(entering, CHAIN[3], "the segment the next tick enters");
  assertDeepEqual(posed.snake, CHAIN, "the posed chain");

  const after = await captureReplay(h, "self", () => h.tick());

  assertEqual(after.ticks, 1, "ticks resolved");
  assertEqual(after.screen, "gameover", "the screen the fatal tick reached");
});
