// collisions/load-carried-over-an-obstacle-is-clear — a load flown across an
// obstacle's plan with its whole box above the obstacle's top reaches inside
// nothing.
//
// `specs/world.md` § Obstacles: "a body meets an obstacle when some point of the
// body lies inside the box, strictly between the box's minimum and its maximum ON
// ALL THREE AXES", and "a load's [body] is its box at its current position and
// yaw". `specs/statics.md` § Collisions spends it: "An attached load whose box, at
// its current position and yaw, reaches inside an obstacle ends the run as
// `load-struck-obstacle`."
//
// ALL THREE AXES, on the carried load, is what makes the game playable: lifting a
// load over a wall is the whole of a site like Over the Wall. A build that tested
// the load's plan against the obstacle's plan drops the run the moment the crate
// passes above the block, and no such site can be cleared — which is why the cap
// is `broken`. The same requirement on a MEMBER is a separate point; this one is
// the load's.
//
// THE GEOMETRY. The block is `x 2.5..5`, `y 0..1`, `z -1..1`. The crate hangs from
// the hook with its lift point posed at `(0, 3.5, 0)` on a half-unit of cable, so
// its box — `2 x 2 x 2`, hanging its full height below the lift point
// (`specs/world.md`) — stands at `y 1.5..3.5`, half a unit above the block's top.
// The tape then drives the trolley the length of the track, which carries the
// pivot, and with it the load, straight across the block's footprint. A swinging
// bob only ever stands NEARER the pivot's height than the still one does, so the
// box can only rise as it goes.
//
// THE CHECK READS BOTH HALVES OF THAT rather than assuming them: it requires that
// the lift point really did cross the block's `x` range, so a build that never
// moved the trolley cannot pass, and that the box's bottom face really did stay
// above the block's top on every tick, so the run it is grading is the one this
// scenario describes.
//
// EVERYTHING ELSE IS OUT OF THE WAY. The block stands at `x >= 2.5` and `y <= 1`;
// the crane's tower reaches only `x = 2` and its arm only `y >= 4`, so no member's
// segment can reach inside it. The yard holds one load and one obstacle and
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS, TROLLEY_MAX_RATE } from "../constants";
import {
  addOneLoad,
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The cable length that hangs the lift point at {@link LIFT} under the pivot. */
const HOIST = 0.5;

/** The crate's lift point at the start of the crossing. */
const LIFT = { x: 0, y: 3.5, z: 0 };

/** The block `x 2.5..5`, `y 0..1`, `z -1..1`, under the load's path. */
const OBSTACLE_MIN = { x: 2.5, y: 0, z: -1 };
const OBSTACLE_SIZE = { x: 2.5, y: 1, z: 2 };

/** The minimal crane's track runs four units from its origin. */
const TRACK_LENGTH = 4;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: TRACK_LENGTH, rate: TROLLEY_MAX_RATE },
    ],
  },
];

/** Four units at `TROLLEY_MAX_RATE` is two seconds of run clock. */
const CAP = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing while a carried load crosses an obstacle's plan above its top", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 10, y: 2, z: 0, yaw: 0 },
    { x: -10, y: 2, z: 0, yaw: 0 },
  );
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const height = LOAD_CLASS_DIMENSIONS.crate.y;
  const top = OBSTACLE_MIN.y + OBSTACLE_SIZE.y;
  let crossedThePlan = false;
  let lowestBottom = Number.POSITIVE_INFINITY;

  const crossed = await runUntil(
    h,
    (s) => {
      const load = s.run.loads[0];
      if (s.run.tick > 0 && load !== undefined) {
        // `specs/world.md`: the box hangs its full class height below the lift
        // point and reaches half its width and half its depth horizontally.
        lowestBottom = Math.min(lowestBottom, load.pos.y - height);
        if (
          load.pos.x + 1 > OBSTACLE_MIN.x &&
          load.pos.x - 1 < OBSTACLE_MIN.x + OBSTACLE_SIZE.x &&
          load.pos.z + 1 > OBSTACLE_MIN.z &&
          load.pos.z - 1 < OBSTACLE_MIN.z + OBSTACLE_SIZE.z
        ) {
          crossedThePlan = true;
        }
      }
      return (
        s.run.phase !== "running" ||
        s.run.axes.trolley.value >= TRACK_LENGTH - 1e-9
      );
    },
    CAP,
    "the trolley to reach the far end of the track, or the run to end",
  );

  await h.capture("over-wall", "The crate standing over the obstacle");

  assertTrue(
    crossedThePlan,
    "the crate's box to stand inside the block's x and z ranges on some tick " +
      "of the crossing, so the run really did carry it over the block",
  );
  assertGreaterThan(
    lowestBottom,
    top,
    "the lowest the crate's bottom face stood, against the block's top at " +
      `y ${top}: the whole box stayed above it (specs/world.md)`,
  );
  assertEqual(
    crossed.run.phase,
    "running",
    "the run across a crossing on which the crate's box stood inside the " +
      "block's x and z ranges and wholly above its maximum y, so no point of " +
      "it was ever strictly inside on all three axes (specs/world.md)",
  );
  assertNull(
    crossed.run.cause,
    "the cause of a crossing in which nothing reached inside the obstacle",
  );
});
