// clock/accumulator-carries-remainder — the part of a frame shorter than a tick
// waits for the next frame.
//
// WHERE THE THRESHOLD COMES FROM. specs/instrumentation.md ("A deterministic
// core"): "On `playing`, each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame." And of `advance(seconds)`: "on `playing` the delta joins the
// accumulator and every whole `TICK_DT` in it is consumed as a tick, the
// remainder waiting in `accumulator`." specs/overview.md fixes `TICK_DT` at
// `1/60`.
//
// THE TWO FRAMES. A frame of `0.025` s holds one tick (`0.01667` s) and leaves
// `0.025 − TICK_DT`, which is `0.00833` s. A following frame of `0.01` s is
// short of a tick on its own, but joined to the waiting remainder it makes
// `0.01833` s, one tick and a new remainder of `0.035 − 2 × TICK_DT`. So the
// first frame moves the clock by one, the second by one more, and the
// accumulator reads each remainder in turn. A build that discards a remainder
// leaves the clock at one after the second frame; a build that consumes a
// tick early leaves it at two after the first.
//
// THE NIGHT. An isolated run with every faculty held and nothing in it: the
// requirement is about the accumulator alone, and `run.tick` and
// `accumulator` are what is read.
//
// THE TOLERANCE. `ACCUMULATOR_TOL`, the `1e-9` the specification itself
// reads a remainder at: `0.025 − 1/60` differs by a few `1e-18` between a
// build that subtracts and one that keeps a running sum, and the figure that
// separates a carried remainder from a discarded one is `0.00833`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ACCUMULATOR_TOL, TICK_DT } from "../constants";
import {
  advanceBy,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The first frame: one tick and a remainder. */
const FIRST_FRAME = 0.025;

/** The second frame: short of a tick alone, a tick with the remainder. */
const SECOND_FRAME = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the remainder of one frame into the next", async () => {
  const posed = await isolate(h);
  const first = await advanceBy(h, FIRST_FRAME);
  const second = await advanceBy(h, SECOND_FRAME);
  await captureStill(h, "remainder");

  assertEqual(
    first.run.tick,
    posed.run.tick + 1,
    "run.tick after one frame of 0.025 s",
  );
  assertNear(
    first.accumulator,
    FIRST_FRAME - TICK_DT,
    ACCUMULATOR_TOL,
    "accumulator after one frame of 0.025 s",
  );
  assertEqual(
    second.run.tick,
    posed.run.tick + 2,
    "run.tick after a following frame of 0.01 s",
  );
  assertNear(
    second.accumulator,
    FIRST_FRAME + SECOND_FRAME - 2 * TICK_DT,
    ACCUMULATOR_TOL,
    "accumulator after the following frame of 0.01 s",
  );
});
