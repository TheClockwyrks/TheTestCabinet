// tape/pipeline-motion-before-geometry — a tick's geometry stands at the axis
// values that tick's motion left.
//
// `specs/program.md` § The tick pipeline orders the stages: "2. Axis motion:
// advance every commanded axis under the controller above. 3. Geometry: the
// track … then the arm rotation, the trolley point, and the pivot, as
// `specs/statics.md` states." Motion is stage 2 and geometry is stage 3, so the
// pivot a tick reports is the one its OWN trolley value puts under the cable,
// never the one the tick began with.
//
// THE READING IS TAKEN AS SOON AS THE TROLLEY IS MOVING FAST ENOUGH TO TELL THE
// TWO ANSWERS APART, and no later. The trolley accelerates at `TROLLEY_ACCEL`
// (`4` u/s²) from a standing start, so it is crossing about a fiftieth of a unit
// per tick a fifth of a unit along its track — and the pivot is asserted against
// the same tick's value to within a millionth of a unit, four orders of magnitude
// inside the gap a stale reading would leave. Waiting any longer would drive the
// whole move to say the same thing. The tick before is read as well, and its
// value is asserted to be that far away, so the scenario is one that can tell the
// two apart rather than one caught while the trolley was standing still.
//
// WHERE THE PIVOT STANDS is `specs/rigging.md`'s definition — "the trolley
// point, on the rail track at the trolley's position, rotated with the arm" —
// over the minimal crane's single rail, which runs from `(0, 4, 0)` to
// `(4, 4, 0)`. `specs/structure.md` makes the end nearer the slew axis the
// track's origin, and with the ring at `(0, 2, 0)` the slew axis stands at
// `(1, ·, 1)`: `(0, 4, 0)` is `sqrt(2)` from it and `(4, 4, 0)` is `sqrt(10)`, so
// the origin is `(0, 4, 0)` and the track runs along `+x`. Nothing commands the
// slew, so the arm rotation is the identity and the trolley point is
// `(value, 4, 0)` — which the check asserts the slew value to confirm.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertGreaterThan, assertVec3Near } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The minimal crane's track origin, and its direction along the rail. */
const ORIGIN = { x: 0, y: 4, z: 0 };
const DIRECTION = { x: 1, y: 0, z: 0 };

/** Inside the four-unit track, and far enough to be cruising at the reading. */
const TARGET = 3;

/** Where the sweep stops: a fifth of a unit along, the trolley well under way. */
const SAMPLE_AT = 0.2;

/** Ticks the sweep is given to get there: it takes about twenty. */
const CAP = 60;

/** The tape: one trolley move, the only axis anything commands. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: TARGET, rate: TROLLEY_MAX_RATE }],
  },
];

/**
 * How far apart the two answers stand. The trolley crosses about `0.021` units
 * on the tick under test, so a pivot taken from the previous tick's value misses
 * by that much; the assertion below is a millionth of a unit, which is float
 * noise on a rotation by zero rather than a share of the gap.
 */
const TOLERANCE = 1e-6;
const MOVED = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the pivot at the trolley value the same tick advanced to", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const before = await runUntil(
    h,
    (s) => s.run.axes.trolley.value >= SAMPLE_AT,
    CAP,
    `the trolley to reach ${SAMPLE_AT} unit along its track`,
  );
  const now = await runTicks(h, 1);

  await h.capture("state", "The pivot on a tick the trolley was crossing");

  assertClose(
    now.run.axes.slew.value,
    0,
    1e-9,
    "run.axes.slew.value, which no command moves, so the arm stands unrotated " +
      "and the trolley point lies along the rail as built (specs/statics.md)",
  );
  assertGreaterThan(
    now.run.axes.trolley.value - before.run.axes.trolley.value,
    MOVED,
    "how far the trolley moved on the tick under test, so the pivot the " +
      "previous tick's value gives stands well outside the tolerance below",
  );
  assertVec3Near(
    now.run.pivot,
    {
      x: ORIGIN.x + DIRECTION.x * now.run.axes.trolley.value,
      y: ORIGIN.y + DIRECTION.y * now.run.axes.trolley.value,
      z: ORIGIN.z + DIRECTION.z * now.run.axes.trolley.value,
    },
    TOLERANCE,
    "run.pivot against the trolley point that tick's own " +
      "run.axes.trolley.value puts under the cable (specs/program.md)",
  );
});
