// tape/controller-brake-boundary — the brake test is an inclusive one, so a tick
// that finds exactly its stopping distance left brakes.
//
// `specs/program.md` § Axis motion: "if `v * s > 0` and `|d| <= v * v / (2 * a)`,
// brake, `v = v - s * a * dt`; otherwise drive". The bound is `<=`, so the tick
// on which the distance left EQUALS the stopping distance is a braking tick, and
// a build that wrote `<` there drives instead.
//
// THE BOUNDARY IS POSED EXACTLY, in figures rather than by driving up to it. A
// rate of `3` is posed onto the hoist before its first tick, so its stopping
// distance `v * v / (2 * a)` is `9 / 12`, exactly `0.75`; the hoist starts every
// run at `HOIST_START` (`2`) and the step targets `2.75`, so the distance to go on
// that tick is exactly `0.75` as well. The two sides of the test are the same
// number, in floating point as well as in arithmetic, which is what makes this the
// boundary rather than a reading near it.
//
// `setAxisRate` is what poses it: it "sets an axis's signed rate, leaving its
// value and its command as they are" (`specs/instrumentation.md`), and the axis
// it is posed onto takes its command on the very tick that follows, from the tape
// stage that runs before the axis motion (`specs/program.md` § The tick
// pipeline). The posed rate sits inside the axis's `HOIST_MAX_RATE` of `4`, which
// is the range the specs allow a hoist rate, and the two branches still answer
// apart — braking leaves `3 - HOIST_ACCEL / TICK_HZ = 2.9`, driving leaves `3.1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import {
  HOIST_ACCEL,
  HOIST_MAX_RATE,
  HOIST_START,
  TICK_HZ,
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The rate posed onto the hoist before its first tick. */
const POSED_RATE = 3;

/** Its stopping distance, `v * v / (2 * a)`: exactly `0.75`. */
const STOPPING = (POSED_RATE * POSED_RATE) / (2 * HOIST_ACCEL);

/** The target that leaves exactly that distance to go on the first tick. */
const TARGET = HOIST_START + STOPPING;

/** The tape: one hoist command, issued on the tick the reading is taken on. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: TARGET, rate: HOIST_MAX_RATE }],
  },
];

/** What the brake branch leaves: `v - s * a * dt`, with no clamp. */
const BRAKED = POSED_RATE - HOIST_ACCEL / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brakes on the tick the distance left equals the stopping distance", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setAxisRate("hoist", POSED_RATE);
  const braked = await runTicks(h, 1);

  await h.capture("state", "The hoist a tick after the brake boundary");

  assertClose(
    braked.run.axes.hoist.rate,
    BRAKED,
    1e-9,
    `run.axes.hoist.rate on a tick with ${STOPPING} to go at a rate of ` +
      `${POSED_RATE}, whose stopping distance is exactly ${STOPPING}: the ` +
      "brake branch, since |d| <= v * v / (2 * a) (specs/program.md)",
  );
});
