// screens/game-over-shows-the-wave — the game-over screen shows the wave the run
// reached.
//
// `specs/ui.md`, on `gameover`: "It shows the final score and the wave the game
// reached." This point is the second half of that sentence.
//
// THE WAVE IS POSED, AND IT IS NOT A NUMBER A BUILD DRAWS BY DEFAULT.
// `setWave(n)` "Sets the current wave number. It spawns no rocks and clears
// none" (`specs/instrumentation.md`), so the screen is asked to show `12` — not
// the `1` a new game opens on (`specs/progression.md`) and not the `0` `reset`
// restores. A build that draws a constant fails naming the figure it drew.
//
// THE SCORE IS POSED AT `0`, so its digits cannot spell the wave's. `12` appears
// in no run a screen showing `0` beside it can produce, so a match is a match on
// the wave and not on its neighbour.
//
// THE READING IS THE NUMBER, NOT THE WRITING. Every non-digit is dropped from
// each run of text before the comparison (`reading.ts`), because `specs/ui.md`
// fixes nothing about how a figure is written: `WAVE 12` and `WAVE  12` and a
// bare `12` are the same reading.
//
// THE SCREEN IS POSED DIRECTLY. `setScreen("gameover")` "spawns nothing and
// clears nothing" (`specs/instrumentation.md`), so the frame read is the
// game-over screen alone.
//
// WHAT THIS DOES NOT DECIDE. The score beside it
// (`screens/game-over-shows-the-score`), how the screen is reached
// (`screens/game-over-on-the-last-life`), its menu
// (`screens/play-again-starts-a-game`,
// `screens/game-over-menu-returns-to-the-title`), and the `WAVE N` banner drawn
// over live play (`presentation/wave-banner-is-drawn`).

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
 * The wave the run reached.
 *
 * Two digits, so it is neither the `1` a game opens on nor the `0` `reset`
 * leaves, and its digits appear in nothing else this screen is posed to show.
 */
const FINAL_WAVE = 12;

/** The score the run finished on: zero, whose digit cannot spell the wave's. */
const FINAL_SCORE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the posed wave number on the gameover screen", async () => {
  // The game-over screen, posed directly, carrying a run's final figures.
  resetTo(h);
  h.debug.setScreen("gameover");
  h.debug.setScore(FINAL_SCORE);
  h.debug.setWave(FINAL_WAVE);
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "gameover");

  assertEqual(
    drewDigits(h, String(FINAL_WAVE)),
    true,
    `the digits of the posed wave, ${String(FINAL_WAVE)}, in some run of text ` +
      "the gameover screen drew — it shows the wave the game reached " +
      `(specs/ui.md); the runs it drew were ${JSON.stringify(drawnRuns(h))}`,
  );
});
