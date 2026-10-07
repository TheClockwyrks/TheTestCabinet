// instrumentation/set-paused-pauses — the switch that holds a run where it stands.
//
// THE RULE. "`setPaused(paused)` | Moves `sim.status` between `running` and
// `paused`, exactly as the `play` toggle moves it"
// (`specs/instrumentation.md`, The run), and it is the gate the same file names
// for the run's clock: "The run's clock | Held still by `setPaused(true)`".
//
// WHAT PAUSING DOES TO THE CLOCK is `specs/simulation.md`: "`sim.status` is one of
// `running`, `paused`, `faulted`, and `complete`. The fraction advances only while
// the status is `running`, so pausing holds it where it is." And `sim.cycle`
// "counts completed cycles", which the fraction is what reaches — so a fraction
// that does not advance is a cycle that does not complete.
//
// THE PAUSE IS TAKEN MID-CYCLE, ON PURPOSE. Half a cycle of game time runs first,
// so the fraction the pause holds is a figure that could visibly move rather than
// the `0` a run opens on: a build that reset the fraction, or that carried on, is
// caught by the same reading. Three whole cycles of game time are then handed to a
// paused run, which is enough for a run that was still advancing to have completed
// three cycles.
//
// `sim.fraction` IS NEVER READ FOR EQUALITY. It is one of "the three figures
// carried as running sums of the frames' own delta times", which "agree to within
// the rounding of that sum rather than bit for bit"
// (`specs/instrumentation.md`, A render-free core), so both reads go through the
// case's own `FRACTION_TOLERANCE`.
//
// AND THE FIELD IS STILL DRAWN. `specs/editor.md` has the run drawn "on the field
// as the run leaves them each frame" in any status, and an `advance` frame is "the
// same update the loop runs followed by a render", so the frames driven under the
// pause are read back for the operations their render issued.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, one arm, an emptied field
// and one mote in its gripper, with the completion switch held off. The hold is
// given with `setGrip`, "which takes hold with no `grab` ever running", so the
// only thing the clock can do is turn the arm.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  pauseRun,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";
import { armPart, solution } from "../formats";
import { gripperHex } from "../parts";

/** Where in the cycle the pause is taken. */
const HELD_AT = 0.5;

/** Cycles of game time handed to the paused run. */
const WAITED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds sim.fraction and sim.cycle where they stood while the field keeps drawing", async () => {
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
  const midCycle = await h.snapshot();
  assertNotNull(midCycle.sim, "the run is live half a cycle in");
  assertEqual(
    midCycle.sim?.status,
    "running",
    "the run is running before it is paused",
  );
  assertNear(
    midCycle.sim?.fraction ?? -1,
    HELD_AT,
    FRACTION_TOLERANCE,
    "half a cycle of game time carried the fraction to the middle of the cycle",
  );
  assertEqual(midCycle.sim?.cycle, 0, "half a cycle completes no cycle");

  await pauseRun(h);
  const paused = await h.snapshot();
  assertEqual(
    paused.sim?.status,
    "paused",
    "setPaused(true) moves sim.status from running to paused",
  );

  await captureReplay(h, "paused", () => advanceCycles(h, WAITED));

  // One more paused frame, read for what its render issued. It is driven
  // outside the capture on purpose: a recorder collecting a replay is the
  // harness's, and this reading is the build's.
  const drew = await h.frameCalls();

  const held = await h.snapshot();
  assertNotNull(held.sim, "the run is still live across the paused frames");
  assertEqual(
    held.sim?.status,
    "paused",
    "the frames advanced under the pause leave the status paused",
  );
  assertNear(
    held.sim?.fraction ?? -1,
    HELD_AT,
    FRACTION_TOLERANCE,
    "the fraction advances only while the status is running, so pausing holds it where it is",
  );
  assertEqual(
    held.sim?.cycle,
    0,
    "a fraction that does not advance completes no cycle",
  );
  assertGreaterThan(
    drew.length,
    0,
    "the field keeps drawing while the run is held",
  );
});
