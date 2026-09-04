// waves/wave-clears-when-the-last-unit-goes — the last unit dying clears the wave.
//
// specs/waves.md, Clearing a wave: "A wave clears on the frame in which its last
// live unit dies or leaks with none of it left to release", and on that frame,
// short of the final wave, "the wave number rises by one and a build phase for the
// next wave begins". This point reads the DEATH half of that rule; the leak half
// is `waves.a-leak-also-clears`.
//
// THE DEATH IS REAL. `setUnitHp` "does not kill the unit: death belongs to the
// damage path" and `removeUnit` takes a unit off the floor without one
// (specs/instrumentation.md), so neither poses the event this rule turns on. The
// mark is given the least hp a live unit can carry and is shot by an ordinary Arc
// (`waves/run.ts`), so what the clear rests on is a shot landing at all rather than
// on any figure specs/combat.md gives the shot.
//
// THE END OF A WAVE IS POSED, NOT FOUGHT. `wavePending` is `0` and one live unit
// stands on the floor, which is the shape specs/waves.md's rule names: "with none
// of it left to release". Releasing a whole wave to reach it would make this point
// depend on the spawner, the cadence and the composition, which `surge`'s own
// points decide.
//
// THE WORLD GATE IS OPEN, as specs/instrumentation.md's list of the items that
// turn it back on has it. With `wavePending` at `0` there is nothing for the
// spawner to release, so the gate changes nothing about the scenario; what it does
// mean is that the clear is required to happen with the run's own release running
// rather than only with it held.
//
// THE MARK'S MOTION IS OFF, which is the isolation. Left walking it could reach an
// exhaust and LEAK, which clears the wave through the other half of the rule
// entirely and would let a build with no death-clear at all pass this point.
//
// WHAT EVERY WRONG MODEL READS. A build that clears only when the spawner runs dry
// is still in `wave`; one that clears on any unit's death rather than the last is
// not distinguished here and is not meant to be; one that never opens a build
// phase after a clear reads some other phase than `building`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseGun, poseMark, poseWaveEnd, runUntilKilled } from "./run";

/** The wave cleared: an ordinary one, well short of the run's last. */
const WAVE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the phase to building when the wave's last unit dies", async () => {
  startRun(h);
  h.debug.setWaveSpawning(true);
  poseWaveEnd(h, WAVE);
  poseGun(h);
  poseMark(h);

  const killed = await runUntilKilled(h);
  captureStill(h, "cleared");

  assertTrue(killed, "precondition: the wave's last unit died");
  assertEqual(
    h.snapshot().phase,
    "building",
    "the phase the wave's last unit dying left behind",
  );
});
