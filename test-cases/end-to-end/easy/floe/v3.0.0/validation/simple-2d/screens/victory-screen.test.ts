// Floe — screens/victory-screen: the victory screen reports the run it ended.
//
// `specs/ui.md` fixes its contents in the screens table: `victory` shows "The
// final score, the levels cleared (`8`), the lives remaining, and a menu of
// `ENDING_ITEMS` (`PLAY AGAIN`, `MENU`) in that order." Three figures and two
// entries, and a screen that says only "YOU WIN" has told the player nothing about
// the run they just finished.
//
// THE THREE FIGURES ARE POSED APART FROM EACH OTHER AND FROM THE COPY. The score
// is `437`, the lives `2`, and the levels cleared are `TOTAL_LEVELS` (`8`) — no
// two of them share a digit run, so each is found on its own and a build that drew
// one figure where another belonged reads as a miss rather than as a pass. The
// score is deliberately three digits: `specs/ui.md` fixes no formatting, and a
// build is free to group a thousand with a separator, so a figure that cannot be
// grouped is the one a substring match can fairly ask for.
//
// THE LEVEL IS POSED AT `TOTAL_LEVELS`, WHICH IS WHERE A VICTORY HAPPENS.
// `specs/progression.md` wins the run on the hop that clears level `8`, so a build
// is entitled to draw the levels cleared from its own `level` rather than from the
// constant, and a check that posed the victory screen at level `1` would fail a
// perfectly compliant build over its own arrangement.
//
// THE FIGURES ARE READ AS WHOLE TOKENS, THE ENTRIES AS SUBSTRINGS. `standsAlone`
// keeps the `8` of "LEVELS CLEARED 8" from being answered by an `8` inside a
// score, and the `2` of the lives from being answered by a digit of anything else;
// a menu entry is matched loosely because a build is free to set a marker against
// it ("> PLAY AGAIN <").
//
// THE HUD IS NOT PART OF THIS SCREEN'S COPY, and here that matters most: the HUD
// bar carries a score readout, a lives readout and a level label (`specs/ui.md`),
// which are the very figures this screen must report. A check that read the whole
// frame would pass a victory screen that reported nothing at all, off a HUD drawn
// behind it. `screenCopy` reads only what the build drew over the strait, where
// `specs/ui.md` puts the screens.
//
// THE SCREEN IS POSED. That a run reaches it is `progression.victory-on-level-8`;
// what its two entries do is `screens.victory-play-again` and
// `screens.victory-menu`. This point reads what it says.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import { ENDING_ITEMS, TOTAL_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  type Harness,
} from "../harness";
import { poseEnding, screenCopy, screenRuns, standsAlone } from "./screens";

/**
 * The run the screen must report.
 *
 * Three digits of score so no build's thousands separator can break the match, and
 * a lives figure sharing no digit with it, so the three readings below cannot
 * answer for one another. The levels cleared are the specification's own
 * `TOTAL_LEVELS`.
 */
const SCORE = 437;
const LIVES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the final score, the levels cleared, the lives left and both entries", async () => {
  poseEnding(h, "victory", TOTAL_LEVELS);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);

  const posed = h.snapshot();
  assertEqual(posed.screen, "victory", "the pose opened the victory screen");
  assertEqual(posed.score, SCORE, "with the score this check reads back");
  assertEqual(posed.lives, LIVES, "and the lives it reads back");

  const calls = await drawFrame(h);
  captureStill(h, "victory");

  const copy = screenCopy(h, calls);
  assertGreaterThan(
    screenRuns(h, calls).length,
    0,
    "the victory screen to draw text over the strait at all (specs/ui.md)",
  );
  assertMatches(
    copy,
    standsAlone(String(SCORE)),
    "the victory screen reports the final score (specs/ui.md)",
  );
  assertMatches(
    copy,
    standsAlone(String(TOTAL_LEVELS)),
    "and the levels cleared, TOTAL_LEVELS (specs/ui.md)",
  );
  assertMatches(
    copy,
    standsAlone(String(LIVES)),
    "and the lives remaining (specs/ui.md)",
  );
  for (const item of ENDING_ITEMS) {
    assertMatches(
      copy,
      item.toUpperCase(),
      `and draws ${JSON.stringify(item)} (specs/ui.md)`,
    );
  }
});
