// screens/gameover-best-readout — the game-over screen draws the best score.
//
// specs/ui.md tables `gameover` with a Best score: `BEST_LABEL` (`BEST`),
// "above the session's best score".
//
// Both halves are read — the label and the figure — because a screen that shows
// `BEST_LABEL` over a blank tells the player nothing, and a bare number tells them
// nothing either. WHERE the two sit is not read: the table says the label sits
// above the figure, and a build that draws them as one run has satisfied the
// player's reading of it exactly as well, so the layout stays loose and reviewed.
//
// The two figures the round carries are deliberately different, and the best is
// deliberately the larger, so neither can stand in for the other and
// specs/scoring.md leaves the best where it is — a best below the live score
// would be raised back to it.
//
// The round is ended by running the head into the wall, so the screen read is one
// the build's own step 3 opened rather than one this point posed.
//
// Matching is by substring and ignores case, because how a build sets its copy is
// its own: a heading is commonly drawn with padding around it and a menu entry
// with a selection marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BEST_LABEL } from "../constants";
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

it("draws the best score", async () => {
  await arrangeApproach(h, WALL_CELL, {
    dir: "left",
    score: SCORE,
    best: BEST,
  });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the frame is read from");
  assertEqual(ended.best, BEST, "the figure the screen is reporting");

  const calls = await h.frameCalls();
  await captureStill(h, "gameover");

  assertEqual(
    drewText(calls, BEST_LABEL),
    true,
    `the screen drawing ${BEST_LABEL}`,
  );
  assertEqual(drewNumber(calls, BEST), true, "the session's best score");
});
