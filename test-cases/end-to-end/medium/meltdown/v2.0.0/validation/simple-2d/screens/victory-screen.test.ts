// screens/victory-screen — the victory screen reports the run, and offers its two
// rows.
//
// THE RULE. specs/screens.md's `victory and gameover` section: `victory` reports
// "The final score, the waves survived, and the lives remaining", and both end
// screens "draw the two rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`".
//
// THE THREE FIGURES ARE POSED APART FROM ONE ANOTHER. specs/waves.md wins a run by
// clearing Wave `N`, so the waves survived are the run's whole wave count — `26`
// on Containment at Hard, which specs/modes.md fixes. The score and the lives are
// posed at figures that are neither that number nor each other, so a screen that
// draws one of the three in place of another is missing two figures rather than
// passing on a coincidence.
//
// THE FIGURES ARE READ AS WHOLE NUMBERS, NOT AS SUBSTRINGS. Every run of text the
// frame drew is broken into its runs of digits, so `26` is found as `26` and not
// inside `126`. How a build labels or arranges them is its own: specs/overview.md
// fixes no layout and specs/screens.md fixes no wording, so nothing here reads
// where a figure was put or what was written beside it.
//
// THE SCREEN IS POSED, NOT WON. `setScreen` runs no entry effect
// (specs/instrumentation.md), which is exactly what an item about what a screen
// DRAWS wants: the figures under test are posed outright rather than being
// whatever a drive happened to reach. That the screen OPENS on victory at all is
// `waves.victory-on-the-final-clear`'s requirement, and that it opens with the
// highlight on PLAY AGAIN is `screens.play-again-focused`'s — that one is an entry
// effect and drives the real transition.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  waveCountOf,
  type Harness,
} from "../harness";
import { numbersDrawn, poseMenu } from "./menu";

/** The pair the won run was played on, and the waves it therefore survived. */
const MODE = "containment";
const DIFFICULTY = "hard";
const WAVES_SURVIVED = waveCountOf(MODE, DIFFICULTY);

/**
 * The score and the lives the run is posed with.
 *
 * Both are ordinary figures well away from each other and from the wave count, so
 * each of the three readings can only be satisfied by the screen drawing that
 * figure. The lives sit below the `20` a Containment run starts on and above the
 * `0` that would have ended the run in loss instead.
 */
const SCORE = 4132;
const LIVES = 17;

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the score, the waves survived and the lives remaining", async () => {
  poseMenu(h, "victory", OPENING_ROW);
  h.debug.setMode(MODE);
  h.debug.setDifficulty(DIFFICULTY);
  h.debug.setWave(WAVES_SURVIVED);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  const calls = await drawFrame(h);
  captureStill(h, "victory");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "victory",
    "posing: the screen the report is read from (specs/screens.md)",
  );
  assertEqual(
    after.waveCount,
    WAVES_SURVIVED,
    `posing: the waves a run on ${MODE} at ${DIFFICULTY} fights, all of ` +
      `which a won run survived (specs/modes.md, specs/waves.md)`,
  );

  const drawn = numbersDrawn(calls);
  assertContains(
    drawn,
    String(SCORE),
    "the final score, among the whole numbers the victory screen drew " +
      "(specs/screens.md)",
  );
  assertContains(
    drawn,
    String(WAVES_SURVIVED),
    "the waves survived, among the whole numbers the victory screen drew " +
      "(specs/screens.md)",
  );
  assertContains(
    drawn,
    String(LIVES),
    "the lives remaining, among the whole numbers the victory screen drew " +
      "(specs/screens.md)",
  );

  for (const item of ENDING_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the ${JSON.stringify(item)} row of ENDING_ITEMS drawn on the victory ` +
        `screen (specs/screens.md)`,
    );
  }
});
