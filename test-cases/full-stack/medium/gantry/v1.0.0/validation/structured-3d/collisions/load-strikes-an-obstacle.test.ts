// collisions/load-strikes-an-obstacle — an attached load reaching inside an
// obstacle ends the run.
//
// specs/statics.md § Collisions: "An attached load whose box, at its current
// position and yaw, reaches inside an obstacle ends the run as
// `load-struck-obstacle`." Reaching inside is specs/world.md § Obstacles's one
// rule: "a body meets an obstacle when some point of the body lies inside the
// box, strictly between the box's minimum and its maximum on all three axes."
//
// THE LOAD IS CARRIED OUT TO THE END OF THE ARM AND THE BLOCK IS PUT UNDER IT.
// The trolley is posed at the far end of the minimal crane's four-unit track, so
// the pivot stands at `(4, 4, 0)` and the crate hangs from it on the run's own
// starting cable, its lift point at `(4, 2, 0)` and its `2 x 2 x 2` box
// (specs/world.md § Loads) filling `x 3..5`, `y 0..2`, `z -1..1`. The block
// spans `x 2.5..5.5`, `y 0.5..3.5`, `z -1.5..1.5`, so the whole middle of the
// crate is strictly inside it — this is a strike and not a graze.
//
// AND NOTHING ELSE IN THAT BLOCK CAN END THE RUN FIRST. The collision stage tests
// members, then the load, then the ground (specs/program.md § The tick pipeline),
// so both of the other two are kept out of the scenario: every member of the
// minimal crane that reaches over `x 2.5` lies at `y = 4` or above — the rail,
// the two ties to its tip, and the strut down from the mast — and the block's top
// is `3.5`, while the tower stands at `x <= 2`; and the crate's bottom face rests
// at exactly `y = 0`, which specs/statics.md calls on the ground rather than
// through it. The obstacle strike is the only verdict the tick can reach.
//
// THE BLOCK IS POSED AFTER THE CRANE STANDS, which specs/instrumentation.md
// § The site allows without qualification: "posing them refuses nothing and
// changes nothing that is built".

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

/** Where the crate hangs: below the trolley at the end of the track. */
const LIFT = {
  x: TRACK_LENGTH,
  y: LOAD_CLASS_DIMENSIONS.crate.y,
  z: 0,
} as const;

/** The block the crate hangs inside: clear of every member, off the ground. */
const BLOCK_MIN = { x: 2.5, y: 0.5, z: -1.5 } as const;
const BLOCK_SIZE = { x: 3, y: 3, z: 3 } as const;

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

it("ends the run as load-struck-obstacle when the carried box reaches inside one", async () => {
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
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const s = await runTicks(h, 1);
  await h.capture("struck", "The carried crate inside the block");

  // The guard: the tick must have run over the geometry this check posed, with
  // the crate's box well inside the block on all three axes.
  assertVec3Near(
    s.run.bob.pos,
    LIFT,
    0.05,
    "the lift point the tick's rigging left, below the trolley at the end of " +
      "the track (specs/rigging.md)",
  );
  assertEqual(
    s.run.phase,
    "failed",
    "the run after one tick with the carried crate's box reaching inside the " +
      "block (specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "load-struck-obstacle",
    "the cause of a run ended by an attached load reaching inside an obstacle " +
      "(specs/statics.md)",
  );
});
