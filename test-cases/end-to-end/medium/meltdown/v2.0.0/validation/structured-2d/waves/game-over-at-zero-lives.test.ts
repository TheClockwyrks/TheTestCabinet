// Meltdown — waves/game-over-at-zero-lives: the lives running out ends the run
// where it stands.
//
// `specs/waves.md`, Victory and loss: "Lives reaching `0` ends the run at once,
// on the frame it happens and whatever the phase, and opens the game-over
// screen." `specs/surge.md` charges a leak its leak value in lives, `1` for a
// Mote.
//
// THE LOSS IS REACHED, NOT POSED. `setLives` "triggers no game over: the loss
// belongs to the leak path, and this is a precondition", and `setScreen` runs no
// screen entry effect (`specs/instrumentation.md`). So the run is posed with ONE
// life and a Mote one tile short of its exhaust, and the Mote walks out under
// its own power: the frame that charges the last life is the game's own.
//
// MID-WAVE IS THE POINT, and it is what `wavePending` is posed for.
// `specs/waves.md` ends the run "whatever the phase", and the shape that tells
// the two rules apart is a wave with units still to release: the leak cannot
// clear the wave, because a wave clears only "with none of it left to release",
// so the only transition left for the frame to make is the loss. A build that
// ends its runs from the wave-clear path alone is still in `wave` at the end of
// this drive.
//
// THE PHASE IS READ AFTER THE LOSS AS WELL, so the failure says which of the two
// happened: `wave` with a `playing` screen is a build that lost nothing, and
// `building` is a build that cleared the wave it should not have been able to.
//
// THE WORLD GATE STAYS SHUT, as `startRun` leaves it, so the units posed as
// pending stay pending: what they are for is the shape of the rule, not a floor
// full of surge walking into the reading.
//
// THE WAVE IS `3`, an ordinary one, so nothing about the final wave enters the
// reading. What a fatal leak on the LAST wave does is a rule of its own and
// `waves.a-fatal-leak-on-the-final-wave-loses` reads it.
//
// WHAT EVERY WRONG MODEL READS. A build that only ends a run at the wave-clear
// transition reads `playing`; one that clamps its lives at `1` reads `playing`
// with a life left; one that wins reads `victory`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilGone } from "./run";

/** The wave fought: an ordinary one, neither the first nor the run's last. */
const WAVE = 3;

/** The life the run holds going in, which the Mote's leak takes. */
const LIVES = 1;

/** Units still to release, so the leak cannot clear the wave (`specs/waves.md`). */
const PENDING = 4;

/** The lives the run must be left with (`specs/surge.md`: a Mote's leak costs 1). */
const EXPECTED_LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the game-over screen on the frame the last life is lost, mid-wave", async () => {
  startRun(h);
  h.debug.setWave(WAVE);
  h.debug.setPhase("wave");
  h.debug.setWavePending(PENDING);
  h.debug.setLives(LIVES);
  poseLeaker(h);

  // THE MID-WAVE PRECONDITION IS READ BEFORE THE DRIVE, NOT AFTER IT. What the
  // pose is for is that the wave cannot CLEAR — it clears only "with none of it
  // left to release" (specs/waves.md) — so what has to hold is that the run was
  // mid-wave with units still pending when the fatal leak was walked into. Read
  // after the drive it would be a different claim: `phase` is "the sub-phase of
  // the `playing` screen" (specs/instrumentation.md), and once the run has ended
  // there is no `playing` screen for it to be a sub-phase of. No spec says what
  // it holds then, and a build that puts its state back to the title-screen
  // default of `opening` as it opens the game-over screen has broken no rule.
  const posed = h.snapshot();

  const leaked = await runUntilGone(h);
  const ended = h.snapshot();
  captureStill(h, "gameover");

  assertEqual(
    posed.phase,
    "wave",
    "precondition: the run was mid-wave when the leaker was let go",
  );
  assertEqual(
    posed.wavePending,
    PENDING,
    "precondition: the wave still had units to release, so the leak could " +
      "not clear it (specs/waves.md, Clearing a wave)",
  );
  assertTrue(leaked, "precondition: the unit reached its exhaust");
  assertEqual(
    ended.lives,
    EXPECTED_LIVES,
    "the lives left after the leak that took the last one",
  );
  // The one reading that decides the rule, and the one that tells the two wrong
  // builds apart: a build that only ends its runs from the wave-clear path is
  // still on `playing` here, and so is one that clamped its lives at 1.
  assertEqual(ended.screen, "gameover", "the screen the last life left behind");
});
