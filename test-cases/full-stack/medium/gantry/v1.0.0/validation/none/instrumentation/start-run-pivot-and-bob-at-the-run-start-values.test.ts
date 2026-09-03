// instrumentation/start-run-pivot-and-bob-at-the-run-start-values — a run stands
// at its run-start pivot and bob before its first tick.
//
// `specs/state.md` § What a run's start leaves: "The pivot | the trolley point
// that posture puts under the cable (`specs/statics.md`)" and "The bob | at rest
// the hoist length below that pivot, with zero velocity (`specs/rigging.md`)".
// `specs/instrumentation.md` says the same of a start posed through the surface:
// "the axes, the pivot, and the bob stand at the run-start values that file
// gives", and its snapshot notes add "from a run's start until its first tick it
// is the run-start pivot `specs/state.md` gives".
//
// WHERE THAT PUTS THEM ON THE MINIMAL CRANE, rule by rule and no reference
// consulted. The run-start posture is `slew` `0`, `trolley` `0`, `hoist`
// `HOIST_START` (`2`) (`specs/program.md`). The pivot is "the trolley point, on
// the rail track at the trolley's position, rotated with the arm"
// (`specs/rigging.md`), so at `trolley` `0` it is the track's origin — "the end
// nearer the slew axis" (`specs/structure.md`) — and at `slew` `0` the arm is
// unrotated, so the origin stands where it was built. The minimal crane's single
// rail runs from `(0, 4, 0)` to `(4, 4, 0)` and its ring's base corner is
// `(0, 2, 0)`, so the slew axis passes through the flange square's centre at
// `x = 1`, `z = 1`: the near end is `(0, 4, 0)`, at `sqrt(2)` from the axis
// against the far end's `sqrt(10)`. The bob then hangs "at rest directly below
// the pivot: position the pivot minus `(0, L, 0)`, velocity zero"
// (`specs/rigging.md`), which is `(0, 2, 0)`.
//
// The reading is taken with no frame advanced, because that is the span the
// requirement covers: the pendulum's own tick runs afterwards and moves the bob.
// The tolerance is `1e-6` on each position, which is arithmetic slack on figures
// the specification fixes exactly rather than a span it allows.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short hoist move: enough for a run to legally start. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The minimal crane's track origin: its rail's end nearer the slew axis. */
const ORIGIN = { x: 0, y: 4, z: 0 };

/** The bob at rest, `HOIST_START` below that pivot. */
const BOB = { x: ORIGIN.x, y: ORIGIN.y - HOIST_START, z: ORIGIN.z };

/** Arithmetic slack on figures the specification fixes exactly. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hangs the bob at rest below the run-start pivot before the first tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const started = await startRun(h);

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertVec3Near(
    started.run.pivot,
    ORIGIN,
    TOLERANCE,
    "the run-start pivot: the trolley point at slew 0 and trolley 0, which is " +
      "the track's origin (specs/state.md)",
  );
  assertVec3Near(
    started.run.bob.pos,
    BOB,
    TOLERANCE,
    `the run-start bob: HOIST_START (${HOIST_START}) below that pivot ` +
      "(specs/rigging.md)",
  );
  assertVec3Near(
    started.run.bob.vel,
    { x: 0, y: 0, z: 0 },
    TOLERANCE,
    "the run-start bob's velocity, which is zero (specs/state.md)",
  );
});
