// screens/game-over-shows-the-score — the game-over screen shows the score the run
// finished on.
//
// THE RULE. `specs/ui.md` on `gameover`: "it shows the final score and the wave
// the game reached". The score is the run's own figure — `specs/scoring.md` builds
// it and `specs/instrumentation.md` reports it as `score` — so what is read is
// whether the number the game holds is on the screen the run ended on. Without it
// the player is told the game is over and nothing about how it went.
//
// THE NUMBER IS POSED, AND POSED DISTINCTIVELY. `setScore` puts a figure on the
// run that no build could draw by accident: `POSED_SCORE` is not zero, not a round
// thousand and not any of the four per-rock values `specs/scoring.md` fixes, so a
// build drawing a placeholder, a hard-wired zero or its own running total reads a
// different number and the failure prints what it drew. `POSED_WAVE` is posed
// beside it — sharing no digit run with the score — so the two readouts are
// distinguishable and this item reads only its own.
//
// WHAT COUNTS AS SHOWN. A run of digits reading the score with no further digit
// either side of it, anywhere in the frame's text (`./menu.ts`). `specs/ui.md`
// fixes the number and leaves everything else to the build, so a label beside it
// (`SCORE 4260`) and a group separator inside it (`4,260`) both read as the score,
// and the `4260` inside a longer number does not.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. `setScreen("gameover")`
// (`specs/instrumentation.md`) reaches it directly; how a game arrives there is
// `screens/game-over-on-the-last-life`'s point, and routing through a real death
// would fold that requirement into this grade.
//
// WHAT THIS ITEM DOES NOT DECIDE. The wave, which is
// `screens/game-over-shows-the-wave`; where either is drawn, which `specs/ui.md`
// leaves to the build; or whether the text is legible against what is behind it,
// which the reviewer judges.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnCopy, numberPattern, textRuns } from "./menu";

/** A final score no build draws by accident, and no other readout here shares. */
const POSED_SCORE = 4260;

/** The wave posed beside it: no digit run of one appears inside the other. */
const POSED_WAVE = 13;

/** The ships left when a game is over (`specs/progression.md`). */
const NO_SHIPS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the final score on the game-over screen", async () => {
  h.debug.reset();
  h.debug.setScreen("gameover");
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(NO_SHIPS);

  h.clearCalls();
  await h.advance(1);
  captureStill(h, "gameover");

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the score was read from");
  assertEqual(
    posed.score,
    POSED_SCORE,
    "the final score the run was posed with",
  );

  assertMatches(
    drawnCopy(textRuns(h, h.calls)),
    numberPattern(POSED_SCORE),
    `the final score ${POSED_SCORE} drawn on the game-over screen ` +
      `(specs/ui.md)`,
  );
});
