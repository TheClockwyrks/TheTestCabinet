// instrumentation/set-axis-takes-any-value-the-axis-can-hold — `setAxis` takes any
// value the axis can hold.
//
// `specs/instrumentation.md` § The run in progress: "`setAxis` takes any value the
// axis can hold. The ranges in `specs/program.md` are what a step's target is judged
// against when the step starts, not a bound on the axis itself." So the hoist's range
// of `HOIST_MIN` (`1`) to `HOIST_MAX` (`40`) governs a tape's command and not this
// pose, and the slew's value "is a plain number rather than a wrapped one, so `360` is
// a full turn past `0`" (`specs/program.md`).
//
// THREE VALUES, ONE PER WAY A BUILD MIGHT BOUND AN AXIS: `55` is past the hoist's
// upper range, `0.5` is below its lower one, and `400` is a slew past a full turn — a
// build that clamped to the range reads back `40` and `1`, and one that wrapped the
// slew reads back `40`. Each is read straight back, so the reading is the pose's and
// no controller has run.
//
// AND THE RUN DOES NOT END FOR IT. `command-out-of-range` is the tape's verdict on a
// step's target (`specs/program.md`), and no step here carries one of these values, so
// the run is still `running` with no cause after each pose — which is the same
// guardrail from the other side: "none of them reaches a verdict".
//
// Nothing is advanced: what the ticks after such a pose do is the run's own business
// and belongs to the rules that own it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type AxisName,
} from "../harness";

/** Above HOIST_MAX (40), below HOIST_MIN (1), and past a full turn of the slew. */
const POSES: readonly [AxisName, number][] = [
  ["hoist", 55],
  ["hoist", 0.5],
  ["slew", 400],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a value outside the axis's step range and reads it back unchanged", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);

  for (const [axis, value] of POSES) {
    await h.debug.setAxis(axis, value);
    const { run } = await h.snapshot();
    assertEqual(
      run.axes[axis].value,
      value,
      `the ${axis}'s value after setAxis(${value}): the ranges in ` +
        "specs/program.md bound a step's target, not the axis " +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      run.phase,
      "running",
      `the run after setAxis("${axis}", ${value}): a pose reaches no verdict`,
    );
    assertNull(run.cause, `the cause after setAxis("${axis}", ${value})`);
  }

  await h.capture("state", "the run carrying the three values that were posed");
});
