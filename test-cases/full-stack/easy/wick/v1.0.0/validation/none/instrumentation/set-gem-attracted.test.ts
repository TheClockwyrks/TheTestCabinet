// Wick — instrumentation/set-gem-attracted: `setGemAttracted(id, true)` on a
// gem 200 units away reads back `attracted` `true`, and on the next tick the
// gem has flown 10 units toward the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setGemAttracted(id, attracted)`): "Sets gem `id`'s `attracted` to
// `attracted`, a boolean". specs/world.md — "Attraction and flight": "An
// attracted gem moves toward the lamplighter's center each tick by `GEM_SPEED
// × TICK_DT`", 600/60 = 10 units; phase 9: "every attracted gem that existed
// before this tick moves". The step is read to `POSITION_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. The gem is 200 units out, past the 48-unit
// pickup radius, so its attraction is the pose's alone; the lamplighter
// stands at the origin, so the flight is straight along `-x`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GEM_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const AT = { x: 200, y: 0 };

/** Frames of flight recorded after the first step. */
const FLIGHT_FRAMES = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips a gem's attraction, and it flies on the next tick", async () => {
  await isolate(h);
  const gem = await placeGem(h, "medium", AT.x, AT.y);
  assertEqual(gem.attracted, false, "the gem's attraction at the pose");

  await h.debug.setGemAttracted(gem.id, true);
  const attracted = gemById(await h.snapshot(), gem.id);
  assertEqual(attracted?.attracted, true, "the gem's attraction after the pose");

  const first = await captureReplay(h, "attracted", async () => {
    const stepped = await h.step(1);
    await h.step(FLIGHT_FRAMES);
    return stepped;
  });
  const flown = gemById(first, gem.id);
  assertNear(flown?.x ?? NaN, AT.x - GEM_STEP, POSITION_TOL, "the gem's x after one tick of flight");
  assertNear(flown?.y ?? NaN, AT.y, POSITION_TOL, "the gem's y after one tick of flight");
});
