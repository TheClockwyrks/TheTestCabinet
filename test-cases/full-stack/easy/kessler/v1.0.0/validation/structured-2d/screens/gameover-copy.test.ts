// screens/gameover-copy — the game-over screen draws its copy.
//
// specs/screens.md, on `gameover`: "Shows the heading `GAME OVER`, the final
// score, and the wave the session reached."
//
// The score and wave are posed before the screen is entered —
// `setScreen('gameover')` enters "exactly as losing the last life enters it,
// showing the score and wave as they stand" (specs/instrumentation.md) — with
// figures chosen so neither is a digit-substring of the other or of anything
// else on the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { GAMEOVER_TEXT } from "../constants";
import {
  captureStill,
  drewText,
  openHarness,
  poseScene,
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
  poseScene(h, "playing");
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
