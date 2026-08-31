// Shatter — screens/game-over-shows-the-score: the game-over screen draws the score the
// run finished on.
//
// THE RULE. `specs/ui.md`, on `gameover`: "It shows the final score and the wave the
// game reached." `specs/instrumentation.md` poses the score with `setScore(n)`, so the
// reading is the posed figure appearing among the runs of text the screen drew.
//
// THE SCORE IS POSED, NOT EARNED. Whether destroying a rock pays what it should is
// every item in `scoring`; this item is about the SCREEN, so the figure is put there
// directly and the check reads whether the screen shows it.
//
// WHY `470`. Three digits, so a build that drew only part of the figure — a truncated
// field, a fixed two-digit readout — is caught; and under a thousand, so a build that
// groups its digits with a separator is not failed for presenting the same number the
// way a player reads it. Nothing else the screen draws under this pose contains it: the
// wave behind it is `1`, and `specs/ui.md` puts the HUD over `playing` alone.
//
// MATCHING IS BY SUBSTRING, because how the figure is presented is the build's — padded,
// labelled, or set on a line of its own — and `specs/ui.md` fixes only that the screen
// shows it.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the wave is shown
// (`screens/game-over-shows-the-wave`), that the score was earned correctly (`scoring`),
// or where the screen's own entries lead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { reachGameOver } from "./screens";

/** The final score the screen is posed to show: three digits, under a thousand. */
const FINAL_SCORE = 470;

/** The wave posed behind it, whose own digits appear nowhere inside the score. */
const FINAL_WAVE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the posed final score on the game-over screen", async () => {
  await reachGameOver(h, { score: FINAL_SCORE, wave: FINAL_WAVE });

  const calls = await h.presentCalls();
  await captureStill(h, "gameover");

  assertEqual(
    drewText(calls, String(FINAL_SCORE)),
    true,
    `the game-over screen draws the final score ${FINAL_SCORE} (specs/ui.md)`,
  );
});
