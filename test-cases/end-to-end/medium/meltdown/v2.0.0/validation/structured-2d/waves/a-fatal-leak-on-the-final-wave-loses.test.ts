// Meltdown — waves/a-fatal-leak-on-the-final-wave-loses: the final wave's last
// unit leaking with one life left is a loss, not a win.
//
// `specs/waves.md`, Victory and loss: "Victory is reached by clearing Wave `N`
// with at least one life left. Lives reaching `0` ends the run at once, on the
// frame it happens and whatever the phase, and opens the game-over screen. A
// leak that takes the lives to `0` on the final wave therefore ends the run in
// loss, not in victory."
//
// THE EDGE CASE IS THE WHOLE ITEM. One frame resolves two transitions at once:
// the wave's last unit goes with none of it left to release, which clears Wave
// `N`, and that same unit's leak charges the last life. The specification orders
// them — the loss wins — and only a scenario in which both fire on the same
// frame can say whether a build orders them the same way.
//
// BOTH SCREENS ARE READ. It is not enough that the game-over screen is open: the
// point is that the VICTORY screen is not, so the assertion names the screen the
// build showed and the failure says which of the two it chose.
//
// `N` IS THE BUILD'S OWN, read from `snapshot().waveCount`, so a build that
// derives the wrong wave count fails `modes.containment-medium` and is graded
// here on what ITS final wave does.
//
// NOTHING IS POSED THAT THE FRAME ITSELF MUST DO. `setLives` "triggers no game
// over" and `setScreen` runs no entry effect (`specs/instrumentation.md`), so
// the life is posed to `1` before the walk and the leak is real: the Mote is one
// tile short of its exhaust and walks out under its own power.
//
// WHAT EVERY WRONG MODEL READS. A build that resolves the clear first and never
// looks at the lives reads `victory`; one that ends the run in victory whenever
// the final wave clears reads `victory`; one that neither wins nor loses reads
// `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilGone } from "./run";

/** The life the run holds going in, which the Mote's leak takes. */
const LIVES = 1;

/** The lives the run must be left with (`specs/surge.md`: a Mote's leak costs 1). */
const EXPECTED_LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the game-over screen rather than the victory screen", async () => {
  startRun(h);
  const finalWave = h.snapshot().waveCount;

  poseWaveEnd(h, finalWave);
  h.debug.setLives(LIVES);
  poseLeaker(h);

  const leaked = await runUntilGone(h);
  const ended = h.snapshot();
  captureStill(h, "gameover");

  assertTrue(
    leaked,
    "precondition: the final wave's last unit reached its exhaust",
  );
  assertEqual(
    ended.lives,
    EXPECTED_LIVES,
    "the lives left after the leak that cleared the final wave",
  );
  assertEqual(
    ended.screen,
    "gameover",
    `the screen after wave ${finalWave} of ${finalWave} was cleared by a leak ` +
      `that took the last life`,
  );
});
