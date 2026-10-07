// runs/step-mid-cycle-finishes-the-cycle — `step` on a run stopped part way through
// a cycle finishes THAT cycle and stops on its boundary, rather than running a whole
// cycle from where it stood.
//
// THE RULE. "`step` acts immediately and never leaves the run running: a run
// mid-cycle, running or paused, completes its current cycle to the boundary, and a
// run paused at a boundary runs one full cycle" (`specs/editor.md`, Running the
// machine). The two halves of that sentence are two different amounts of work, and
// this point is the first: a run at `sim.fraction` `0.5` has half a cycle left, not a
// whole one.
//
// THE CONFIGURATION. One `arm` at `(0, 0)`, rotation `0`, length `ARM_MIN_LEN` (`1`),
// on the one-cell tape `rotate-cw` — so every cycle turns it one step clockwise —
// holding one mote on `(1, 0)`, the hex `specs/parts.md` puts its gripper on
// ("`base + length * DIRS[d]`"). The hold is posed with `setGrip`, "which takes hold
// with no `grab` ever running" (`specs/instrumentation.md`). Nothing else is on the
// field, so no second mote can collide.
//
// The run is driven `0.5` of a cycle and then held with `setPaused(true)`, the gate
// `specs/instrumentation.md` names for the run's clock, and that half is read back
// before the press: this is a run genuinely stopped in the middle of cycle `0`.
//
// THE MOTE IS WHAT SEPARATES THE TWO ANSWERS. The motion table gives a cycle of
// `rotate-cw` "The same rotation about the base" for the held constellation, and "at
// `t = 1` every mote lands exactly on a hex center". Finishing cycle `0` alone lands
// the mote on `(0, 1)`, one clockwise step from `(1, 0)` about `(0, 0)`; running a
// whole cycle beyond the boundary would land it on `(-1, 1)`, two steps round, with
// `sim.cycle` at `2` rather than `1`.
//
// THE VERDICT. One press leaves `sim.cycle` at `1`, `sim.fraction` at `0`,
// `sim.status` `paused`, the arm's live rotation at `1`, and the held mote resting on
// `(0, 1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  ARM_MIN_LEN,
  FRACTION_TOLERANCE,
  RECORDING_RUN_UP,
  RECORDING_SETTLE,
} from "../constants";
import { at, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  pauseRun,
  poseOf,
  spawnMote,
  stepAction,
  takeGrip,
  type Harness,
} from "../harness";

/** The arm's one spoke at rotation `0`, and the hex its gripper stands on. */
const SPOKE = 0;
const GRIPPED = at(1, 0);

/** Where finishing cycle `0` alone lands the held mote. */
const LANDING = rotateAbout(GRIPPED, ORIGIN, 1);

/** Where a whole cycle beyond the boundary would have landed it instead. */
const OVERSHOT = rotateAbout(GRIPPED, ORIGIN, 2);

/** How far into cycle `0` the run is stopped before the press. */
const PART_WAY = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("finishes the part cycle to its boundary rather than a whole cycle beyond it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, GRIPPED, "dust");
  await takeGrip(h, arm, SPOKE, carried);

  await advanceFraction(h, PART_WAY, 6);
  await pauseRun(h);

  const midway = await h.snapshot();
  assertNotNull(
    midway.sim,
    "the run is still live, stopped part way through cycle 0",
  );
  assertEqual(
    midway.sim?.status,
    "paused",
    "the run is paused part way through a cycle, which is where this point presses step",
  );
  assertEqual(midway.sim?.cycle, 0, "cycle 0 has not reached its boundary");
  assertNear(
    midway.sim?.fraction ?? -1,
    PART_WAY,
    FRACTION_TOLERANCE,
    `the run stands at fraction ${PART_WAY}, with half of cycle 0 left to run`,
  );

  await captureReplay(h, "finished", async () => {
    await h.advance(RECORDING_RUN_UP);
    await stepAction(h);
    await h.advance(RECORDING_SETTLE);
  });

  const finished = await h.snapshot();
  assertEqual(
    finished.sim?.status,
    "paused",
    "a step that neither faults nor completes leaves the run paused",
  );
  assertEqual(
    finished.sim?.cycle,
    1,
    "the step finished cycle 0 and stopped at its boundary, so the counter reads 1 and not 2",
  );
  assertNear(
    finished.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the step stopped on the boundary, with nothing of cycle 1 accumulated",
  );
  assertEqual(
    poseOf(finished, arm)?.rotation,
    1,
    "one cycle of rotate-cw ran, turning the arm one step and not two",
  );
  assertEqual(
    moteById(finished, carried)?.q,
    LANDING.q,
    `the held mote landed on (${LANDING.q}, ${LANDING.r}) rather than on (${OVERSHOT.q}, ${OVERSHOT.r}): q`,
  );
  assertEqual(
    moteById(finished, carried)?.r,
    LANDING.r,
    `the held mote landed on (${LANDING.q}, ${LANDING.r}) rather than on (${OVERSHOT.q}, ${OVERSHOT.r}): r`,
  );
});
