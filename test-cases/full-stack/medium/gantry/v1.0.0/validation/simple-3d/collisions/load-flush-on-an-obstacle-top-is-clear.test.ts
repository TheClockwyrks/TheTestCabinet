// collisions/load-flush-on-an-obstacle-top-is-clear — a load set down flush on an
// obstacle's top face is clear of the obstacle.
//
// `specs/world.md` § Obstacles: "Contact is not collision, so a segment grazing a
// face, a segment lying flush along one, and A BOX RESTING FLUSH AGAINST ONE are
// all clear of it", and the paragraph that follows makes it the rule a site is
// built on: "An obstacle's top face is therefore SOLID GROUND FOR A LOAD: a pad
// may sit on top of an obstacle, and a load set down on that pad rests on the face
// without reaching inside the box, which is how a site asks for a lift onto a
// platform." `specs/statics.md` § Collisions restates it from the run's side: "a
// member lying flush along an obstacle's face and A LOAD SET DOWN FLUSH ON ITS TOP
// are both clear of it."
//
// So this is the accepting side of the one obstacle rule, on the body and the face
// a site's high shelf depends on: if it failed, no lift onto a platform could ever
// be completed.
//
// THE BOTTOM FACE SITS EXACTLY ON THE TOP FACE. `specs/world.md` fixes where a
// load's box stands: the pose is "the pose of the load's lift point: the center of
// its top face", and the box hangs "its full height below it". The container is
// `4 x 2 x 2`, so a lift point at `(0, 3, 0)` puts its bottom face at `y = 1` —
// exactly the top of the obstacle `x -2..-0.25`, `y 0..1`, `z -0.5..0.5`, whose
// plan lies wholly under the box's. Only the `y` axis separates the two, and it
// separates by touching alone, which is the edge this point is about.
//
// THE LOAD IS HELD STILL AND THE CRANE IS OUT OF THE WAY. The lift point stands
// directly below the pivot the trolley starts at, so the pendulum's constraint
// leaves it where it is tick after tick (`specs/rigging.md`), and a swing could
// only ever raise it. The obstacle stands wholly at `x < 0` and every part of the
// crane at `x >= 0`, so no member can reach inside it; the tape turns the grip and
// nothing else, so the arm never moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
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

/** The cable length that hangs the lift point at {@link LIFT} under the pivot. */
const HOIST = 1;

/** The container's lift point: its box is then `y 1..3`, resting on the top. */
const LIFT = { x: 0, y: 3, z: 0 };

/** The box `x -2..-0.25`, `y 0..1`, `z -0.5..0.5`: a platform under the load. */
const OBSTACLE_MIN = { x: -2, y: 0, z: -0.5 };
const OBSTACLE_SIZE = { x: 1.75, y: 1, z: 1 };

/**
 * A tape that keeps the run in progress and moves the crane by nothing readable.
 *
 * `specs/program.md` accepts any rate "greater than `0` and at most the axis's max
 * rate", so the slowest possible turn of the grip — the one axis that "applies no
 * force to anything" (`specs/rigging.md`) — holds the run open for a hundred
 * thousand seconds of run clock while turning the hook by a thousandth of a degree
 * a second. Nothing this check reads moves.
 */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** Half a second of run clock resting on the face. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing for a load whose bottom face rests exactly on an obstacle's top", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "container",
    40,
    { x: 10, y: 2, z: 0, yaw: 0 },
    { x: -10, y: 2, z: 0, yaw: 0 },
  );
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, HOLD_TAPE);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const rested = await runTicks(h, TICKS);

  await h.capture(
    "flush-on-top",
    "The container resting flush on the obstacle's top face",
  );

  assertEqual(
    rested.run.loads[0]?.phase,
    "attached",
    "the load's phase, so what the run tested is the carried load's box",
  );
  assertEqual(
    rested.run.phase,
    "running",
    `the run after ${TICKS} ticks with the container's box (y 1..3) resting ` +
      "flush on the obstacle's top face at y 1: contact is not collision, and " +
      "an obstacle's top face is solid ground for a load (specs/world.md)",
  );
  assertNull(
    rested.run.cause,
    "the cause of a run in which nothing reached inside the obstacle",
  );
});
