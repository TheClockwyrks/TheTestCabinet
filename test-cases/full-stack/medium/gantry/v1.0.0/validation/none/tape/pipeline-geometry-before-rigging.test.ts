// tape/pipeline-geometry-before-rigging — the pendulum hangs from the pivot the
// tick's OWN geometry put there.
//
// `specs/program.md` § The tick pipeline orders the stages: "3. Geometry: the
// track … then the arm rotation, the trolley point, and the pivot" and then
// "4. Rigging: the pendulum tick". Geometry is stage 3 and rigging is stage 4, so
// the `P` the pendulum's constraint step uses is this tick's pivot, not the one
// the tick began with.
//
// WHAT THAT MEANS FOR A READING. `specs/rigging.md` fixes the constraint: "The
// cable is inextensible: the bob stays at distance `L` from the pivot", by way of
// step 4, "Constraint position: `p = P + L * n`". So at the end of every tick the
// bob stands exactly the hoist axis's value from the pivot that same tick
// reports, and a build that swung the bob before it moved the pivot would leave
// it exactly that far from the pivot of the tick BEFORE.
//
// THE TROLLEY DRIVES, AND THE SWING IS WHAT SEPARATES THE TWO ANSWERS. Driving
// the trolley at `TROLLEY_MAX_RATE` carries the pivot a fifteenth of a unit a
// tick, and the bob lags behind it: `specs/rigging.md`'s gravity, drift and
// constraint leave the cable hanging off the vertical while the pivot pulls away,
// and off the vertical the two pivots stand at genuinely different distances from
// the bob. The check measures both — the distance to this tick's pivot and the
// distance to the tick before's — and asserts the first against `L` to within a
// millionth of a unit while requiring the second to miss `L` by more than a
// thousandth somewhere in the sweep. Without that second reading the scenario
// could be one where the pivot barely moved, and would decide nothing.
//
// The yard is emptied and the crane is the minimal one: the requirement is about
// the order of two stages, so nothing else stands in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertGreaterThan } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Inside the minimal crane's four-unit track. */
const TARGET = 3;

/** The tape: one trolley move, the only axis anything commands. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: TARGET, rate: TROLLEY_MAX_RATE }],
  },
];

/** Ticks sampled: a second and a half of run clock, all of it under way. */
const TICKS = 90;

/** Float noise on a constraint that is arithmetic rather than a search. */
const TOLERANCE = 1e-6;

/** How far the stale answer must stand from `L` somewhere in the sweep. */
const SEPARATION = 1e-3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bob one cable length from the pivot its own tick built", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  let previous = (await startRun(h)).run.pivot;

  let staleWorst = 0;
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const s = await runTicks(h, 1);
    const cable = s.run.axes.hoist.value;
    assertClose(
      distance3(s.run.bob.pos, s.run.pivot),
      cable,
      TOLERANCE,
      `tick ${tick}: the bob's distance from the pivot that tick reports, ` +
        "which is the cable length the constraint hung it at " +
        "(specs/rigging.md), so the pendulum read the pivot this tick's own " +
        "geometry put there (specs/program.md)",
    );
    staleWorst = Math.max(
      staleWorst,
      Math.abs(distance3(s.run.bob.pos, previous) - cable),
    );
    previous = s.run.pivot;
  }

  await h.capture(
    "state",
    "The bob under a pivot the trolley is carrying away",
  );

  assertGreaterThan(
    staleWorst,
    SEPARATION,
    "how far the bob stands from the PREVIOUS tick's pivot, against the cable " +
      "length: the sweep must be one where the two pivots are far enough " +
      "apart to tell apart",
  );
});
