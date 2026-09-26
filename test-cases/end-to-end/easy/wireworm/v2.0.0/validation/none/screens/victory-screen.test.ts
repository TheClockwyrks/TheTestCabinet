// Wireworm — screens/victory-screen: the Victory screen reports the run it ended
// and offers both ending items.
//
// specs/ui.md's end-screen table: `victory` shows "The final score, that all
// `TOTAL_LEVELS` (`12`) levels were cleared, and the lives remaining", over the
// `ENDING_ITEMS` menu both end screens carry.
//
// THE SCORE AND THE TOTAL ARE READ AS TEXT. Both are figures the specification
// fixes, so both are matched among the runs the frame drew — the score by
// substring, since a build is free to pad or group its digits, and the total as
// a standalone word, since `12` inside a larger number is not the figure.
//
// THE LIVES ARE READ AS A DIFFERENCE. specs/ui.md lets a lives readout be "a row
// of icons or as a count", so a token match would fail a build that draws icons,
// which is exactly as conformant as one that draws digits. What is decided
// instead is that the screen's drawing DEPENDS on the lives remaining: the same
// screen is drawn at one life and at five, and the two must not come out
// identical. Both forms satisfy that; a screen that reports the lives in no form
// at all does not.
//
// WHAT THIS DOES NOT DECIDE. specs/ui.md does not forbid the HUD bar from
// standing behind an end screen, and the HUD carries the score, `TOTAL_LEVELS`
// and the lives itself — so on a build that keeps it, these readings say the
// figures are on the screen rather than that this panel is what put them there.
// Constraining them to a region would be inventing a layout the case
// deliberately leaves to the build. The still is captured for the reviewer, who
// is who the composition is rated by.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { ENDING_ITEMS, TOTAL_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  drewWord,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/index";
import { poseEnding, renderDigest } from "./screens";

/**
 * The run the screen is posed to report.
 *
 * `870` carries no `1`, no `2` and no standalone digit of its own, so the score
 * cannot be mistaken for the total and the total cannot be mistaken for the
 * score. A won run has cleared all twelve levels, so the level and the level
 * reached are both `TOTAL_LEVELS`.
 */
const POSED_SCORE = 870;
const POSED_LIVES = 2;

/**
 * The two lives counts the screen is redrawn at, to see whether it reports them.
 *
 * `1` and `5` rather than neighbours: a build drawing icons redraws a different
 * number of them, a build drawing a count redraws a different digit, and neither
 * `1` nor `5` appears in `POSED_SCORE` or in `TOTAL_LEVELS`.
 */
const FEW_LIVES = 1;
const MANY_LIVES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the score, all twelve levels, the lives, and both ending items", async () => {
  await poseEnding(h, "victory", {
    score: POSED_SCORE,
    lives: POSED_LIVES,
    level: TOTAL_LEVELS,
    reachedLevel: TOTAL_LEVELS,
  });

  const calls = await h.frameCalls();
  await captureStill(h, "victory");

  assertEqual((await h.snapshot()).screen, "victory", "the posed screen");
  assertEqual(
    drewText(calls, String(POSED_SCORE)),
    true,
    `draws the final score ${POSED_SCORE}`,
  );
  assertEqual(
    drewWord(calls, String(TOTAL_LEVELS)),
    true,
    `draws ${TOTAL_LEVELS}, the levels a won run cleared`,
  );
  for (const item of ENDING_ITEMS) {
    assertEqual(drewText(calls, item), true, `draws the menu item "${item}"`);
  }

  // The same screen at two different lives counts: whichever form the build
  // reports them in, the two frames cannot be the same picture.
  await h.debug.setLives(FEW_LIVES);
  const few = renderDigest(await h.frameCalls());
  await h.debug.setLives(MANY_LIVES);
  const many = renderDigest(await h.frameCalls());
  assertNotEqual(
    many,
    few,
    `the frame at ${MANY_LIVES} lives differs from the one at ${FEW_LIVES}`,
  );
});
