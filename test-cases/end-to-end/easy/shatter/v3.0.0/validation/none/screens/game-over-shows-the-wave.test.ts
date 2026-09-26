// Shatter — screens/game-over-shows-the-wave: the game-over screen draws the wave the
// run reached.
//
// THE RULE. `specs/ui.md`, on `gameover`: "It shows the final score and the wave the
// game reached." `specs/instrumentation.md` poses the wave with `setWave(n)`, which
// "spawns no rocks and clears none", so the reading is the posed figure appearing among
// the runs of text the screen drew.
//
// WHY `12`, AND WHY THE SCORE BEHIND IT IS `0`. Two digits, so a build that draws only
// the first — a single-character readout, a wave counter that never left one column — is
// caught, where a one-digit wave would let it pass. The score is posed to `0` so the only
// two-digit run the screen has to draw is the wave itself: a build that drew the wave
// nowhere and the score somewhere cannot be read as having drawn this.
//
// MATCHING IS BY SUBSTRING, because how the figure is presented is the build's —
// labelled `WAVE 12`, padded, or set on a line of its own — and `specs/ui.md` fixes only
// that the screen shows it.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the score is shown
// (`screens/game-over-shows-the-score`), that the wave number advanced correctly
// (`waves/wave-number-increments`), or where the screen's own entries lead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { drewText } from "../case-harness/index";
import {
  captureStill,
  createHarness,
  presentCalls,
  type Harness,
} from "../harness";
import { reachGameOver } from "./screens";

/** The wave the screen is posed to show: two digits, so a truncated readout is caught. */
const FINAL_WAVE = 12;

/** The score posed behind it, whose single digit appears nowhere inside the wave. */
const FINAL_SCORE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the posed wave number on the game-over screen", async () => {
  await reachGameOver(h, { score: FINAL_SCORE, wave: FINAL_WAVE });

  const calls = await presentCalls(h);
  await captureStill(h, "gameover");

  assertEqual(
    drewText(calls, String(FINAL_WAVE)),
    true,
    `the game-over screen draws the wave reached, ${FINAL_WAVE} (specs/ui.md)`,
  );
});
