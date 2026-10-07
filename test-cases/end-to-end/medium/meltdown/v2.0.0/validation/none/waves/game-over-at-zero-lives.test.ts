// waves/game-over-at-zero-lives — lives reaching zero ends the run at once.
//
// `specs/waves.md`, Victory and loss: "Lives reaching `0` ends the run at once, on
// the frame it happens and whatever the phase, and opens the game-over screen."
//
// THE LOSS IS REACHED, NOT POSED, and `specs/instrumentation.md` insists on it
// twice over: `setScreen` "runs no entry effect", and `setLives` "triggers no game
// over: the loss belongs to the leak path, and this is a precondition". So the
// count is posed at one and a Mote is then leaked away through the game's own
// walk, taking it to `0` on the frame the unit reaches its exhaust.
//
// THE RUN IS LEFT MID-WAVE, which is the "whatever the phase" clause and the
// reason this scenario poses `wavePending` above zero. `specs/waves.md` clears a
// wave only "with none of it left to release", so a wave still holding units to
// release cannot clear however its live ones go — and the transition this point
// reads is therefore the zero-lives one alone, with no clear, no wave-clear bonus
// and no build phase mixed into it. The world gate `startRun` shut keeps those
// pending units from actually arriving, so the floor holds the one Mote and
// nothing else.
//
// ONE LIFE AND A ONE-LIFE LEAK. `specs/surge.md` costs a Mote's leak one life, so
// the count lands exactly on `0` rather than below it: a build that ends the run
// only when the count goes NEGATIVE is caught here, where a leak worth more than
// the lives in hand would let it pass.
//
// THE WAVE IS 3 OF A TWENTY-WAVE RUN, far from the last, so nothing here can be
// confused with the final-wave loss that
// `waves/a-fatal-leak-on-the-final-wave-loses` reads.
//
// WHAT EVERY WRONG MODEL READS. A build that ends the run only between waves stays
// on `playing`; one that ends it only below zero stays on `playing`; one that
// treats the last life as a floor rather than a boundary stays on `playing` with
// `0` lives; one that shows the victory screen reads `victory`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseMidWave, runUntilLeaked } from "./run";

/** The wave being fought: an ordinary one, far from the run's last. */
const WAVE = 3;

/** Units of that wave still to release, so the wave cannot clear. */
const PENDING = 2;

/** The lives in hand, against a Mote's leak of exactly one (`specs/surge.md`). */
const LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the game-over screen the moment the last life is lost", async () => {
  await startRun(h);
  await poseMidWave(h, WAVE, PENDING);
  await h.debug.setLives(LIVES);
  await poseLeaker(h);

  const opened = await h.snapshot();
  const leaked = await runUntilLeaked(h);
  const ended = await h.snapshot();

  await captureStill(h, "gameover");

  assertEqual(
    opened.lives,
    LIVES,
    `precondition: the run held ${LIVES} life, mid-wave, with ${PENDING} units still to release`,
  );
  assertTrue(
    leaked,
    "precondition: the Mote reached its exhaust and left the floor",
  );
  assertEqual(
    ended.screen,
    "gameover",
    "the screen the run showed once its last life was leaked away",
  );
});
