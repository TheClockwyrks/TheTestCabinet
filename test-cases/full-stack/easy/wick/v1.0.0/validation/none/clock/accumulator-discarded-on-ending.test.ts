// clock/accumulator-discarded-on-ending — the tick that ends the run is the
// last its frame runs, and the remainder is discarded.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "A run
// ends at the end of a tick, after every other phase of that tick has been
// applied", fallen when "`hp` is `0` or below", and "The delta time left
// unconsumed by the frame that ended the run is discarded, so the accumulator
// is `0` on an end screen as on every screen but `playing`."
// specs/instrumentation.md, of `advance`: "A tick that opens an overlay or
// ends the run is the last the frame runs and the remainder is discarded";
// and of `setHp`: "A value at or below `0` ends the run fallen at the end of
// the next `playing` tick".
//
// THE FRAME. `0.025` s holds one tick and `0.00833` s over. With `hp` posed
// to `0`, that one tick ends the run, so the frame runs exactly one tick and
// the `0.00833` s is dropped: `screen` reads `fallen`, `run.tick` is one
// higher, and `accumulator` is `0`. A build that kept the remainder reads
// `0.00833`.
//
// THE NIGHT. An isolated run with every faculty held and nothing in it; the
// ending comes from the posed `hp` and the tick alone.
//
// THE TOLERANCE. `ACCUMULATOR_TOL`, the `1e-9` the specification reads a
// remainder at, so a remainder the rule calls `0` is read as `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ACCUMULATOR_TOL } from "../constants";
import {
  advanceBy,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** One tick and a remainder. */
const FRAME = 0.025;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards the remainder on the tick that ends the run", async () => {
  const posed = await isolate(h);
  await h.debug.setHp(0);
  const ended = await advanceBy(h, FRAME);
  await captureStill(h, "discarded");

  assertEqual(
    ended.screen,
    "fallen",
    "the screen after a frame of 0.025 s with hp at 0",
  );
  assertEqual(
    ended.run.tick,
    posed.run.tick + 1,
    "run.tick after the frame: the one tick that ended the run",
  );
  assertNear(
    ended.accumulator,
    0,
    ACCUMULATOR_TOL,
    "accumulator on fallen, the remainder discarded",
  );
});
