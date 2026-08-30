// scoring/round-starts-at-zero — every fresh round opens at a score of zero.
//
// specs/scoring.md: "A round starts at a score of `0`." specs/ui.md gives a round
// two openings, and both are read here: `PLAY AGAIN` on the game-over screen, and
// the mode's entry on the title menu. Neither is reached by assigning the screen:
// specs/instrumentation.md makes `setScreen("playing")` run the tick over the
// board AS IT STANDS rather than laying out a fresh round, so the only thing that
// opens one is `confirm` on a menu item, and that is what is pressed.
//
// A score is on the board before each opening, because the failure this decides
// is a round that CARRIES the previous one's score. Reading 0 out of a round that
// was never given anything to forget would decide nothing.
//
// The round is ended by a real collision rather than by posing the game-over
// screen, so the score the fresh round is measured against is one the build's own
// rules left behind.

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

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh round at zero from game over and from the title", async () => {
  // A round with a score on it, ended by running the head into the wall.
  await arrangeApproach(h, WALL_CELL, { dir: "left", score: CARRIED });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the collision ended on");
  assertEqual(ended.score, CARRIED, "the score the round ended on");

  // PLAY AGAIN is the first item of OVER_ITEMS, and a screen is arrived at on
  // its first item (specs/ui.md).
  await h.tap(KEY.confirm);
  const again = await h.snapshot();
  assertEqual(again.screen, "playing", "the screen PLAY AGAIN opened");
  assertEqual(again.score, 0, "the score a round from PLAY AGAIN opens at");

  // And the same from the title, in the same session, with a score posed back
  // onto the board so there is again something to carry.
  await h.debug.setScore(CARRIED);
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);
  await h.tap(KEY.confirm);
  await captureStill(h, "fresh");

  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "playing", "the screen the mode entry opened");
  assertEqual(fresh.score, 0, "the score a round from the title opens at");
});
