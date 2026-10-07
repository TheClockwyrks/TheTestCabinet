// Wick — instrumentation/set-gem-attracted: `setGemAttracted(id, true)` on a
// gem 200 units away reads back `attracted` true, and on the next tick the
// gem has flown 10 units toward the lamplighter.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setGemAttracted(id, attracted)`: "Sets gem `id`'s `attracted` to
// `attracted`"; a posed gem "first moves ... on the next tick". `specs/
// world.md`, "Attraction and flight": "An attracted gem moves toward the
// lamplighter's center each tick by `GEM_SPEED × TICK_DT`", 600/60 = 10.
// `MOTION_EPS` on the one step.
//
// THE DRIVE. An isolated run, a medium gem at (200, 0), the pose read at the
// call, one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { GEM_SPEED, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const X = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("attracts the gem and it flies on the next tick", async () => {
  isolate(h);
  const id = placeGem(h, "medium", X, 0);
  h.debug.setGemAttracted(id, true);
  const posed = gemById(h.snapshot(), id);
  assertDefined(posed, "the gem after the pose");
  assertEqual(
    posed?.attracted,
    true,
    "attracted after setGemAttracted(id, true)",
  );
  assertEqual(posed?.x, X, "x at the call");

  const flown = gemById(
    await captureReplay(h, "attracted", () => advanceTicks(h, 1)),
    id,
  );
  assertDefined(flown, "the gem after one tick");
  assertNear(
    flown?.x ?? Number.NaN,
    X - GEM_SPEED * TICK_DT,
    MOTION_EPS,
    "x after one tick of flight",
  );
  assertEqual(flown?.y, 0, "y after one tick of flight");
});
