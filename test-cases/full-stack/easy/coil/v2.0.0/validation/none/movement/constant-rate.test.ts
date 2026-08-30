// movement/constant-rate — one second of game time is exactly eight ticks.
//
// specs/movement.md: "The simulation advances in whole ticks of `TICK_SECONDS`
// (`0.125`), which is eight ticks per second", and "a second of game time is
// eight ticks whether the runtime delivered it in one update or in sixty". So the
// figure is exact rather than approximate, and both witnesses are read: the
// game's own tick counter, and the eight cells of travel that counter is supposed
// to mean.
//
// The second is delivered on the harness's clock, which is `FRAME_HZ` updates of
// `1 / FRAME_HZ` of a second — every one of them an exactly representable binary
// fraction, so the second the build accumulates is a second and the reading does
// not turn on the last bit of a repeating decimal.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { TICKS_PER_SECOND, type Cell } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  FRAME_HZ,
  type Harness,
} from "../harness";

/** Where the chain is posed: a clear run of far more than eight cells to its right. */
const HEAD: Cell = { col: 5, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resolves eight ticks, and eight cells of travel, in one second", async () => {
  const posed = await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertEqual(posed.snapshot.ticks, 0, "ticks before the second");

  const after = await captureReplay(h, "rate", async () => {
    await h.advance(FRAME_HZ);
    return h.snapshot();
  });

  assertEqual(after.ticks, TICKS_PER_SECOND, "ticks in one second of game time");
  assertCloseTo(after.simTime, 1, 6, "the second of game time delivered");
  assertDeepEqual(
    after.snake[0],
    ahead(HEAD, "right", TICKS_PER_SECOND),
    "the head after one second",
  );
});
