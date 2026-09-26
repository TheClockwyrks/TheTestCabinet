// pickups/gem-flight-speed — an attracted gem flies GEM_SPEED toward the
// lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Attraction and flight")
// fixes "| Flight speed, units per second | `GEM_SPEED` | `600` |" and applies
// it: "An attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT`". `TICK_DT` is `1 / 60`, so one tick's step is
// `GEM_STEP` (`10`) units along the straight line to the lamplighter's center.
// Phase 9 of "One tick" fixes which gems take it: "every attracted gem that
// existed before this tick moves", which the posed gem does.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so nothing moves in
// the night but the gem and no Lure or draft changes what is attracted. The gem
// is posed `POSED_DISTANCE` (`200`) units along `+x` and latched with
// `setGemAttracted`, so the reading is about the flight alone rather than about
// the radius that starts it: `200` is far outside `PICKUP_RADIUS` (`48`), and a
// gem once attracted stays attracted. `FLIGHT_TICKS` (`10`) leaves the gem
// `100` units out, far beyond `COLLECT_RADIUS` (`8`), so every tick of the span
// is a flight step and none is a collection. No key is pressed, so the
// lamplighter holds the origin and every step points along `−x`.
//
// THE TOLERANCE. `MOTION_EPS` (`1e-6`) on each tick's position, the suite's
// allowance for a figure integrated tick after tick: `GEM_STEP` is exact, and a
// build that multiplies `600` by an inexact `1 / 60` every tick drifts by a few
// `1e-13` a tick, orders below what this reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { GEM_SPEED, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** One tick's flight: `GEM_SPEED × TICK_DT` = `10` units. */
const GEM_STEP = GEM_SPEED * TICK_DT;

/** Far outside `PICKUP_RADIUS`, so the flight is read on the latch alone. */
const POSED_DISTANCE = 200;

/** Ticks flown: the gem ends `100` units out, far outside `COLLECT_RADIUS`. */
const FLIGHT_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves an attracted gem 10 units toward the lamplighter on every tick", async () => {
  const opened = isolate(h);
  const at = opened.run.player;
  const id = placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  h.debug.setGemAttracted(id, true);

  const ticks = await captureReplay(h, "flight", async () => {
    const trace: WickSnapshot[] = [];
    for (let tick = 0; tick < FLIGHT_TICKS; tick += 1) {
      trace.push(await advanceTicks(h, 1));
    }
    return trace;
  });

  ticks.forEach((tick, index) => {
    const seen = gemById(tick, id);
    assertDefined(seen, `the gem on tick ${index + 1} of the flight`);
    assertNear(
      seen?.x ?? NaN,
      at.x + POSED_DISTANCE - GEM_STEP * (index + 1),
      MOTION_EPS,
      `the gem's x on tick ${index + 1} of the flight, in units (specs/world.md, Attraction and flight)`,
    );
    assertNear(
      seen?.y ?? NaN,
      at.y,
      MOTION_EPS,
      `the gem's y on tick ${index + 1} of the flight, in units`,
    );
  });
});
