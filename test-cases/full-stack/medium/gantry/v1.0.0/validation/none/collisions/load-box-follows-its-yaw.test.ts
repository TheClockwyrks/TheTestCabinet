// collisions/load-box-follows-its-yaw — a carried load's body is its box AT ITS
// CURRENT YAW, so turning it can reach into an obstacle the unturned box clears.
//
// `specs/world.md` § Obstacles states the one rule and what each body is: "A
// member's body is its segment, and a load's is its box AT ITS CURRENT POSITION
// AND YAW." `specs/statics.md` § Collisions spends it: "An attached load whose
// box, at its current position and yaw, reaches inside an obstacle ends the run
// as `load-struck-obstacle`." The yaw is the grip's value (`specs/rigging.md`:
// "With a load attached, the load's yaw is the grip's value"), so a tape that
// turns the grip turns the box, and a build that tested an axis-aligned box, or
// the box at yaw `0`, never reaches inside.
//
// THE CONTAINER IS THE CLASS THAT SHOWS IT. `specs/world.md` gives it `4 x 2 x 2`
// — the one class whose plan is not square — so its plan is a rectangle whose
// corners swing well outside the square its unturned box occupies.
//
// THE SCENARIO. The load hangs from the hook with its lift point at `(0, 2.5, 0)`,
// directly below the pivot the minimal crane's trolley starts at, so the pendulum
// holds it still (`specs/rigging.md`: the constraint puts the bob at the hoist
// length along the direction from the pivot, which for a bob straight below a
// still pivot is where it already is). The one obstacle is the box `x 2.1..2.6`,
// `y 1..2`, `z -1.05..-0.5`, JUST beyond the corner of the unturned box that
// sweeps toward it, so a few degrees of turn is the whole of what this needs:
//
//   - At yaw `0` the load's box is `x -2..2`, `y 0.5..2.5`, `z -1..1`. Its `x`
//     stops a tenth of a unit short of the block, so no point of it is inside on
//     all three axes and the run runs on.
//   - As the grip turns, the corner standing furthest along `+x` — the one at
//     `(2, -1)` in the box's own plan — swings out to `2 cos(yaw) + sin(yaw)` and
//     back along `-z` to `2 sin(yaw) - cos(yaw)`. About seven degrees in it is
//     past the block's near face with its `z` inside the block's too, and the
//     vertical edge it stands on spans the block's whole `y`, so it is strictly
//     inside on all three axes and the run ends.
//
// THE TURN IS DRIVEN IN BATCHES rather than a tick at a time. This check is about
// the run ending with the cause a turned box striking an obstacle ends it with,
// not about the tick the strike lands on, so the state is read once per batch.
//
// THE YARD HOLDS THIS SCENARIO AND NOTHING ELSE. `addOneLoad` clears the site's
// loads before it adds its own, `addOneObstacle` clears the site's obstacles
// before it adds its own, and `standMinimalCrane` empties the structure before it
// poses one, so the world the run starts on is the one named here.
//
// EVERYTHING ELSE IS OUT OF THE WAY, so the verdict is the load's. No member of
// the minimal crane reaches past `x = 2` at any height, and the block's near face
// is at `x 2.1`, so no member's segment can reach inside it whatever the run does
// (the arm never turns: the tape commands the grip alone). The yard holds no
// other load and no other obstacle, and the load's box bottom stands at `y 0.5`,
// clear of the ground, so `load-struck-ground` is not what ends this run either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  addOneObstacle,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The cable length that hangs the lift point at {@link LIFT} under the pivot. */
const HOIST = 1.5;

/** Where the container's lift point stands: straight below the run's pivot. */
const LIFT = { x: 0, y: 2.5, z: 0 };

/** The box `x 2.1..2.6`, `y 1..2`, `z -1.05..-0.5`. */
const OBSTACLE_MIN = { x: 2.1, y: 1, z: -1.05 };
const OBSTACLE_SIZE = { x: 0.5, y: 1, z: 0.55 };

/** A quarter turn of the hook, and with it of the load hanging on it. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
  },
];

/**
 * How far the turn is driven, and in what batches.
 *
 * `GRIP_ACCEL` carries the grip through the seven degrees the strike needs in
 * under half a second, and the corner stays inside the block until about
 * fourteen. The cap is a full second of run clock, well past both.
 */
const BATCH = 10;
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run once the turned box reaches inside an obstacle the unturned box clears", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "container",
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

  // The scenario the requirement is about: the box AS IT STANDS, barely turned,
  // is clear of the obstacle. Without this the run below could be ending on a box
  // that was inside from the first tick.
  const unturned = await runTicks(h, 1);
  assertLessThan(
    Math.abs(unturned.run.axes.grip.value),
    1,
    "the grip on the first tick, so the box read below is the unturned one",
  );
  assertEqual(
    unturned.run.phase,
    "running",
    "the run with the container's unturned box (x -2..2, y 0.5..2.5, z -1..1) " +
      "standing 0.1 short of the obstacle's x 2.1..2.6 (specs/world.md)",
  );
  assertNull(unturned.run.cause, "the cause while the unturned box is clear");

  let struck: GantrySnapshot = unturned;
  for (
    let driven = 1;
    struck.run.phase === "running" && driven < CAP;
    driven += BATCH
  ) {
    struck = await runTicks(h, BATCH);
  }

  await h.capture(
    "turned",
    "The container turned into the obstacle its unturned box cleared",
  );

  assertEqual(
    struck.run.phase,
    "failed",
    "the run once the turned box reaches inside the obstacle",
  );
  assertEqual(
    struck.run.cause,
    "load-struck-obstacle",
    "the cause a load whose box, at its current position and yaw, reaches " +
      "inside an obstacle ends the run with (specs/statics.md)",
  );
});
