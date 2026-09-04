// instrumentation/set-paused-resumes — the switch that lets a held run carry on.
//
// THE RULE. "`setPaused(paused)` | Moves `sim.status` between `running` and
// `paused`, exactly as the `play` toggle moves it"
// (`specs/instrumentation.md`, The run), and it is the gate the same file names
// for the run's clock: "The run's clock | ... Exercised by `setPaused(false)`, and
// the speed `setSpeed` sets." Of every gate: "Opening one again resumes that
// faculty from the next cycle onward, with no catching up for the cycles it
// missed."
//
// SO WHERE THE RUN PICKS UP is what is decided here. The clock is stopped half a
// cycle in, two whole cycles of game time pass under the pause, and the run is
// let go again; a quarter of a cycle later the fraction is three quarters of the
// way through cycle `0`. That single reading refuses both of the wrong answers at
// once: a run that RESTARTED would be a quarter of the way in, and one that CAUGHT
// UP on the two cycles it was held through would be two cycles further on. "The
// fraction advances only while the status is `running`" (`specs/simulation.md`) is
// what makes the paused span cost nothing.
//
// `sim.fraction` IS NEVER READ FOR EQUALITY. It is one of "the three figures
// carried as running sums of the frames' own delta times", which "agree to within
// the rounding of that sum rather than bit for bit"
// (`specs/instrumentation.md`, A deterministic core), so every read goes through
// the case's own `FRACTION_TOLERANCE`.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, one arm, an emptied field
// and one mote in its gripper, with the completion switch held off. The hold is
// given with `setGrip`, "which takes hold with no `grab` ever running", so the
// only thing the clock can do is turn the arm.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  ARM_MIN_LEN,
  FRACTION_TOLERANCE,
  RECORDING_RUN_UP,
  RECORDING_SETTLE,
} from "../constants";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  pauseRun,
  resumeRun,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";
import { armPart, solution } from "../formats";
import { gripperHex } from "../parts";

/** Where in the cycle the pause is taken, and how much further the run is let go. */
const HELD_AT = 0.5;
const RESUMED_FOR = 0.25;

/** Cycles of game time that pass while the run is held. */
const WAITED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries on from the cycle and fraction it was holding", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["rotate-cw"]),
    ]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(
    h,
    gripperHex(ORIGIN, 0, ARM_MIN_LEN),
    "dust",
  );
  await takeGrip(h, arm as number, 0, carried);

  await advanceFraction(h, HELD_AT);
  await pauseRun(h);
  await advanceCycles(h, WAITED);

  const held = await h.snapshot();
  assertEqual(
    held.sim?.status,
    "paused",
    "the run is held before it is resumed",
  );
  assertNear(
    held.sim?.fraction ?? -1,
    HELD_AT,
    FRACTION_TOLERANCE,
    "the run is holding the fraction the pause caught it on",
  );
  assertEqual(held.sim?.cycle, 0, "the paused span completed no cycle");

  // The recording brackets the resume itself: the run-up is taken on the run while
  // it is still held, and the resumed span is divided over the settle's frames
  // rather than driven in one, so a reviewer watches the run stand still and then
  // carry on. "An interval of game time reaches the same state however it was
  // divided into frames" (`specs/instrumentation.md`), so neither moves the reading.
  const resumed = await captureReplay(h, "resumed", async () => {
    await h.advance(RECORDING_RUN_UP);
    await resumeRun(h);
    const running = await h.snapshot();
    await advanceFraction(h, RESUMED_FOR, RECORDING_SETTLE);
    return running;
  });
  assertEqual(
    resumed.sim?.status,
    "running",
    "setPaused(false) moves sim.status from paused back to running",
  );

  const carriedOn = await h.snapshot();
  assertNotNull(carriedOn.sim, "the run is live again after the resume");
  assertEqual(
    carriedOn.sim?.status,
    "running",
    "the resumed run is still running",
  );
  assertNear(
    carriedOn.sim?.fraction ?? -1,
    HELD_AT + RESUMED_FOR,
    FRACTION_TOLERANCE,
    "the run carries on from the fraction it was holding, rather than restarting at 0 or catching up on the cycles it was held through",
  );
  assertEqual(
    carriedOn.sim?.cycle,
    0,
    "the cycles that passed under the pause are not made up afterwards",
  );
});
