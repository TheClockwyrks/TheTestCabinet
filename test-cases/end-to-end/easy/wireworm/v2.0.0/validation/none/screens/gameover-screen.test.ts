// Wireworm — screens/gameover-screen: the Game-over screen reports the run it
// ended and offers both ending items.
//
// specs/ui.md's end-screen table: `gameover` shows "The final score and the
// level the run reached", over the `ENDING_ITEMS` menu both end screens carry.
// specs/progression.md is what makes the level reached its own figure: "The
// level reached is the highest level the run has opened, and it is what the end
// screens report."
//
// SO THE TWO LEVELS ARE POSED APART. `setLevel` and `setReachedLevel` are
// separate operations, and this poses the current level at `POSED_LEVEL` and the
// level reached at `POSED_REACHED`. A build that reports the level reached draws
// `POSED_REACHED`; a build that reports the current level instead — including
// one that lets the HUD bar's own level readout answer for the screen — does
// not, so the two wrong models read as different numbers.
//
// The score is matched by substring, since a build is free to pad or group its
// digits; the level reached is matched as a standalone word, since a digit
// inside a larger number is not the figure. specs/ui.md does not forbid the HUD
// bar from standing behind an end screen and the HUD carries the score, so the
// score reading says the figure is on the screen rather than that this panel is
// what put it there; the still is captured for the reviewer, who is who the
// composition is rated by.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewWord,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/index";
import { poseEnding } from "./screens";

/**
 * The run the screen is posed to report.
 *
 * `870` contains no standalone digit, so it cannot answer for the level
 * reached; `7` is the level reached and `3` the level the run stood on, two
 * different figures so that a screen reading the wrong one is named for it. A
 * lost run has `0` lives.
 */
const POSED_SCORE = 870;
const POSED_LEVEL = 3;
const POSED_REACHED = 7;
const POSED_LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the score, the level reached, and both ending items", async () => {
  await poseEnding(h, "gameover", {
    score: POSED_SCORE,
    lives: POSED_LIVES,
    level: POSED_LEVEL,
    reachedLevel: POSED_REACHED,
  });

  const calls = await h.frameCalls();
  await captureStill(h, "gameover");

  assertEqual((await h.snapshot()).screen, "gameover", "the posed screen");
  assertEqual(
    drewText(calls, String(POSED_SCORE)),
    true,
    `draws the final score ${POSED_SCORE}`,
  );
  assertEqual(
    drewWord(calls, String(POSED_REACHED)),
    true,
    `draws ${POSED_REACHED}, the level the run reached`,
  );
  for (const item of ENDING_ITEMS) {
    assertEqual(drewText(calls, item), true, `draws the menu item "${item}"`);
  }
});
