// tape/action-step-occupies-one-tick — an action step is taken, executed and
// complete on one tick, and is never live at the top of one.
//
// specs/program.md § The tick pipeline: "An action step is taken, executed, and
// complete on one tick, and the step after it is taken on the next, so two
// actions in a row occupy two ticks and never one." specs/state.md says the same
// from the snapshot's side: "an action step is taken, executed, and complete on
// one tick, so it is never live at the top of one".
//
// THE READING IS THE STEP INDEX AND THE LIVE BIT, TICK BY TICK. On the tick the
// action is taken, `stepIndex` has already moved past it and `stepLive` is
// `false` — the step did not survive its own tick. On the tick after, the move
// that follows it is taken and IS live, which is what shows the action occupied a
// tick of its own rather than sharing one with the step after it.
//
// The action is an `attach`, and the load stands with its lift point exactly at
// the hook, `HOIST_START` below the track origin the trolley starts at, so the
// attach has a candidate within `ATTACH_RADIUS` and executes rather than ending
// the run as `attach-missed` (specs/rigging.md). The step after it is a hoist
// move short enough that nothing else can happen in the two ticks this reads: the
// cable shortens, so the load rises rather than nearing the ground.
//
// The yard holds that one load and nothing else: an obstacle or a second load
// would be a bystander in a scenario about the tape's own clock.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The bare hook at a run's start: the track origin, `HOIST_START` below. */
const HOOK = { x: 0, y: 4 - HOIST_START, z: 0, yaw: 0 } as const;

/** Shorter cable, so the attached load rises rather than nearing the ground. */
const HOIST_TARGET = HOIST_START - 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes an action step on its own tick and takes the next step on the tick after", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await poseTape(h, [
    { kind: "action", action: "attach" },
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_TARGET, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);

  const first = await runTicks(h, 1);
  const second = await runTicks(h, 1);

  await h.capture("state", "The tape one tick past its action step");

  assertEqual(
    first.run.attached,
    0,
    "the load on the hook after tick 1, so the action step was taken and " +
      "executed on that tick (specs/rigging.md)",
  );
  assertEqual(
    first.run.stepIndex,
    1,
    "the step the run stands on after tick 1: the action is complete on the " +
      "tick it was taken, so the index has already moved past it " +
      "(specs/program.md)",
  );
  assertTrue(
    first.run.stepLive === false,
    "stepLive after tick 1: an action step is never live at the top of a " +
      "tick (specs/program.md)",
  );

  assertEqual(
    second.run.stepIndex,
    1,
    "the step the run stands on after tick 2, which is the step after the " +
      "action (specs/program.md)",
  );
  assertTrue(
    second.run.stepLive === true,
    "stepLive after tick 2: the step after an action is taken on the next " +
      "tick, not on the action's own (specs/program.md)",
  );
});
