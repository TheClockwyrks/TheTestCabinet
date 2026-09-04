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
// the load's plan against the obstacle's plan drops the run the moment the load
// passes above the block, and no such site can be cleared — which is why the cap
// is `broken`. The same requirement on a MEMBER is a separate point; this one is
// the load's.
//
// THE GEOMETRY. The block is `x 2.1..4.6`, `y 0..1`, `z -1..1`. The container
// hangs from the hook with its lift point posed at `(0, 3.5, 0)` on a half-unit
// of cable, so its box — `4 x 2 x 2`, reaching half its width horizontally from
// the lift point and hanging its full height below it (`specs/world.md`) — stands
// at `x -2..2`, `y 1.5..3.5`, `z -1..1`: half a unit above the block's top, and a
// tenth of a unit short of its near face. The tape then drives the trolley along
// the track, which carries the pivot, and with it the load, straight onto and
// across the block's footprint. A swinging bob only ever stands NEARER the pivot's
// height than the still one does, so the box can only rise as it goes.
//
// THE CONTAINER RATHER THAN THE CRATE, AND THE BLOCK CLOSE IN. The requirement is
// about the crossing, not about the distance travelled to reach one, and what
// would otherwise be driven tick by tick before anything under test happened is
// the trolley's own ramp (`TROLLEY_ACCEL`). So the widest load class meets the
// nearest block the crane's own members leave room for — no member stands further
// out than `x = 2` below the arm — and the box is over the block within a quarter
// of a second. The sweep then stops once the box has stood inside the block's plan
// for {@link INSIDE_TICKS} ticks, which is the crossing this decides.
//
// THE CHECK READS BOTH HALVES OF THAT rather than assuming them: it requires that
// the box really did stand inside the block's `x` and `z` ranges, so a build that
// never moved the trolley cannot pass, and that the box's bottom face really did
// stay above the block's top on every tick, so the run it is grading is the one
// this scenario describes.
//
// EVERYTHING ELSE IS OUT OF THE WAY. The block stands at `y <= 1` and `x >= 2.1`,
// while every member of the minimal crane below the arm stands at `x <= 2` and
// every member of the arm at `y >= 4`, so no member's segment can reach inside it.
// The yard holds one load and one obstacle and nothing else: `addOneLoad` clears
// the site's loads before it adds its own, `addOneObstacle` clears its obstacles,
// and `standMinimalCrane` empties the structure before it poses one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS, TROLLEY_MAX_RATE } from "../constants";
import {
  addOneLoad,
  addOneObstacle,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The class carried, and the box `specs/world.md` gives it. */
const CLASS = "container";
const BOX = LOAD_CLASS_DIMENSIONS[CLASS];

/** The cable length that hangs the lift point at {@link LIFT} under the pivot. */
const HOIST = 0.5;

/** The container's lift point at the start of the crossing. */
const LIFT = { x: 0, y: 3.5, z: 0 };

/** The block `x 2.1..4.6`, `y 0..1`, `z -1..1`, under the load's path. */
const OBSTACLE_MIN = { x: 2.1, y: 0, z: -1 };
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

/** Ticks the box must stand inside the block's plan for: the crossing itself. */
const INSIDE_TICKS = 10;

/** Ticks the sweep is given: a second and a half of run clock. */
const CAP = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing while a carried load crosses an obstacle's plan above its top", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    CLASS,
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

  const top = OBSTACLE_MIN.y + OBSTACLE_SIZE.y;
  let insidePlan = 0;
  let lowestBottom = Number.POSITIVE_INFINITY;

  const crossed = await runUntil(
    h,
    (s) => {
      const load = s.run.loads[0];
      if (s.run.tick > 0 && load !== undefined) {
        // `specs/world.md`: the box hangs its full class height below the lift
        // point and reaches half its width and half its depth horizontally.
        lowestBottom = Math.min(lowestBottom, load.pos.y - BOX.y);
        if (
          load.pos.x + BOX.x / 2 > OBSTACLE_MIN.x &&
          load.pos.x - BOX.x / 2 < OBSTACLE_MIN.x + OBSTACLE_SIZE.x &&
          load.pos.z + BOX.z / 2 > OBSTACLE_MIN.z &&
          load.pos.z - BOX.z / 2 < OBSTACLE_MIN.z + OBSTACLE_SIZE.z
        ) {
          insidePlan += 1;
        }
      }
      return s.run.phase !== "running" || insidePlan >= INSIDE_TICKS;
    },
    CAP,
    `the container's box to stand inside the block's plan for ` +
      `${INSIDE_TICKS} ticks, or the run to end`,
  );

  await h.capture("over-wall", "The container standing over the obstacle");

  assertTrue(
    insidePlan >= INSIDE_TICKS,
    "the container's box to stand inside the block's x and z ranges on the " +
      "ticks of the crossing, so the run really did carry it over the block",
  );
  assertGreaterThan(
    lowestBottom,
    top,
    "the lowest the container's bottom face stood, against the block's top at " +
      `y ${top}: the whole box stayed above it (specs/world.md)`,
  );
  assertEqual(
    crossed.run.phase,
    "running",
    "the run across a crossing on which the container's box stood inside the " +
      "block's x and z ranges and wholly above its maximum y, so no point of " +
      "it was ever strictly inside on all three axes (specs/world.md)",
  );
  assertNull(
    crossed.run.cause,
    "the cause of a crossing in which nothing reached inside the obstacle",
  );
});
