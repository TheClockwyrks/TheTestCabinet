// screens/gameover-copy — the game-over screen draws its copy.
//
// specs/screens.md, on `gameover`: "Shows the heading `GAME OVER`, the final
// score, and the wave the session reached."
//
// The score and wave are posed before the screen is entered — `setScreen` sets
// the screen and leaves "the score, the lives, the wave ... exactly as they
// stood" (specs/instrumentation.md), so what the screen shows is what was posed
// — with figures chosen so neither is a digit-substring of the other or of
// anything else on the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { GAMEOVER_TEXT } from "../constants";
import {
  captureStill,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The posed final score: no digit shared with the posed wave. */
const FINAL_SCORE = 850;

/** The posed wave the session reached. */
const FINAL_WAVE = 6;

it("draws GAME OVER, the final score, and the wave reached", async () => {
  startFreshSession(h);
  h.debug.setScore(FINAL_SCORE);
  h.debug.setWave(FINAL_WAVE);
  h.debug.setScreen("gameover");

  const { calls } = await h.frameDraw();
  captureStill(h, "gameover");

  assertTrue(
    drewText(calls, GAMEOVER_TEXT),
    "the GAME OVER heading drawn on the game-over frame",
  );
  assertTrue(
    drewText(calls, String(FINAL_SCORE)),
    "the final score drawn on the game-over frame",
  );
  assertTrue(
    drewText(calls, String(FINAL_WAVE)),
    "the wave the session reached drawn on the game-over frame",
  );
});
