// scoring/round-starts-at-zero-from-gameover — PLAY AGAIN opens the next round at
// zero.
//
// specs/scoring.md: "A round starts at a score of `0`." specs/ui.md gives a round
// two openings, and this is one of them: `confirm` on `PLAY AGAIN`, which "starts
// a fresh round in the same mode". The other opening is
// `scoring/round-starts-at-zero-from-title`, and they are two points because a
// build commonly carries the score across one route and not the other.
//
// THE ROUND IS OPENED WITH A KEY, not by assigning the screen:
// specs/instrumentation.md makes `setScreen("playing")` run the tick over the
// board AS IT STANDS rather than laying out a fresh round, so the only thing that
// opens one is `confirm` on a menu item.
//
// A score is on the board before the opening, because the failure this decides is
// a round that CARRIES the previous one's score. Reading `0` out of a round that
// was never given anything to forget would decide nothing. The round is ended by
// a real collision rather than by posing the game-over screen, so the score the
// fresh round is measured against is one the build's own rules left behind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The score the ending round is carrying. */
const CARRIED = 320;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the round PLAY AGAIN starts at a score of zero", async () => {
  arrangeApproach(h, WALL_CELL, { dir: "left", score: CARRIED });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the collision ended on");
  assertEqual(ended.score, CARRIED, "the score the round ended on");

  // PLAY AGAIN is the first item of OVER_ITEMS, and specs/ui.md arrives at
  // `gameover` with `menuIndex` at 0.
  assertEqual(ended.menuIndex, 0, "the highlighted item on the end screen");
  await h.tap(KEY.confirm);
  captureStill(h, "fresh");

  const again = h.snapshot();
  assertEqual(again.screen, "playing", "the screen PLAY AGAIN opened");
  assertEqual(again.score, 0, "the score a round from PLAY AGAIN opens at");
});
