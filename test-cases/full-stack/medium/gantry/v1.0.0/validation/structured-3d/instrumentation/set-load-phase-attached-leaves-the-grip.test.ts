// instrumentation/set-load-phase-attached-leaves-the-grip — the pose leaves the
// grip axis exactly where it stands.
//
// `specs/instrumentation.md` § The run in progress, on `setLoadPhase` to
// `"attached"`: "The grip's value is left as it is, so a caller that wants the
// hook square on the load sets the grip too." This is precisely where the pose
// PARTS from the action it stands for: on a successful `attach` "the grip's axis
// value is set to the load's current yaw, so the hook seizes the load squarely"
// (`specs/rigging.md`). A build that routed the pose through the action's own
// step would move the grip; the specification says the pose does not.
//
// SO THE GRIP IS STOOD SOMEWHERE THE LOAD'S YAW IS NOT. The grip is posed to
// `35` degrees and the load stands at yaw `0`, so the two readings a build could
// answer with are far apart: `35` is the value left as it is, and `0` is the
// load's yaw a build copying the action's step would write. `setAxis` "sets an
// axis's value, leaving it stopped with no live command", so nothing but this
// pose can move it between the two readings, and nothing is advanced in between.
//
// The world holds exactly the one load the pose is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  createHarness,
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

/** The one load: at yaw 0, so the load's yaw and the posed grip cannot agree. */
const FROM = { x: 10, y: 3, z: 0, yaw: 0 };
const TO = { x: 0, y: 3, z: 10, yaw: 0 };

/** Where the grip is stood before the load is hung on the hook. */
const GRIP = 35;

/** The axis holds the value it was posed, exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the grip where it stands when a load is hung on the hook", async () => {
  await openSite(h, 0);
  // Nothing is cleared here. `standMinimalCrane` empties the structure it stands,
  // `addOneLoad` empties the yard's loads before it places its own, site 1 carries
  // no obstacle (specs/sites.md), and a site opened after a reset carries an empty
  // tape. Each pose below states its own precondition, and driving the rest of the
  // clearing surface would add failure modes belonging to other validators.
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await h.advance(1);

  await h.debug.setAxis("grip", GRIP);
  await h.debug.setLoadPhase(0, "attached");
  const { run } = await h.snapshot();

  await h.capture("grip", "The grip after a load was hung on the hook");

  assertEqual(
    run.loads[0]?.phase,
    "attached",
    "the load the pose hung on the hook, so the grip reading is the one the " +
      "requirement is about",
  );
  assertClose(
    run.axes.grip.value,
    GRIP,
    TOLERANCE,
    'run.axes.grip.value after setLoadPhase(0, "attached"), which leaves the ' +
      "grip as it is rather than squaring it on the load " +
      "(specs/instrumentation.md)",
  );
});
