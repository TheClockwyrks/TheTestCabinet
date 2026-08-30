// screens/gameover-copy — the game-over screen draws its heading, its figures and
// its menu.
//
// specs/ui.md gives `gameover` four elements: the heading `GAMEOVER_TEXT` (`GAME
// OVER`), `SCORE_LABEL` (`SCORE`) above the score the round ended on,
// `BEST_LABEL` (`BEST`) above the session's best, and `OVER_ITEMS` (`PLAY AGAIN`,
// `MENU`). All four are read, and the two figures are read as numbers rather than
// as labels alone, because a screen that shows `SCORE` over a blank tells the
// player nothing.
//
// The two figures are deliberately different, and the best is deliberately the
// larger, so neither can stand in for the other and specs/scoring.md leaves the
// best where it is (a best below the live score would be raised back to it).
//
// The round is ended by running the head into the wall, so the screen read is one
// the build's own step 3 opened.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BEST_LABEL,
  GAMEOVER_TEXT,
  OVER_ITEMS,
  SCORE_LABEL,
} from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { drewNumber } from "./copy";

/** The score the round ends on, and the higher best the session is carrying. */
const SCORE = 250;
const BEST = 810;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws GAME OVER, the score, the best and both menu items", async () => {
  await arrangeApproach(h, WALL_CELL, {
    dir: "left",
    score: SCORE,
    best: BEST,
  });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "gameover");

  assertEqual(
    drewText(calls, GAMEOVER_TEXT),
    true,
    `the screen drawing ${GAMEOVER_TEXT}`,
  );
  assertEqual(
    drewText(calls, SCORE_LABEL),
    true,
    `the screen drawing ${SCORE_LABEL}`,
  );
  assertEqual(drewNumber(calls, SCORE), true, "the score the round ended on");
  assertEqual(
    drewText(calls, BEST_LABEL),
    true,
    `the screen drawing ${BEST_LABEL}`,
  );
  assertEqual(drewNumber(calls, BEST), true, "the session's best score");
  for (const item of OVER_ITEMS) {
    assertEqual(drewText(calls, item), true, `the menu drawing ${item}`);
  }
});
