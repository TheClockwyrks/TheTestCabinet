// pickups/gem-stays-attracted — attraction is a latch: a gem once attracted
// stays attracted however far the lamplighter goes.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "a
// gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted, and a gem once attracted stays attracted", followed by "An
// attracted gem moves toward the lamplighter's center each tick". So the flag
// is set by a distance and never cleared by one: a gem attracted at `NEAR` (40)
// units, inside `PICKUP_RADIUS` (48), still reads `attracted` true with the
// lamplighter standing `FAR` (500) units off, ten times the radius, and it goes
// on closing on the lamplighter's new center. A build that re-derives the flag
// from the distance every tick drops it on the first tick after the move and
// the gem stops.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so no Lure
// widens the radius and no draft re-attracts the gem behind the reading. The
// gem is attracted the real way, by one tick with it inside the radius, rather
// than by `setGemAttracted`, because the latch this reads is the one the game
// itself set. The lamplighter is then moved by `setPlayerPosition`, which
// "Sets the lamplighter's center; nothing else moves"
// (specs/instrumentation.md), so the only thing that changed across the two
// halves is the distance.
//
// WHAT IS READ. On each of the `SPAN` (5) ticks after the move: `attracted`
// still true, and the gem's distance to the lamplighter strictly falling, which
// is the flight the latch keeps alive. The distance is read rather than the
// step, whose figure is `pickups/gem-flight-speed`'s.
//
// TOLERANCE. None on `attracted`, a boolean, and none on a distance that must
// fall: one step is 10 units against a reading of "smaller than the tick
// before".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThan } from "../assert";
import { PICKUP_RADIUS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { distanceToPlayer, gemOf } from "./night";

/** Where the gem is attracted from: 8 units inside PICKUP_RADIUS (48). */
const NEAR = 40;

/** Where the lamplighter is posed afterwards: ten times the radius away. */
const FAR = 500;

/** Ticks flown from out there: a dropped latch shows as a stopped gem at once. */
const SPAN = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a gem attracted and closing after the lamplighter is posed 500 units away", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Lure");
  const { player } = posed.run;
  const gem = spawnGemAt(h, "small", player.x + NEAR, player.y);

  const attracted = await h.tick(1);
  const caught = gemOf(attracted, gem);
  assertEqual(
    caught.attracted,
    true,
    `the attracted flag of a gem ${NEAR} units out, inside ${PICKUP_RADIUS}`,
  );

  h.debug.setPlayerPosition(caught.x, caught.y + FAR);
  let closest = distanceToPlayer(h.snapshot(), caught);

  const trace = await captureReplay(h, "stays", () => h.trace(SPAN));

  trace.forEach((snapshot, index) => {
    const flown = index + 1;
    const seen = gemOf(snapshot, gem);
    assertEqual(
      seen.attracted,
      true,
      `the attracted flag on tick ${flown} with the lamplighter ${FAR} units off`,
    );
    const gap = distanceToPlayer(snapshot, seen);
    assertLessThan(
      gap,
      closest,
      `the gem's distance to the lamplighter on tick ${flown}, in units`,
    );
    closest = gap;
  });
});
