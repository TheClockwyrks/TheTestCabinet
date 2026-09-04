// instrumentation/set-load-pose-puts-the-load — the pose puts a load's lift
// point at the world position it is handed, at the yaw it is handed.
//
// `specs/instrumentation.md` § The run in progress: "`setLoadPose(index, x, y,
// z, yaw)` | Puts a load's lift point at a world position, at that yaw", and
// "Each sets what it names and leaves the rest of the run as it stands". The
// snapshot reports both under `run.loads[index]`, as `pos` and `yaw`
// (§ Snapshot shape), so the pose is decided by setting a pose and reading it
// back at the call.
//
// THE LOAD IS LEFT `waiting`. A run's loads start "each `waiting` at the pose it
// stands at" (`specs/state.md`), and a waiting load's pose is its own: an
// attached load's lift point is the bob's position (`specs/rigging.md`), so
// posing one that hangs on the hook would be asking a question the specification
// answers elsewhere.
//
// The world holds exactly the one load this is about — the yard is emptied and
// one is added back — and the posed position and yaw are both well away from the
// pose the load starts at, so a build that ignored the call could not pass by
// leaving the load where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
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

/** Where the one load stands, and the pad it is wanted on. */
const FROM = { x: 10, y: 2, z: 0, yaw: 0 };
const TO = { x: 0, y: 2, z: 10, yaw: 0 };

/** Away from both, and at a yaw neither carries. */
const POSED = { x: 4, y: 5, z: -3, yaw: 90 };

/** The pose answers what it was handed, exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a load's lift point at the world position and yaw it is handed", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await h.advance(1);

  await h.debug.setLoadPose(0, POSED.x, POSED.y, POSED.z, POSED.yaw);
  const { run } = await h.snapshot();

  await h.advance(1);
  await h.capture("pose", "The load at the pose it was handed");

  const load = run.loads[0];
  assertVec3Near(
    load?.pos ?? { x: NaN, y: NaN, z: NaN },
    POSED,
    TOLERANCE,
    "run.loads[0].pos after setLoadPose (specs/instrumentation.md)",
  );
  assertClose(
    load?.yaw ?? NaN,
    POSED.yaw,
    TOLERANCE,
    "run.loads[0].yaw after setLoadPose (specs/instrumentation.md)",
  );
});
