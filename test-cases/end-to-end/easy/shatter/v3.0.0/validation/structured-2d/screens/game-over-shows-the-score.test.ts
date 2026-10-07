// screens/game-over-shows-the-score — the game-over screen shows the score the
// run finished on.
//
// `specs/ui.md`, on `gameover`: "It shows the final score and the wave the game
// reached." This point is the first half of that sentence.
//
// THE SCORE IS POSED, AND IT IS AN ARBITRARY FIGURE. `setScore(n)` sets the
// score and "grants no extra ship, whatever multiple of `EXTRA_LIFE_STEP` it
// carries the score across" (`specs/instrumentation.md`), so the screen is asked
// to show a number no build could be drawing for any other reason. A build that
// draws a constant — its own zero, most likely — fails naming the figure it drew
// instead of the one it was handed.
//
// THE WAVE IS POSED AT `1`, so its digits cannot spell the score's. The digits
// of `47320` appear in no run a screen showing `1` beside it can produce, so a
// match is a match on the score and not on its neighbour.
//
// THE READING IS THE NUMBER, NOT THE WRITING. Every non-digit is dropped from
// each run of text before the comparison (`reading.ts`), because `specs/ui.md`
// leaves "the palette, the type, and the layout of each screen" to the build and
// fixes nothing about how a figure is written: a build that labels its score
// (`SCORE 47320`), groups it (`47,320`), or does both has shown the number the
// specification asked for.
//
// THE SCREEN IS POSED DIRECTLY. `setScreen("gameover")` "spawns nothing and
// clears nothing" (`specs/instrumentation.md`), so the frame read is the
// game-over screen alone. Losing a ship to get there is
// `screens/game-over-on-the-last-life`'s point.
//
// WHAT THIS DOES NOT DECIDE. The wave beside it
// (`screens/game-over-shows-the-wave`), how the screen is reached
// (`screens/game-over-on-the-last-life`), its menu
// (`screens/play-again-starts-a-game`,
// `screens/game-over-menu-returns-to-the-title`), and that the text reads
// against what is behind it, which the reviewer judges.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  resetTo,
  type Harness,
} from "../harness";
import { drawnRuns, drewDigits } from "./reading";

/**
 * The score the run finished on.
 *
 * Five digits with no repeat and no run shared with the posed wave below, so the
 * match can only be the score.
 */
const FINAL_SCORE = 47320;

/** The wave the run reached: a single digit that cannot spell the score's. */
const FINAL_WAVE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the posed final score on the gameover screen", async () => {
  // The game-over screen, posed directly, carrying a run's final figures.
  resetTo(h);
  h.debug.setScreen("gameover");
  h.debug.setScore(FINAL_SCORE);
  h.debug.setWave(FINAL_WAVE);
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "gameover");

  assertEqual(
    drewDigits(h, String(FINAL_SCORE)),
    true,
    `the digits of the posed final score, ${String(FINAL_SCORE)}, in some run ` +
      "of text the gameover screen drew — it shows the final score " +
      `(specs/ui.md); the runs it drew were ${JSON.stringify(drawnRuns(h))}`,
  );
});
