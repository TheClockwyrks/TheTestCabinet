// collision/wall-bottom-fatal — the head advancing into the bottom wall ends the round.
//
// specs/board.md makes the border one cell thick on all four sides and every one
// of its cells "Solid, and fatal to the head on contact"; specs/movement.md's step
// 3 tests the new head cell alone and says the round ends "at once, with no grace
// tick and no second chance". specs/ui.md names the screen a fatal collision
// reaches: `gameover`.
//
// EACH WALL IS ITS OWN POINT because a build that seals three sides and leaks on
// the fourth has to grade differently from one that seals none, and because the
// four are four separate comparisons in a build's own code. The head is posed one
// cell short of the wall, facing it, with the pellet off the board and the
// obstacle course cleared, so the tick that resolves is the collision and nothing
// else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  arrangeApproach,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/**
 * The wall cell the head is aimed at: row `GRID_ROWS - 1`, the far side
 * of the border.
 */
const WALL: Cell = { col: 10, row: 17 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the round on the tick the head enters the bottom wall", async () => {
  const posed = arrangeApproach(h, WALL, { dir: "down", length: 3 });
  assertDeepEqual(posed.next, WALL, "the cell the next tick enters");
  assertEqual(posed.snapshot.screen, "playing", "the round before the tick");

  const after = await captureReplay(h, "bottom", () => h.tick());

  assertEqual(after.ticks, 1, "ticks resolved");
  assertEqual(after.screen, "gameover", "the screen the fatal tick reached");
});
