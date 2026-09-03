// collisions/waiting-load-collides-with-nothing — a waiting load is tested
// against nothing.
//
// specs/statics.md § Collisions, the body table: "The cable, the trolley, the
// slew ring, the counterweights, the anchor mounts, waiting loads, and placed
// loads" are tested against "Nothing". The three tests above the table are "the
// whole of it", and each of them names an ATTACHED load or a member, so a load
// that is still waiting at its starting pose raises nothing of any kind.
//
// THE WAITING CRATE IS PUT WHERE AN ATTACHED ONE WOULD FAIL TWICE OVER. Its
// starting lift point is `(10, 1, 0)`, so its `2 x 2 x 2` box (specs/world.md
// § Loads) fills `x 9..11`, `y -1..1`, `z -1..1`: strictly inside the block posed
// over it, which fills `x 9..11`, `y 0..4`, `z -1..1`, AND a full unit below the
// yard floor, its lift point's `y` minus its class height coming to `-1`. Either
// of those ends a run carrying the load; neither may end this one.
//
// THE CRANE NEVER GOES NEAR IT. The minimal crane stands at `x <= 4`, a clear
// five units from the block, and the tape turns the grip alone — which moves no
// member and applies no force (specs/rigging.md § The grip) — so the only thing
// in the block for the whole window is the waiting crate. A tape that ran out
// would end the run as `loads-unplaced` on a load that is still waiting, so the
// window is well inside the eight seconds this one runs for.
//
// THE WINDOW IS AS LONG AS THE RULE NEEDS AND NO LONGER. The collision tests run
// on every tick of a run (specs/statics.md), and the crate is already strictly
// inside the block and a unit under the floor on the run's first tick, so a build
// that tested a waiting load against either raises its verdict at once. Ninety
// ticks is a second and a half of that same standing arrangement, which is margin
// for a build that tests on a slower cadence rather than a distance the scenario
// has to travel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
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

/** Where the crate waits: inside the block, and a unit through the floor. */
const START = { x: 10, y: 1, z: 0, yaw: 0 } as const;

/** The block standing over it, well clear of the crane. */
const BLOCK_MIN = { x: 9, y: 0, z: -1 } as const;
const BLOCK_SIZE = { x: 2, y: 4, z: 2 } as const;

/** Ticks the waiting crate is left standing there: a second and a half. */
const WINDOW = 90;

/** A tape that turns the grip and moves nothing near the block. */
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

it("runs on with a waiting load standing inside an obstacle and through the floor", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, START);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, HOLD);
  await startRun(h);

  const s = await runTicks(h, WINDOW);
  await h.capture(
    "waiting",
    "The waiting crate standing inside the obstacle and through the floor",
  );

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks with a waiting crate strictly ` +
      "inside a block and a unit below the ground: a waiting load is tested " +
      "against nothing (specs/statics.md, the body table)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with the waiting crate in the block`,
  );
  // The guard: the load must still be waiting, since a load that had somehow
  // been picked up would be tested by rules this check is not about.
  assertEqual(
    s.run.loads[0]?.phase,
    "waiting",
    "the phase of a load no tape action has reached (specs/world.md)",
  );
});
