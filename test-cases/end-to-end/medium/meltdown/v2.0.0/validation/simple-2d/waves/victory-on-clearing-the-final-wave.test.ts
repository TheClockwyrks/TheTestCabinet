// waves/victory-on-clearing-the-final-wave — clearing Wave N with a life left wins.
//
// specs/waves.md, Victory and loss: "Victory is reached by clearing Wave `N` with
// at least one life left." Clearing a wave puts it on the frame: "If the wave
// cleared was Wave `N`, the run ends in victory, and the victory screen opens."
// specs/screens.md gives `victory` as "The run won".
//
// `N` IS THE BUILD'S OWN, read from `snapshot().waveCount`, so a build that
// derives the wrong number of waves fails `modes.containment-medium` and is still
// graded here on whether ITS last wave wins.
//
// THE CLEAR IS REACHED, NOT POSED. Opening the victory screen is an entry effect
// of the wave-clear transition, and `setScreen` "runs no screen entry effect"
// (specs/instrumentation.md) — a posed `victory` would be this point announcing
// its own answer. So the final wave is posed at its end and its last unit walks out
// through its exhaust under its own power.
//
// THE LIFE IN HAND IS THE OTHER HALF OF THE RULE, and it is checked rather than
// assumed: a Containment run opens on `20` lives (specs/modes.md) and a Mote's
// leak costs `1` (specs/surge.md), so nineteen remain, and the precondition below
// says so in the failure message. A leak that took the lives to `0` on the final
// wave would end the run in LOSS, which specs/waves.md states in as many words and
// `waves.a-fatal-leak-on-the-final-wave-loses` reads.
//
// WHAT EVERY WRONG MODEL READS. A build that opens a twenty-first build phase
// reads `playing`; one that ends every run in loss reads `gameover`; one that
// returns to the title reads `title`; one that wins on any clear is caught by
// `waves.a-leak-also-clears`, which requires an ordinary clear to open a build
// phase.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilGone } from "./run";

/** The lives the run must still hold for the clear to be a victory. */
const LIVES_LEFT_AT_LEAST = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the victory screen when the final wave clears with a life left", async () => {
  startRun(h);
  const finalWave = h.snapshot().waveCount;

  poseWaveEnd(h, finalWave);
  poseLeaker(h);

  const cleared = await runUntilGone(h);
  const ended = h.snapshot();
  captureStill(h, "victory");

  assertTrue(
    cleared,
    "precondition: the final wave's last unit left the floor",
  );
  assertGreaterThanOrEqual(
    ended.lives,
    LIVES_LEFT_AT_LEAST,
    "precondition: the run still held a life when the final wave cleared",
  );
  assertEqual(
    ended.screen,
    "victory",
    `the screen after wave ${finalWave} of ${finalWave} cleared`,
  );
});
