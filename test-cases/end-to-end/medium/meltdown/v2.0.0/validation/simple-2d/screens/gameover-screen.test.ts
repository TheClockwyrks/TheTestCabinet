// screens/gameover-screen — the game-over screen reports the run, and offers its
// two rows.
//
// THE RULE. specs/screens.md's `victory and gameover` section: `gameover` reports
// "The final score and the wave reached", and both end screens "draw the two rows
// of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`".
//
// THE WAVE REACHED IS NOT THE WAVE COUNT, and the pose is built so the two cannot
// be confused. A lost run ends part way through its progression, so the run is
// posed on Wave `13` of a `20`-wave Containment Medium run (specs/modes.md): a
// screen drawing the run's wave count instead of the wave the run reached draws
// `20` and fails, where a pose on the final wave would have let both readings pass
// on the same number.
//
// THE SCORE IS POSED APART FROM BOTH, so no reading is satisfied by another's
// figure.
//
// THE FIGURES ARE READ AS WHOLE NUMBERS, NOT AS SUBSTRINGS: the frame's text is
// broken into its runs of digits, so `13` is found as `13` and not inside `130`.
// How a build labels or arranges them is its own — specs/overview.md fixes no
// layout and specs/screens.md fixes no wording.
//
// THE SCREEN IS POSED, NOT LOST. `setScreen` runs no entry effect
// (specs/instrumentation.md), so the figures under test are posed outright. That
// the screen OPENS when the lives run out is `waves.game-over-on-no-lives`'s
// requirement, and that it opens with the highlight on PLAY AGAIN is
// `screens.play-again-focused`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertNotEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  waveCountOf,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { numbersDrawn, poseMenu } from "./menu";

/** The pair the lost run was played on. */
const MODE = "containment";
const DIFFICULTY = "medium";

/**
 * The wave the run reached, and the score it ended on.
 *
 * `13` is part way through the `20` waves specs/modes.md gives this pair, so the
 * wave reached and the wave count are different numbers and a screen reporting the
 * wrong one of them is caught. The score is a figure neither of them could be
 * mistaken for.
 */
const WAVE_REACHED = 13;
const SCORE = 2486;

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the score and the wave the run reached", async () => {
  assertNotEqual(
    WAVE_REACHED,
    waveCountOf(MODE, DIFFICULTY),
    `posing: the wave the run reached is not the wave count, so the two ` +
      `readings are different numbers (specs/modes.md)`,
  );
  poseMenu(h, "gameover", OPENING_ROW);
  h.debug.setMode(MODE);
  h.debug.setDifficulty(DIFFICULTY);
  h.debug.setWave(WAVE_REACHED);
  h.debug.setScore(SCORE);
  const calls = await drawFrame(h);
  captureStill(h, "gameover");

  assertEqual(
    h.snapshot().screen,
    "gameover",
    "posing: the screen the report is read from (specs/screens.md)",
  );

  const drawn = numbersDrawn(calls);
  assertContains(
    drawn,
    String(SCORE),
    "the final score, among the whole numbers the game-over screen drew " +
      "(specs/screens.md)",
  );
  assertContains(
    drawn,
    String(WAVE_REACHED),
    "the wave the run reached, among the whole numbers the game-over screen " +
      "drew (specs/screens.md)",
  );

  for (const item of ENDING_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the ${JSON.stringify(item)} row of ENDING_ITEMS drawn on the ` +
        `game-over screen (specs/screens.md)`,
    );
  }
});
