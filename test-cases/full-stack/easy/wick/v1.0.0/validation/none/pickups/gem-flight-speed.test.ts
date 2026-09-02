// pickups/gem-flight-speed — an attracted gem flies GEM_SPEED toward the
// lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight")
// fixes "Flight speed, units per second | `GEM_SPEED` | `600`" and applies it:
// "An attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT`". `TICK_DT` is `1/60`, so one tick's step is `GEM_STEP`
// (`10`) units along the straight line to the lamplighter's center. Phase 9 of
// "One tick" fixes which gems take it: "every attracted gem that existed before
// this tick moves", which the posed gem does.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so nothing moves in the
// night but the gem, and no Lure or draft changes what is attracted. The gem is
// posed `POSED_DISTANCE` (`200`) units along `+x` and latched with
// `setGemAttracted`, so the reading is about flight alone rather than about the
// radius that starts it: `200` is far outside `PICKUP_RADIUS` (`48`), and a gem
// once attracted stays attracted. `FLIGHT_TICKS` (`10`) leaves the gem `100`
// units out, well beyond `COLLECT_RADIUS` (`8`), so every tick of the span is a
// flight step and none is a collection. No key is pressed, so the lamplighter
// holds the origin and every step points along `-x`.
//
// THE TOLERANCE. `POSITION_TOL` (`1e-6`) on each tick's position, the case's
// allowance for a position integrated over ticks: `GEM_STEP` is exact, but a
// build that multiplies `600` by an inexact `1/60` each tick drifts by a few
// `1e-13` a tick, four orders below what this reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { GEM_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** Far outside `PICKUP_RADIUS`, so the flight is read on the latch alone. */
const POSED_DISTANCE = 200;

/** Ticks flown: the gem ends `100` units out, far outside `COLLECT_RADIUS`. */
const FLIGHT_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves an attracted gem GEM_STEP units toward the lamplighter on every tick", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  await h.debug.setGemAttracted(gem.id, true);

  const ticks = await captureReplay(h, "flight", () =>
    h.stepWatching(FLIGHT_TICKS),
  );

  ticks.forEach((tick, i) => {
    const seen = gemById(tick, gem.id);
    assertDefined(seen, `the gem on tick ${i + 1} of the flight`);
    assertNear(
      seen!.x,
      at.x + POSED_DISTANCE - GEM_STEP * (i + 1),
      POSITION_TOL,
      `the gem's x on tick ${i + 1} of the flight, in units`,
    );
    assertNear(
      seen!.y,
      at.y,
      POSITION_TOL,
      `the gem's y on tick ${i + 1} of the flight, in units`,
    );
  });
});
