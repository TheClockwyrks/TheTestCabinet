// Floe — screens/gameover-screen: the game-over screen reports the run it ended.
//
// `specs/ui.md` fixes its contents in the screens table: `gameover` shows "The
// final score, the level reached (`reachedLevel`), and a menu of `ENDING_ITEMS` in
// that order." Two figures and two entries, and a screen that says only "GAME
// OVER" has told the player nothing about the run they just lost.
//
// THE TWO FIGURES ARE POSED APART FROM EACH OTHER. The score is `472` and the
// level reached `6`, two different numbers, so each is found on its own and a
// build that drew one where the other belonged reads as a miss. The score is an
// arbitrary figure on purpose: it is the one of the two that a screen's own
// decoration has no reason to carry.
//
// `level` IS POSED EQUAL TO `reachedLevel`, WHICH IS THE SEPARATION THIS ITEM
// WANTS. Whether the screen reports the level REACHED rather than the level
// currently held is a defect of its own, and it has an item of its own —
// `progression.game-over-reports-level` poses the two apart and requires the
// reached one. Posing them together here means a build that read the wrong field
// loses that point and keeps this one, so one defect costs one item rather than
// two, and this point stays what its title says: that the screen reports the run
// at all.
//
// THE FIGURES ARE READ AS NUMBERS, THE ENTRIES AS SUBSTRINGS. `specs/ui.md`
// fixes what the screen reports and leaves how it is set to the build, so
// `screenNumbers` reads the figures the screen drew however they are set: the
// `6` of a level reached counts, the `6` inside a score of `1650` does not, and
// an arcade's zero-padded `000472` reports the score it reports. A menu entry
// is matched loosely instead, because a build is free to set a marker against
// it ("> MENU <").
//
// THE HUD IS NOT PART OF THIS SCREEN'S COPY, and here that matters most: the
// HUD bar carries a score readout and a level label (`specs/ui.md`), the very
// figures this screen must report, so a check that read the whole frame would
// pass a game-over screen that reported nothing at all off a HUD drawn behind
// it. Both readings here — `screenNumbers` for the figures, the shared
// harness's `drewTextAnywhere` over `screenText` for the two entries — take
// only what the build drew over the strait.
//
// THE SCREEN IS POSED. That a run reaches it is `progression.game-over-at-zero`;
// what its two entries do is `screens.gameover-play-again` and
// `screens.gameover-menu`. This point reads what it says.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import { drewTextAnywhere } from "../case-harness/text";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  type Harness,
} from "../harness";
import {
  poseEnding,
  screenNumbers,
  screenRuns,
  screenText,
  screenTokens,
} from "./screens";

/**
 * The run the screen must report.
 *
 * Two figures that are not the same number, so the two readings below cannot
 * answer for one another, and a score no other copy on a screen has a reason to
 * carry.
 */
const SCORE = 472;
const REACHED_LEVEL = 6;
const LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the final score, the level reached and both entries", async () => {
  poseEnding(h, "gameover", REACHED_LEVEL);
  h.debug.setReachedLevel(REACHED_LEVEL);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the pose opened the game-over screen");
  assertEqual(posed.score, SCORE, "with the score this check reads back");
  assertEqual(
    posed.reachedLevel,
    REACHED_LEVEL,
    "and the level reached it reads back",
  );
  assertEqual(
    posed.level,
    REACHED_LEVEL,
    "posed equal to the level held, so which field the build read is " +
      "progression.game-over-reports-level rather than this point",
  );

  const calls = await drawFrame(h);
  captureStill(h, "gameover");

  const runs = screenRuns(h, calls);
  assertGreaterThan(
    runs.length,
    0,
    "the game-over screen to draw text over the strait at all (specs/ui.md)",
  );
  const figures = screenNumbers(h, calls);
  const drew = ` — the strait drew ${JSON.stringify(screenTokens(h, calls))}`;
  assertContains(
    figures,
    SCORE,
    `the game-over screen reports the final score (specs/ui.md)${drew}`,
  );
  assertContains(
    figures,
    REACHED_LEVEL,
    `and the level reached (specs/ui.md)${drew}`,
  );
  const text = screenText(h, calls);
  for (const item of ENDING_ITEMS) {
    assertTrue(
      drewTextAnywhere(text, item),
      `and draws ${JSON.stringify(item)} (specs/ui.md) — the strait drew ` +
        JSON.stringify(runs),
    );
  }
});
