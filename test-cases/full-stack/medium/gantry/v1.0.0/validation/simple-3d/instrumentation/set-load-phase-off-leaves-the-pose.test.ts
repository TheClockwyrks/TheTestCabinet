// instrumentation/set-load-phase-off-leaves-the-pose — a load coming off the
// hook stays where it was.
//
// `specs/instrumentation.md` § The run in progress: "`"waiting"` and `"lost"`
// leave the load at the pose it holds when it comes off." That is a rule about
// what the pose does NOT do: it does not return the load to the pose the run
// started it at, which is the one other pose a build has to hand and the one it
// would answer with if it rebuilt the load from the site's own figures. A run's
// loads start "each `waiting` at the pose it stands at" (`specs/state.md`) and
// "the loads' starting poses are untouched" by a run (`specs/program.md`), so
// that pose is still there to be answered with.
//
// SO THE CHECK COMPARES THE POSE ACROSS THE CALL, AND AGAINST THE STARTING POSE.
// The pose held when the load comes off is read immediately before the phase is
// posed and immediately after it, and the two must agree; and that pose is a
// long way from where the load started, so a build that put the load back would
// fail rather than agree by accident. Reading it back rather than naming a
// figure is what keeps every conforming build passing: an attached load's lift
// point is the bob's position (`specs/rigging.md`), so a build is free to report
// the hook's position for it rather than one it stored, and either way the rule
// under test is that the phase change moves nothing.
//
// The world holds exactly the one load, and nothing is advanced across the pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertGreaterThan, assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

const FROM = { x: 10, y: 3, z: 0, yaw: 0 };
const TO = { x: 0, y: 3, z: 10, yaw: 0 };

/** Where the load is carried to before it comes off: far from both of those. */
const CARRIED = { x: 4, y: 6, z: -3, yaw: 45 };

/** How far from its starting pose the load has to be for the check to bite. */
const CLEAR_OF_START = 2;

/** The pose is left as it is, exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a load coming off the hook at the pose it was holding", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await h.advance(1);

  // Carried away from where it started, then hung on the hook: the pose it holds
  // when it comes off is neither the pose the run began it at nor its pad.
  await h.debug.setLoadPose(0, CARRIED.x, CARRIED.y, CARRIED.z, CARRIED.yaw);
  await h.debug.setLoadPhase(0, "attached");

  const before = (await h.snapshot()).run.loads[0];
  assertGreaterThan(
    distance3(before?.pos ?? { x: NaN, y: NaN, z: NaN }, FROM),
    CLEAR_OF_START,
    "the distance between the pose the load holds and the pose it started at, " +
      "so a load put back where it began would be caught",
  );

  await h.debug.setLoadPhase(0, "waiting");
  const { run } = await h.snapshot();

  await h.capture("stays", "The load where it stood when it came off the hook");

  assertVec3Near(
    run.loads[0]?.pos ?? { x: NaN, y: NaN, z: NaN },
    before?.pos ?? { x: NaN, y: NaN, z: NaN },
    TOLERANCE,
    'run.loads[0].pos across the pose to "waiting", which leaves the load at ' +
      "the pose it holds when it comes off (specs/instrumentation.md)",
  );
  assertClose(
    run.loads[0]?.yaw ?? NaN,
    before?.yaw ?? NaN,
    TOLERANCE,
    'run.loads[0].yaw across the pose to "waiting" ' +
      "(specs/instrumentation.md)",
  );
});
