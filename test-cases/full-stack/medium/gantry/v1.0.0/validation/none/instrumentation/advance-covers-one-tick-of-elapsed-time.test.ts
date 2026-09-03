// instrumentation/advance-covers-one-tick-of-elapsed-time — each advanced frame
// covers one tick's worth of elapsed time.
//
// `specs/instrumentation.md` § The clock: "`advance(ticks)` | Runs `ticks` whole
// frames, immediately and in order, each covering `1 / TICK_HZ` seconds of
// elapsed time and each followed by a render." What that elapsed time reaches is
// fixed by `specs/state.md`: "`simTime`, accumulating every update's delta time
// in seconds, whatever the screen", and the snapshot repeats it — "`simTime`
// accumulates every update's delta time whatever the screen". So `TICK_HZ`
// frames raise `simTime` by exactly one second, and that is the reading the
// requirement is decided on.
//
// OFF THE RUN SCREEN, DELIBERATELY. "Off the run screen nothing ticks, and the
// frame is still real": the frame's own length is what this decides, not what
// the run's pipeline does with it, so the check stands on the build screen where
// no run is in progress and nothing but the clock can move. The watch speed,
// which scales what a frame covers during a run, cannot reach it there either.
//
// The world is emptied first, so nothing stands in it that a frame could act on.
//
// The tolerance is one part in a million of the second measured: `1 / TICK_HZ`
// is not exact in binary, so sixty of them summed land a few ulps either side of
// `1`, and no build can do better than its own arithmetic.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** One second of elapsed time, in frames. */
const FRAMES = TICK_HZ;

/** A second of accumulated deltas, to a millionth. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises simTime by one second across TICK_HZ frames", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "build",
    "the screen the check stands on, where nothing ticks but the clock",
  );

  await h.advance(FRAMES);
  const after = await h.snapshot();

  await h.capture("clock", "The build screen the frames were advanced on");

  assertEqual(
    after.run.phase,
    "idle",
    "the run across the frames: off the run screen nothing ticks " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    after.simTime - before.simTime,
    FRAMES / TICK_HZ,
    TOLERANCE,
    `the seconds simTime accumulated across ${FRAMES} frames, each covering ` +
      "1 / TICK_HZ seconds of elapsed time (specs/instrumentation.md)",
  );
});
