// pickups/gem-flight-speed — an attracted gem flies GEM_SPEED toward the
// lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight")
// tables "Flight speed, units per second | `GEM_SPEED` | `600`" and applies it:
// "An attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT`". `TICK_DT` is 1/60, so one tick's step is `GEM_STEP`
// (10) units along the straight line to the lamplighter's center.
// specs/world.md ("One tick", phase 9) fixes which gems take it: "every
// attracted gem that existed before this tick moves", which the posed gem does.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing in
// the night moves but the gem. The gem lies `POSED` (200) units along `+x`,
// far outside `PICKUP_RADIUS` (48), and is latched with `setGemAttracted`, so
// the reading is about flight alone rather than about the radius that starts
// it. `SPAN` (10) ticks leave it 100 units out, well past `COLLECT_RADIUS` (8),
// so every tick of the span is a flight step and none is a collection. The
// lamplighter never moves, so every step points along `−x` and the gem's `y`
// holds.
//
// WHAT IS READ. The gem's position after each of the ten ticks, against
// `POSED − GEM_STEP × n` on the axis it flies along. Reading every tick rather
// than the endpoint alone is what separates a build stepping 10 units a tick
// from one that jumps the whole distance and one that steps a fraction.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each coordinate, the case's allowance
// for a position integrated tick by tick: `GEM_STEP` is exact, and a build
// forming 600 × (1/60) fresh each tick drifts by a few 1e-13 a tick, seven
// orders below what this reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { GEM_STEP, gemOf } from "./night";

/** Where the gem lies: far outside PICKUP_RADIUS, so the latch alone attracts it. */
const POSED = 200;

/** Ticks flown: the gem ends 100 units out, far outside COLLECT_RADIUS. */
const SPAN = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves an attracted gem 10 units toward the lamplighter on every tick", async () => {
  const posed = isolate(h);
  const { player } = posed.run;
  const gem = spawnGemAt(h, "small", player.x + POSED, player.y);
  h.debug.setGemAttracted(gem, true);

  const trace = await captureReplay(h, "flight", () => h.trace(SPAN));

  trace.forEach((snapshot, index) => {
    const flown = index + 1;
    const seen = gemOf(snapshot, gem);
    assertWithin(
      seen.x,
      player.x + POSED - GEM_STEP * flown,
      MOTION_TOLERANCE,
      `the gem's x after ${flown} of ${SPAN} flight ticks, in units`,
    );
    assertWithin(
      seen.y,
      player.y,
      MOTION_TOLERANCE,
      `the gem's y after ${flown} of ${SPAN} flight ticks, in units`,
    );
  });
});
