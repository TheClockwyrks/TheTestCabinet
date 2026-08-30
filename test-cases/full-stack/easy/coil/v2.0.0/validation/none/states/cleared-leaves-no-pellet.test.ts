// states/cleared-leaves-no-pellet — the cleared board carries no pellet.
//
// specs/board.md: "The board-cleared round leaves the board without a live
// pellet", because step 5 found no valid cell for the next one, and
// specs/instrumentation.md says `pellet` "is `null` only when no pellet is on the
// board, which is the case on the `cleared` screen."
//
// The reading is the pellet alone. That the round ENDS on `cleared` is
// `states/cleared-reachable`; what this separates is a build that reaches the
// ending but leaves the eaten pellet on the board, or drops one onto a cell the
// chain occupies, from one that leaves the board genuinely empty.
//
// The ending is driven, not posed: a chain along every interior cell but one, the
// pellet on that cell, and one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  arrangeFullBoard,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the pellet at null on the board-cleared ending", async () => {
  await arrangeFullBoard(h);

  await h.tick();
  await captureStill(h, "empty");

  const ended = await h.snapshot();
  assertEqual(ended.screen, "cleared", "the screen the filled board ended on");
  assertNull(ended.pellet, "the pellet on the cleared board");
});
