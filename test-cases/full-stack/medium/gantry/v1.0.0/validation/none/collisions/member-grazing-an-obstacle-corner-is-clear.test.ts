// collisions/member-grazing-an-obstacle-corner-is-clear — a member that touches an
// obstacle at one corner and lies outside it everywhere else reaches inside
// nothing.
//
// `specs/world.md` § Obstacles: "a body meets an obstacle when some point of the
// body lies inside the box, strictly between the box's minimum and its maximum on
// all three axes. CONTACT IS NOT COLLISION, so A SEGMENT GRAZING A FACE, a segment
// lying flush along one, and a box resting flush against one are all clear of it."
// `specs/statics.md` § Collisions carries the same rule into a run: only "a member
// whose segment reaches inside an obstacle ends the run as
// `structure-struck-obstacle`".
//
// A CORNER IS THE HARDEST GRAZE, and its own point. A segment that stops on a face
// touches a whole face's worth of the box; a segment through a vertex touches at a
// single point while running THROUGH the box's neighbourhood on every axis, so a
// build that clipped the segment axis by axis with an inclusive comparison, or
// that grew the box by an epsilon, reads it as struck.
//
// THE GEOMETRY. The obstacle is the box `x 0.5..1`, `y 1..2`, `z 1..2`, and one of
// its eight vertices is `(1, 1, 1)` — its maximum on `x`, its minimum on `y`, and
// its minimum on `z`. The extra strut runs between two of the crane's own tower
// nodes, the anchor `(0, 0, 2)` and the bottom-flange node `(2, 2, 0)`, so its
// midpoint is exactly that vertex and its direction is `(1, 1, -1)`:
//
//   - past the vertex, toward `(2, 2, 0)`, every point has `x > 1`, the box's
//     maximum on `x`;
//   - short of it, toward `(0, 0, 2)`, every point has `y < 1`, the box's minimum
//     on `y`.
//
// So the segment lies outside the box on some axis at every point but one, and at
// that one point it touches rather than enters.
//
// NOTHING ELSE OF THE CRANE REACHES THE BOX. Every other member of the minimal
// crane either stands at `x = 0` or `x = 2`, outside `0.5..1`; or at `y = 2`, the
// box's maximum; or at `z = 0` or `z = 2`, outside and on the boundary of
// `1..2`; or is an arm member at `y >= 4`. The tape turns the grip alone, so the
// slew is held at `0` and the arm never sweeps into anything.
//
// THE OBSTACLE IS PLACED AFTER THE CRANE IS BUILT: whether the editor accepts such
// a member is a different point, and this one is about what the run's own
// collision stage makes of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  MINIMAL_CRANE,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The box `x 0.5..1`, `y 1..2`, `z 1..2`; its vertex `(1, 1, 1)` is grazed. */
const OBSTACLE_MIN = { x: 0.5, y: 1, z: 1 };
const OBSTACLE_SIZE = { x: 0.5, y: 1, z: 1 };

/** The minimal crane, plus the one strut whose midpoint is that vertex. */
const GRAZING_CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with a strut through the box's corner",
  members: [...MINIMAL_CRANE.members, [[0, 0, 2], [2, 2, 0], "strut"]],
};

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** Five seconds of run clock with the member touching the corner. */
const TICKS = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing for a member that touches an obstacle at one corner", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, GRAZING_CRANE);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, HOLD_TAPE);

  await startRun(h);
  const grazed = await runTicks(h, TICKS);

  await h.capture("graze", "The member touching the obstacle at its corner");

  assertEqual(
    grazed.run.phase,
    "running",
    `the run after ${TICKS} ticks with a strut from (0, 0, 2) to (2, 2, 0) ` +
      "passing through the vertex (1, 1, 1) of the box x 0.5..1, y 1..2, " +
      "z 1..2 and lying outside that box on some axis at every other point: " +
      "contact is not collision (specs/world.md)",
  );
  assertNull(
    grazed.run.cause,
    "the cause of a run in which no member reached inside the obstacle",
  );
});
