// waves/a-leak-also-clears — the last unit leaking clears the wave too.
//
// specs/waves.md, Clearing a wave: "A wave clears on the frame in which its last
// live unit DIES OR LEAKS with none of it left to release." The rule names two
// events and this point reads the second of them; `waves.wave-clears-when-the-
// last-unit-goes` reads the first. A build that clears on a death alone has half
// the rule, and only this point tells it from a build that has the whole of it.
//
// THE LEAK IS REAL. A unit "is removed from the floor on the frame ... it reached
// its assigned exhaust" (specs/surge.md), and nothing on the debug surface can
// produce that: `removeUnit` "costs no life, pays no bounty" and is an atom rather
// than the event. So the leaker is posed one tile short of its exhaust and WALKS
// out under its own power (`waves/run.ts`).
//
// NO TOWER STANDS ON THE FLOOR, which is what keeps the two halves of the rule
// apart. With a gun on the floor the mark might die before it reached the opening
// and this point would be reading the death after all.
//
// THE END OF A WAVE IS POSED, NOT FOUGHT: `wavePending` `0` and one live unit,
// which is the shape specs/waves.md's rule names. The world gate stays shut, as
// `startRun` leaves it, because nothing here is about the release.
//
// A LEAK COSTS A LIFE, and the run holds the mode's full `20`
// (specs/modes.md), so the leak that clears this wave cannot also end the run —
// which is a different transition, and `waves.a-fatal-leak-on-the-final-wave-loses`
// is where it is read.
//
// WHAT EVERY WRONG MODEL READS. A build that clears only on a death is still in
// `wave`; one that clears only when the spawner runs dry is too; one that treats a
// leak as ending the run reads `gameover`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilGone } from "./run";

/** The wave cleared: an ordinary one, well short of the run's last. */
const WAVE = 1;

/** The lives the run must still hold once the leak is paid for. */
const LIVES_LEFT_AT_LEAST = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the phase to building when the wave's last unit leaks", async () => {
  startRun(h);
  poseWaveEnd(h, WAVE);
  poseLeaker(h);

  const leaked = await runUntilGone(h);
  const cleared = h.snapshot();
  captureStill(h, "cleared");

  assertTrue(leaked, "precondition: the wave's last unit reached its exhaust");
  assertGreaterThanOrEqual(
    cleared.lives,
    LIVES_LEFT_AT_LEAST,
    "precondition: the leak left the run with a life in hand",
  );
  assertEqual(
    cleared.phase,
    "building",
    "the phase the wave's last unit leaking left behind",
  );
});
