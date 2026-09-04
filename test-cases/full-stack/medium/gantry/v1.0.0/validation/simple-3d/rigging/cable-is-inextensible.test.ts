// rigging/cable-is-inextensible — whatever happens to the bob, the tick that
// follows leaves it exactly the cable's length from the pivot.
//
// `specs/rigging.md` § The pivot and the bob: "The cable is inextensible: the bob
// stays at distance `L` from the pivot", with `L` the hoist axis's value. The
// tick's own pendulum step is what enforces it — "Constraint position:
// `p = P + L * n`" — so the way to decide the requirement is to put the bob
// somewhere the cable plainly cannot reach and let one real tick run.
//
// THE BOB IS POSED WELL OFF THE SPHERE, and deliberately not merely a little off
// it: `setBob` "puts the bob where it is asked for ... The pendulum's own
// constraint runs on the next tick either way" (`specs/instrumentation.md`), and
// `(3, 8, -2)` stands `5.39` from the pivot against the `2` the cable allows, so
// a build that only nudged the bob back, or that let the cable stretch to reach
// it, is nowhere near the reading below.
//
// THE POSE IS THE POSITION ALONE. The velocity is left where the previous tick
// left it — zero, since the bob hangs at rest — so nothing here depends on how a
// posed velocity is carried, and the tick that follows is an ordinary one.
//
// The distance is read against the hoist value the same snapshot reports, which
// is what `L` names; nothing about the pendulum's direction is asserted, since
// where on the sphere the bob lands is `pendulum-constraint-position`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
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
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Far off the sphere the cable allows, and clear of the ground. */
const OFF_THE_SPHERE = { x: 3, y: 8, z: -2 };

/** Arithmetic slack on a length the specification fixes exactly. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brings the bob back to the hoist length from the pivot", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await runTicks(h, 1);

  await h.debug.setBob(OFF_THE_SPHERE.x, OFF_THE_SPHERE.y, OFF_THE_SPHERE.z);
  const { run } = await runTicks(h, 1);

  await h.capture("state", "The driven state this point decides");

  assertNear(
    distance3(run.pivot, run.bob.pos),
    run.axes.hoist.value,
    TOLERANCE,
    "the distance from the pivot to the bob after one tick, which the " +
      "inextensible cable holds at the hoist axis's value " +
      `${run.axes.hoist.value} (specs/rigging.md)`,
  );
});
