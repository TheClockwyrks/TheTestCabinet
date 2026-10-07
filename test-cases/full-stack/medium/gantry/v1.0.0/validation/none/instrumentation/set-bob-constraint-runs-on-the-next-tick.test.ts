// instrumentation/set-bob-constraint-runs-on-the-next-tick — a posed bob is
// constrained on the next tick, not at the call.
//
// `specs/instrumentation.md` § The run in progress: "`setBob` puts the bob where it is
// asked for, so a caller that wants a bob the cable can hold sets the hoist axis to
// the distance it left between the pivot and the bob. The pendulum's own constraint
// runs on the next tick either way." Two halves of one requirement, and the second is
// what makes the first safe: the pose is exact even where the cable cannot hold it,
// and the cable is what puts the bob back — on a tick, through the rules, like every
// other outcome in the game.
//
// THE BOB IS POSED AT TWICE THE CABLE'S LENGTH, so the two halves cannot be confused:
// a build that constrained the bob inside the call reads back the constrained point
// rather than the posed one, and a build that never constrains it at all leaves it out
// at twice the length after the tick. `specs/rigging.md` fixes where the constraint
// puts it — "Constraint direction: `n = (p - P) / |p - P|`" then "Constraint position:
// `p = P + L * n`" — so the bob comes back along the line it was posed on, at the
// hoist length from the pivot.
//
// OFF THE VERTICAL, at three-four-five, so "along the same direction" is a reading
// with something in it: a bob posed straight down would be back on the same line
// whatever the constraint did with the direction.
//
// THE TAPE COMMANDS THE GRIP, which is the one axis that moves neither the pivot nor
// the cable's length (`specs/rigging.md`: the grip "turns the bare hook, visibly and
// to no other effect"). So the `P` and the `L` the constraint uses on the tick that
// follows are the ones this check read at the start, and the reading afterwards is
// about the constraint rather than about a pivot that moved under it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  distance3,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The direction the bob is posed along, a unit vector off the vertical. */
const N = { x: 0.6, y: -0.8, z: 0 } as const;

/** Exact, up to the doubles the reading crosses on: the pose is not integrated. */
const EXACT = 1e-9;

/**
 * One tick of gravity's drift, carried onto the constrained point.
 *
 * `specs/rigging.md` runs the gravity and drift steps before the constraint, so the
 * bob is `g * dt^2` (`10 / 3600`, under `0.003` units) lower than the posed point
 * when the direction is taken. At the posed radius of `2 * L` that turns the
 * direction by under a thousandth of a radian, which moves the constrained point, at
 * radius `L`, by under `0.002` units. A hundredth of a unit covers it with room to
 * spare and is far inside the `L` a missing constraint would leave.
 */
const DRIFT = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the bob exactly where it was posed, and constrains it on the tick after", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
    },
  ]);

  const started = await startRun(h);
  const pivot = started.run.pivot;
  const length = started.run.axes.hoist.value;

  // Twice the cable's length from the pivot: a place the cable cannot hold it.
  const posed = {
    x: pivot.x + 2 * length * N.x,
    y: pivot.y + 2 * length * N.y,
    z: pivot.z + 2 * length * N.z,
  };
  await h.debug.setBob(posed.x, posed.y, posed.z);
  const atTheCall = (await h.snapshot()).run.bob.pos;

  const ticked = await runTicks(h, 1);
  await h.capture("state", "the bob the pendulum's constraint pulled back in");

  assertVec3Near(
    atTheCall,
    posed,
    EXACT,
    "the bob at the call: setBob puts it where it is asked for, cable or no " +
      "cable (specs/instrumentation.md)",
  );
  assertNear(
    distance3(ticked.run.bob.pos, ticked.run.pivot),
    length,
    DRIFT,
    "the bob's distance from the pivot after one tick: the constraint holds " +
      "it at the hoist length (specs/rigging.md)",
  );
  assertVec3Near(
    ticked.run.bob.pos,
    {
      x: pivot.x + length * N.x,
      y: pivot.y + length * N.y,
      z: pivot.z + length * N.z,
    },
    DRIFT,
    "where the constraint put the bob: at the hoist length from the pivot, " +
      "along the direction it was posed on",
  );
});
