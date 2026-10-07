// screens/game-over-shows-the-wave — the game-over screen shows the wave the run
// reached.
//
// THE RULE. `specs/ui.md` on `gameover`: "it shows the final score and the wave
// the game reached". The wave is the run's own figure — `specs/progression.md`
// advances it and `specs/instrumentation.md` reports it as `wave` — so what is
// read is whether the number the game holds is on the screen the run ended on. It
// is the half of the summary that says how FAR a player got, and a build that
// shows the score alone leaves that unanswered.
//
// THE NUMBER IS POSED, AND POSED DISTINCTIVELY. `setWave` puts a figure on the run
// that is neither the wave a game opens on nor the `0` a game before its first
// wave carries, so a build drawing a hard-wired `1`, a placeholder or nothing at
// all reads a different number and the failure prints what it drew. The score is
// posed beside it and shares no digit run with it — `13` does not appear inside
// `4260` — so a build that drew only the score cannot be credited with the wave.
//
// WHAT COUNTS AS SHOWN. A run of digits reading the wave with no further digit
// either side of it, anywhere in the frame's text (`./menu.ts`). `specs/ui.md`
// fixes the number and leaves everything else to the build, so a label beside it
// (`WAVE 13`) reads as the wave and the `13` inside `130` does not.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. `setScreen("gameover")`
// (`specs/instrumentation.md`) reaches it directly, and `setWave` "spawns no rocks
// and clears none", so the wave number is posed without a wave's worth of field
// arriving with it. How a game arrives at the screen is
// `screens/game-over-on-the-last-life`'s point.
//
// WHAT THIS ITEM DOES NOT DECIDE. The score, which is
// `screens/game-over-shows-the-score`; where either is drawn, which `specs/ui.md`
// leaves to the build; or that the wave number was ADVANCED correctly, which is
// `waves/wave-number-increments`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnCopy, numberPattern, textRuns } from "./menu";

/** A wave reached that is neither a game's opening wave nor its pre-wave zero. */
const POSED_WAVE = 13;

/** The score posed beside it: no digit run of one appears inside the other. */
const POSED_SCORE = 4260;

/** The ships left when a game is over (`specs/progression.md`). */
const NO_SHIPS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the wave the run reached on the game-over screen", async () => {
  h.debug.reset();
  h.debug.setScreen("gameover");
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(NO_SHIPS);

  h.clearCalls();
  await h.advance(1);
  captureStill(h, "gameover");

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the wave was read from");
  assertEqual(posed.wave, POSED_WAVE, "the wave the run was posed as reaching");

  assertMatches(
    drawnCopy(textRuns(h, h.calls)),
    numberPattern(POSED_WAVE),
    `the wave ${POSED_WAVE} the run reached drawn on the game-over screen ` +
      `(specs/ui.md)`,
  );
});
