// Wireworm — screens/ending-play-again: confirming PLAY AGAIN opens a new run.
//
// specs/ui.md's ending menu: `PLAY AGAIN`, the first entry of `ENDING_ITEMS`,
// "Opens a new run, at level `1` with `START_LIVES` lives and a score of `0`,
// and moves to `playing`."
//
// It is confirmed from `gameover` because that is the screen a run reaches
// without being won; the menu is the same on both end screens, and
// `screens/ending-menu` confirms the other entry from the same one. The run it
// is confirmed from is posed well away from every value the new run fixes, so no
// field can pass by having been right already.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, START_LIVES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { CONFIRM_KEY, poseEnding } from "./screens";

/** Which entry of `ENDING_ITEMS` is `PLAY AGAIN`. */
const PLAY_AGAIN_ITEM = ENDING_ITEMS.indexOf("PLAY AGAIN");

/** The lost run the new one replaces: level 9, no lives, 4,720 on the board. */
const POSED_SCORE = 4720;
const POSED_LEVEL = 9;
const POSED_LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a run at level 1 with three lives and no score on PLAY AGAIN", async () => {
  await poseEnding(h, "gameover", {
    score: POSED_SCORE,
    lives: POSED_LIVES,
    level: POSED_LEVEL,
    reachedLevel: POSED_LEVEL,
    menuIndex: PLAY_AGAIN_ITEM,
  });

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  assertEqual(restarted.screen, "playing", "the screen PLAY AGAIN opened");
  assertEqual(restarted.level, 1, "the level of the run PLAY AGAIN began");
  assertEqual(restarted.lives, START_LIVES, "the lives PLAY AGAIN began with");
  assertEqual(restarted.score, 0, "the score PLAY AGAIN began with");
});
