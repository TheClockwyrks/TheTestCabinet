// waves/a-leak-also-clears — a wave clears when its last unit LEAKS, exactly as
// when it dies.
//
// `specs/waves.md`, Clearing a wave: "A wave clears on the frame in which its
// last live unit dies or leaks with none of it left to release." The two
// halves of that sentence are two edge cases of one rule, and each is its own
// item so a failed grade names which half the build got wrong: the death is
// `waves/wave-clears-when-the-last-unit-goes`, and the LEAK is this one.
//
// IT IS THE EASIER HALF TO GET WRONG. A leak is the failure path — the unit
// reached its exhaust and cost a life — and a build that treats "the wave is over"
// as something only a kill can bring about leaves the run stuck in a `wave` phase
// that will never end. That is the defect this item exists to catch, and it is
// invisible to the death item.
//
// THE LEAK IS REACHED, NOT POSED, because `specs/instrumentation.md` has
// `setPhase` run no entry effect and clear no wave. The wave is posed at its end —
// the `wave` phase with `wavePending` at `0` — and a Mote is then stood one tile
// short of the right exhaust with its motion on, so the game's own walk carries it
// out through the opening.
//
// THE WAVE IS 3 OF A TWENTY-WAVE RUN, so the clear opens a build phase rather
// than ending the run, and the run's twenty starting lives absorb the Mote's one
// (`specs/surge.md`) with nineteen to spare — so nothing here reaches the
// zero-lives path that `waves/game-over-at-zero-lives` owns.
//
// WHAT EVERY WRONG MODEL READS. A build that clears only on a kill stays in
// `wave`; one that treats any leak as a loss reads `gameover`; one that clears the
// wave but on the leak of any unit rather than the last would pass here and fail
// on a wave that still had units to release, which is the `wavePending` clause
// this pose fixes at `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./run";

/** The wave cleared: an ordinary one, well short of the run's last. */
const WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a build phase when the wave's last unit leaks away", async () => {
  await startRun(h);
  await poseWaveEnd(h, WAVE);
  await poseLeaker(h);

  const opened = await h.snapshot();
  const leaked = await runUntilLeaked(h);
  const cleared = await h.snapshot();

  await captureStill(h, "cleared");

  assertEqual(
    opened.phase,
    "wave",
    `precondition: Wave ${WAVE} in its wave phase with nothing left to release`,
  );
  assertTrue(
    leaked,
    "precondition: the wave's last unit reached its exhaust and left the floor",
  );
  assertEqual(
    cleared.phase,
    "building",
    `the phase the leak of Wave ${WAVE}'s last unit opened`,
  );
});
