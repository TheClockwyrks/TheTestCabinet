// collisions/cable-collides-with-nothing — the hoist cable running through an
// obstacle raises nothing.
//
// `specs/statics.md` § Collisions names the bodies that are tested and the bodies
// that are not, and the cable is in the second list: "THE CABLE, the trolley, the
// slew ring, the counterweights, the anchor mounts, waiting loads, and placed
// loads | Nothing". The three tests above it — a member against obstacles, an
// attached load against obstacles and the ground, the hook against the ground —
// are "the whole of it".
//
// The cable is the one of those that sweeps through the world every tick.
// `specs/rigging.md` gives it its geometry: it hangs from the pivot, "is
// inextensible: the bob stays at distance `L` from the pivot", and "is drawn from
// pivot to bob and is otherwise massless". A build that tested that segment
// against obstacles would end a run for a cable that passes a block the load and
// the crane both clear, which the specification never asks for.
//
// THE BOX SITS ON THE CABLE AND ON NOTHING ELSE. The hoist is posed to `3`, so the
// bob hangs at `(0, 1, 0)` under the pivot at `(0, 4, 0)` and the cable is the
// segment between them: `x = 0`, `z = 0`, `y` running from `1` to `4`. The
// obstacle is the box `x -0.5..0.5`, `y 2..3`, `z -0.5..0.5`, which that segment
// crosses strictly inside on all three axes — and the check reads the pivot and
// the bob off the run to prove it, rather than assuming where the build stood
// them.
//
// Nothing else reaches inside. The crane's members at that `x` and `z` are the
// leg from `(0, 0, 0)` to `(0, 2, 0)`, which stops at `y = 2`, the box's own
// minimum, and the mast, which starts at `y = 4`, above its maximum; every other
// member stands at `x = 2` or `z = 2` there, or lies in the `y = 2` plane. The
// hook itself hangs at `y = 1`, below the box, so the one body this scenario could
// be confused with is out of it too; the yard holds no load, and the tape turns
// the grip at the slowest legal rate, so the arm never moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull, assertTrue } from "../assert";
import {
  addOneObstacle,
  createHarness,
  openSite,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The cable length that hangs the bob at `(0, 1, 0)` under the pivot. */
const HOIST = 3;

/** The box `x -0.5..0.5`, `y 2..3`, `z -0.5..0.5`, threaded by the cable. */
const OBSTACLE_MIN = { x: -0.5, y: 2, z: -0.5 };
const OBSTACLE_SIZE = { x: 1, y: 1, z: 1 };

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;

/**
 * Appended through the tape editor's own screen, which is where the tape poses
 * apply (`specs/instrumentation.md`), and left there: `startRun` poses the `run`
 * action, which the program screen carries as well as the build screen.
 */
async function poseHoldTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addMoveStep("grip", 360, HOLD_RATE);
}

/**
 * Ticks driven with the cable through the box.
 *
 * The collision test runs on every tick (`specs/program.md` § The tick pipeline,
 * stage 5), so a build that tested the cable would end the run on the first of
 * these; twenty of them is a margin over the one tick the rule is decided on, not
 * a search.
 */
const TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing for a hoist cable running through an obstacle", async () => {
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared — and `addOneObstacle` clears the obstacles itself.
  await openSite(h, 0);
  await h.debug.clearLoads();
  await standMinimalCrane(h);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseHoldTape(h);

  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run keeps ticking under the reading",
  );
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(0, 1, 0);
  await h.debug.setBobVelocity(0, 0, 0);

  const held = await runTicks(h, TICKS);

  await h.capture("cable", "The hoist cable threaded through the obstacle");

  // The scenario the requirement is about, read off the run: the pivot stands
  // above the box, the bob below it, and both on the box's own vertical line, so
  // the cable between them passes strictly inside it.
  const maxX = OBSTACLE_MIN.x + OBSTACLE_SIZE.x;
  const maxY = OBSTACLE_MIN.y + OBSTACLE_SIZE.y;
  const maxZ = OBSTACLE_MIN.z + OBSTACLE_SIZE.z;
  const straddles = (
    a: number,
    b: number,
    low: number,
    high: number,
  ): boolean => a > low && a < high && b > low && b < high;
  assertTrue(
    held.run.pivot.y > maxY && held.run.bob.pos.y < OBSTACLE_MIN.y,
    "the pivot standing above the box and the bob below it, so the cable " +
      "between them crosses its y range",
  );
  assertTrue(
    straddles(held.run.pivot.x, held.run.bob.pos.x, OBSTACLE_MIN.x, maxX) &&
      straddles(held.run.pivot.z, held.run.bob.pos.z, OBSTACLE_MIN.z, maxZ),
    "the pivot and the bob standing inside the box's x and z ranges, so the " +
      "whole cable does",
  );
  assertEqual(
    held.run.phase,
    "running",
    `the run after ${TICKS} ticks with the hoist cable passing strictly ` +
      "inside an obstacle: the cable is tested against nothing " +
      "(specs/statics.md)",
  );
  assertNull(held.run.cause, "the cause of a run nothing tested raised");
});
