// pickups/gem-stays-attracted — a gem once attracted stays attracted, however
// far the lamplighter goes.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "a
// gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted, and a gem once attracted stays attracted", followed by "An
// attracted gem moves toward the lamplighter's center each tick". So attraction
// is a latch rather than a test re-applied every tick: a gem attracted at
// `NEAR_DISTANCE` (`40`), inside `PICKUP_RADIUS` (`48`), still reads `attracted`
// `true` once the lamplighter stands `FAR_DISTANCE` (`500`) units off, far
// outside the radius, and it goes on flying toward the lamplighter's new
// center. A build that recomputes the flag each tick drops it on the first tick
// after the move and the gem stops.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure widens the
// radius and no draft re-attracts the gem behind the check's back. The gem is
// attracted the real way, by one tick with the lamplighter inside the radius,
// rather than by `setGemAttracted`, because the latch this check reads is the
// one the game set. The lamplighter is then posed with `setPlayerPosition`,
// which "Sets the lamplighter's center to `(x, y)`. Nothing else moves"
// (specs/instrumentation.md), so the only thing that changed between the two
// halves is the distance.
//
// THE TOLERANCE. None on `attracted`, a boolean. The flight is read as a
// distance that strictly fell on every tick, with no figure of its own; the
// per-tick step is `pickups/gem-flight-speed`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLessThan } from "../assert";
import { PICKUP_RADIUS } from "../constants";
import {
  captureReplay,
  createHarness,
  distanceBetween,
  gemById,
  isolate,
  placeGem,
  player,
  type Harness,
} from "../harness";

/** Inside `PICKUP_RADIUS` (`48`), so one tick attracts the gem. */
const NEAR_DISTANCE = 40;

/** Where the lamplighter is posed afterwards: ten times the radius away. */
const FAR_DISTANCE = 500;

/** Ticks flown from out there, enough for a dropped latch to show as a stopped gem. */
const FLIGHT_TICKS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a gem attracted and flying after the lamplighter is posed 500 units away", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const posed = await placeGem(h, "small", at.x + NEAR_DISTANCE, at.y);
  assertEqual(posed.attracted, false, "the posed gem's attracted flag");

  const attracted = await h.step(1);
  const caught = gemById(attracted, posed.id);
  assertDefined(caught, "the gem after the tick that attracted it");
  assertEqual(
    caught!.attracted,
    true,
    `the attracted flag of a gem ${NEAR_DISTANCE} units out, inside ${PICKUP_RADIUS}`,
  );

  await h.debug.setPlayerPosition(caught!.x, caught!.y + FAR_DISTANCE);
  const ticks = await captureReplay(h, "stays", () =>
    h.stepWatching(FLIGHT_TICKS),
  );

  let last = FAR_DISTANCE;
  ticks.forEach((tick, i) => {
    const seen = gemById(tick, posed.id);
    assertDefined(seen, `the gem on tick ${i + 1} out at range`);
    assertEqual(
      seen!.attracted,
      true,
      `the attracted flag on tick ${i + 1} with the lamplighter ${FAR_DISTANCE} units off`,
    );
    const distance = distanceBetween(seen!, player(tick));
    assertLessThan(
      distance,
      last,
      `the gem's distance to the lamplighter on tick ${i + 1}, in units`,
    );
    last = distance;
  });
});
