// tape/loads-unplaced-with-a-lost-load — a tape that runs out over a lost load
// fails as `loads-unplaced`.
//
// `specs/program.md` § The tick pipeline: "A tick that finds no live step and no
// step left to take is the tick the run ends on: cleared if every load is
// `placed`, otherwise failed as `loads-unplaced`." `lost` is one of the four
// phases a load stands in (`specs/state.md`) and it is not `placed`, so a run
// that runs out over a lost load is a failed one — the clearing rule reads for
// `placed` rather than against `attached`.
//
// THAT IS THE POINT THIS DECIDES, and it is why the lost load is the whole
// scenario: a build that ended the run cleared unless a load was hanging passes
// every check made with an attached load and fails here. `setLoadPhase` reaches
// the phase directly — the poses "pose the run the snapshot reports" and
// "none of them reaches a verdict" — so no dropped `release` and no
// `release-misplaced` verdict stands between the scenario and the reading.
//
// The load is left where it waits, out beyond the crane, because a load that
// comes off the hook "leaves the load at the pose it holds when it comes off"
// and nothing about this requirement concerns where a lost load lies. The yard
// holds nothing else, and the tape is one move with no action step, so the only
// way the run can end is by running out.
//
// AND THE MOVE IS THE SHORTEST ONE THERE IS: its target is the value the hoist
// already stands at when the run starts, and `specs/program.md` § Axis motion
// says such a move "is done on the tick it is issued". So tick 1 takes the step
// and finishes it, and tick 2 is the tick that "finds no live step and no step
// left to take" — the tick this point is about. Driving the axis somewhere first
// would decide the same thing forty ticks later, through an axis controller this
// requirement has nothing to do with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The one load: where it waits, and the pad it never reaches. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };
const TO = { x: 0, y: 2, z: 8, yaw: 0 };

/** One move to where the hoist already stands: the whole tape, done as issued. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
];

/** Ticks the tape is given to run out: the step is done on the tick it issues. */
const CAP = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails as loads-unplaced when the tape runs out over a lost load", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setLoadPhase(0, "lost");
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the tape to run out over the lost load",
  );

  await h.capture("state", "The run that ran out of tape over a lost load");

  assertEqual(
    ended.run.loads[0]?.phase,
    "lost",
    "the load's phase when the tape ran out, which is not placed " +
      "(specs/state.md)",
  );
  assertEqual(
    ended.run.phase,
    "failed",
    "the phase of a run whose tape ran out over a load that is not placed " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.run.cause,
    "loads-unplaced",
    "the cause that run carries (specs/program.md)",
  );
});
