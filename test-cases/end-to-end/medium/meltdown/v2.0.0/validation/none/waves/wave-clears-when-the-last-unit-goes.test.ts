// waves/wave-clears-when-the-last-unit-goes — a wave clears on the frame its last
// live unit dies.
//
// `specs/waves.md`, Clearing a wave: "A wave clears on the frame in which its
// last live unit dies or leaks with none of it left to release." What a clear
// then does is the next sentence: "the wave number rises by one and a build phase
// for the next wave begins". So the reading here is the PHASE the clear opened,
// and the wave number it left behind is `waves/clearing-advances-the-wave`'s
// requirement rather than this one's.
//
// THE CLEAR IS REACHED, NOT POSED. `specs/instrumentation.md` is explicit that
// `setPhase` "runs no entry effect" and neither "releases or clears a wave", and
// that `setUnitHp` "does not kill the unit: death belongs to the damage path". So
// the wave is posed at its end — the `wave` phase with `wavePending` at `0`,
// which is the specification's "none of it left to release" — and the DEATH is
// then reached through the game's own damage path.
//
// THE DEATH IS THE SMALLEST ONE THE GAME HAS. `poseKill` stands a pinned Arc over
// a one-hp Mote whose motion is off, so the kill follows from a shot landing at
// all rather than from any figure `specs/combat.md` gives the shot, and the mark
// cannot walk to an exhaust and leak instead — which is the OTHER half of the
// specification's sentence and `waves/a-leak-also-clears`'s own item. Holding the
// tower's heat still means no trip can interrupt the drive.
//
// THE WAVE IS 3 OF A TWENTY-WAVE RUN, so the clear opens a build phase rather
// than ending the run: `specs/waves.md` ends a run on the clear of Wave `N`
// instead, which `waves/victory-on-clearing-the-final-wave` reads.
//
// WHAT EVERY WRONG MODEL READS. A build that never clears stays in `wave`; one
// that clears only when the timer says so stays in `wave`; one that ends the run
// on any clear reads `victory` or `gameover` and no phase at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseKill, poseWaveEnd, runUntilKilled } from "./run";

/** The wave cleared: an ordinary one, well short of the run's last. */
const WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a build phase when the wave's last unit dies", async () => {
  await startRun(h);
  await poseWaveEnd(h, WAVE);
  await poseKill(h);

  const opened = await h.snapshot();
  const died = await runUntilKilled(h);
  const cleared = await h.snapshot();

  await captureStill(h, "cleared");

  assertEqual(
    opened.phase,
    "wave",
    `precondition: Wave ${WAVE} in its wave phase with nothing left to release`,
  );
  assertTrue(
    died,
    `precondition: the wave's last unit was killed and left the floor`,
  );
  assertEqual(
    cleared.phase,
    "building",
    `the phase the death of Wave ${WAVE}'s last unit opened`,
  );
});
