// rigging/pivot-follows-the-trolley-along-the-track — the cable hangs from the
// trolley point, so driving the trolley carries the pivot along the track.
//
// `specs/rigging.md` § The pivot and the bob: "The hoist cable hangs from the
// pivot: the trolley point, on the rail track at the trolley's position, rotated
// with the arm". `specs/structure.md` fixes what that means on a track: "The end
// nearer the slew axis is the track's origin. The trolley's position is its
// distance along the track from that origin". So at any moment the pivot is the
// origin advanced along the track's direction by the trolley axis's value, and
// this reads the two against each other on every tick of a real trolley move.
//
// WHERE THE TRACK IS ON THE MINIMAL CRANE, from the harness's design and no
// reference consulted. Its one rail runs from `(0, 4, 0)` to `(4, 4, 0)` and its
// ring's base corner is `(0, 2, 0)`, so the slew axis passes through the flange
// square's centre at `x = 1`, `z = 1`: the near end is `(0, 4, 0)`, at `sqrt(2)`
// from the axis against the far end's `sqrt(10)`. The origin is therefore
// `(0, 4, 0)` and the track's direction is `+x`. The run holds `slew` at `0`
// throughout — the tape commands the trolley alone — so the arm is unrotated and
// the track stands where it was built (`specs/statics.md`).
//
// THE TROLLEY IS DRIVEN BY THE TAPE RATHER THAN POSED, and the reading is taken
// at ten points spread along the drive, so the pivot is checked against ten
// distinct trolley values from `0` upward rather than at one posed point. The
// sampling stops well inside the move, so no tick of it is the one that ends the
// run.
//
// TEN READINGS RATHER THAN ONE PER TICK. The requirement is a relation between
// two numbers the snapshot reports at the same moment — the pivot and the trolley
// value — so a build either holds it at every tick or holds it at none, and every
// extra sample buys coverage of the same relation at the price of a whole crossing
// into the page. The ticks BETWEEN the readings still run: `runTicks` advances
// them as one batch, so the trolley reaches the same values it would have reached
// tick by tick and the readings are taken at ten of them.
//
// The world holds the crane and nothing else: a load or an obstacle could only
// end the run for a reason this requirement is not about.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertVec3Near } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The minimal crane's track origin: its rail's end nearer the slew axis. */
const ORIGIN: Vec3 = { x: 0, y: 4, z: 0 };

/** The track's direction, origin end toward far end, at slew 0. */
const DIRECTION: Vec3 = { x: 1, y: 0, z: 0 };

/** One trolley move, well inside the track's length of 4. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 3.5, rate: TROLLEY_MAX_RATE }],
  },
];

/** Readings taken, spread along the move, which takes about 79 ticks. */
const SAMPLES = 10;

/** Ticks driven between one reading and the next. */
const STRIDE = 5;

/** Arithmetic slack on a position the specification fixes exactly. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands the pivot at the trolley's own distance along the track", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  let reached = 0;
  for (let sample = 1; sample <= SAMPLES; sample += 1) {
    const { run } = await runTicks(h, STRIDE);
    const along = run.axes.trolley.value;
    reached = Math.max(reached, along);
    assertVec3Near(
      run.pivot,
      {
        x: ORIGIN.x + DIRECTION.x * along,
        y: ORIGIN.y + DIRECTION.y * along,
        z: ORIGIN.z + DIRECTION.z * along,
      },
      TOLERANCE,
      `tick ${sample * STRIDE}: the pivot, which stands on the track at the ` +
        `trolley's own value ${along.toFixed(4)} from the origin ` +
        "(specs/rigging.md)",
    );
  }

  await h.capture(
    "pivot",
    "The yard with the trolley part-way along the track",
  );

  assertGreaterThan(
    reached,
    1,
    "the distance the trolley covered over the sampled ticks, so the pivot " +
      "was read at many positions along the track rather than at the origin " +
      "alone (specs/rigging.md)",
  );
});
