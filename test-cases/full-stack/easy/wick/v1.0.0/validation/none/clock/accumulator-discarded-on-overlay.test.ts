// clock/accumulator-discarded-on-overlay — the tick that opens an overlay is
// the last its frame runs, and the remainder is discarded.
//
// WHERE THE THRESHOLD COMES FROM. specs/instrumentation.md ("A deterministic
// core"): "A tick that leaves `playing`, by opening an overlay or ending the
// run, is the last tick its frame runs, and the remainder is discarded". Of
// `advance`: "A tick that opens an overlay or ends the run is the last the
// frame runs and the remainder is discarded." And of `setPendingLevelUps`: "A
// `playing` tick that ends with it above `0` opens the overlay exactly as a
// gain does." specs/progression.md: "A `playing` tick that ends with
// `pendingLevelUps` above `0` runs to completion and then opens the overlay:
// `screen` becomes `levelup`".
//
// THE FRAME. `0.025` s holds one tick and `0.00833` s over. With a level-up
// queued, that one tick opens the overlay, so the frame runs exactly one tick
// and the `0.00833` s is dropped: `screen` reads `levelup`, `run.tick` is one
// higher, and `accumulator` is `0`. A build that kept the remainder reads
// `0.00833`; one that ran the accumulator on past the overlay would have
// nothing left to run but shows the same remainder.
//
// THE NIGHT. An isolated run with every faculty held and nothing in it; the
// overlay opens over an empty world, which is all the requirement needs.
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

it("discards the remainder on the tick that opens the level-up overlay", async () => {
  const posed = await isolate(h);
  await h.debug.setPendingLevelUps(1);
  const opened = await advanceBy(h, FRAME);
  await captureStill(h, "discarded");

  assertEqual(
    opened.screen,
    "levelup",
    "the screen after a frame of 0.025 s with a level-up queued",
  );
  assertEqual(
    opened.run.tick,
    posed.run.tick + 1,
    "run.tick after the frame: the one tick that opened the overlay",
  );
  assertNear(
    opened.accumulator,
    0,
    ACCUMULATOR_TOL,
    "accumulator on levelup, the remainder discarded",
  );
});
