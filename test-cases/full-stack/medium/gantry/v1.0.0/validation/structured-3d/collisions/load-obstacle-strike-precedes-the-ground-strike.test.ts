// collisions/load-obstacle-strike-precedes-the-ground-strike — a load's obstacle
// strike is reported before its ground strike on the same tick.
//
// specs/program.md § The tick pipeline: the collisions stage is "members, the
// load, and the ground", and "the first failure a tick reaches ends the run with
// that cause". specs/statics.md § The failure causes says the same from the other
// side: "Every failed run carries exactly one cause, the first the tick pipeline
// reached". So a tick on which the carried load is both inside an obstacle and
// below the ground is a `load-struck-obstacle` and not a `load-struck-ground`.
//
// ONE POSE MAKES BOTH TESTS TRUE AT ONCE. The trolley is put at the end of the
// minimal crane's four-unit track, so the pivot stands at `(4, 4, 0)`, and a
// cable of `2.5` puts the crate's lift point at `(4, 1.5, 0)`. Its `2 x 2 x 2`
// box (specs/world.md § Loads) therefore fills `x 3..5`, `y -0.5..1.5`,
// `z -1..1`:
//
//   - it is half a unit through the yard floor, since `1.5` minus the crate's
//     class height of `2` is `-0.5`, which is below `0`; and
//   - it is strictly inside the block standing on the ground beneath it, which
//     fills `x 3..5`, `y 0..4`, `z -1..1`.
//
// NO MEMBER IS IN THAT BLOCK, so the stage before the load cannot take the
// verdict: every member of the minimal crane that reaches over `x = 3` — the
// rail, the two ties to its tip and the strut down from the mast — lies at
// `y = 4` or above, and the block's top face is `y = 4`, which is flush and not
// inside (specs/world.md § Obstacles). The tower stands at `x <= 2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertVec3Near } from "../assert";
import { GRIP_MAX_RATE, LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The minimal crane's track: from `(0, 4, 0)` out to `(4, 4, 0)`. */
const TRACK_LENGTH = 4;

/** The lift point: half a unit of the crate's box below the ground. */
const LIFT = {
  x: TRACK_LENGTH,
  y: LOAD_CLASS_DIMENSIONS.crate.y - 0.5,
  z: 0,
} as const;

/** The cable that holds it there, hanging from the pivot at `y = 4`. */
const CABLE = 4 - LIFT.y;

/** The block standing on the ground under the trolley. */
const BLOCK_MIN = { x: 3, y: 0, z: -1 } as const;
const BLOCK_SIZE = { x: 2, y: 4, z: 2 } as const;

/** A tape that turns the grip and moves nothing that carries the load. */
const HOLD: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the obstacle when the carried load is inside one and below the ground at once", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: LIFT.x, y: LIFT.y, z: LIFT.z, yaw: 0 },
    { x: LIFT.x, y: LIFT.y, z: LIFT.z, yaw: 0 },
  );
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("trolley", TRACK_LENGTH);
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const s = await runTicks(h, 1);
  await h.capture("both", "The load inside the block and below the yard floor");

  // The guard: the tick must have run over the pose that makes both tests true.
  assertVec3Near(
    s.run.bob.pos,
    LIFT,
    0.05,
    "the lift point the tick's rigging left: inside the block, and its class " +
      "height below it through the floor (specs/rigging.md)",
  );
  assertEqual(
    s.run.phase,
    "failed",
    "the run after one tick with the carried crate inside the block and " +
      "below the ground (specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "load-struck-obstacle",
    "the cause a tick reaches first when the carried load is both inside an " +
      "obstacle and below the ground: the load is tested against obstacles " +
      "before the ground (specs/program.md, specs/statics.md)",
  );
});
