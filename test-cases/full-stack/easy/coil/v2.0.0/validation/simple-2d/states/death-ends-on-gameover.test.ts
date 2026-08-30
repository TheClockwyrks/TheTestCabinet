// states/death-ends-on-gameover — the tick that runs the head into a wall ends
// the round on the game-over screen.
//
// specs/movement.md: step 3 tests the new head cell, "If it is fatal, the round
// ends", and a round ends "Dead" when "The head entered a fatal cell at step 3".
// specs/ui.md gives that ending the `gameover` screen, showing "the score the
// round ended on".
//
// The collision is real. The chain is posed one cell short of the wall, facing
// it, with nothing else on the board, and one tick is run: what ends the round is
// the build's own step 3 rather than a posed screen. The score is posed before
// the tick and read after it, because "the score the round ended on" is a figure
// the ending must carry rather than clear.
//
// That the wall is fatal at all is the `collision` category's; this decides where
// the game goes when it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The score the round is carrying into its last tick. */
const CARRIED = 410;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen to gameover on the tick the head enters a wall", async () => {
  const posed = arrangeApproach(h, WALL_CELL, {
    dir: "left",
    score: CARRIED,
    best: CARRIED,
  });
  assertEqual(posed.snapshot.screen, "playing", "the screen the round runs on");

  await h.tick();
  captureStill(h, "gameover");

  const ended = h.snapshot();
  assertEqual(ended.screen, "gameover", "the screen the death ended on");
  assertEqual(ended.score, CARRIED, "the score the round ended on");
});
