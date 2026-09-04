// Wick — passives/lure-attracts-on-first-tick-inside: a gem outside the base
// radius is attracted on the first tick a Lure level brings it inside.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Pickup radius"): "The
// attraction rule in `specs/world.md` reads this radius on every tick, so a gem
// that was outside the base radius is picked up on the first tick Lure brings
// it inside", over "the radius within which a gem becomes attracted is
// `PICKUP_RADIUS` (`48`) times `pickupMul`" and
// "`pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure`" with `LURE_PICKUP_PER_LEVEL`
// (`0.25`). `specs/world.md` ("Attraction and flight"): "On every tick, a gem
// whose center is at most `pickupRadius` from the lamplighter's center becomes
// attracted". A gem `GEM` (`55`) units out is outside the base `48` and inside
// the `60` a single Lure level gives, so it stays unattracted while none is
// held and is attracted on the first tick after Lure 1 is placed.
//
// THE POSE. An isolated night with no passive held and one small gem posed `55`
// units along `+x` through `spawnGem`, which places it "unattracted". `WAIT`
// (`10`) ticks run first, so a build reading the base radius has every chance
// to attract it; then Lure 1 is placed through `setPassive` and exactly one
// tick runs. Every faculty stays held, the lamplighter stands at the origin,
// and nothing else is on the field, so the gem is where it was posed on both
// readings.
//
// TOLERANCE. None: the flag is set or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  gemById,
  holdPassive,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** The Lure level gained: `pickupRadius` `60`. */
const LURE_LEVEL = 1;

/** How far along `+x` the gem is posed: outside 48, inside 60. */
const GEM = 55;

/** The ticks run before Lure is placed. */
const WAIT = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a gem 55 units out unattracted with no Lure, and attracts it the tick after Lure 1", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + GEM, at.y);
  assertEqual(gem.attracted, false, "the gem's attracted flag as posed");

  const waited = await h.step(WAIT);
  assertEqual(
    gemById(waited, gem.id)?.attracted,
    false,
    `the attracted flag of a gem ${GEM} units out with no Lure held`,
  );

  await holdPassive(h, "lure", LURE_LEVEL);
  const next = await h.step(1);
  await captureStill(h, "inside");

  assertEqual(
    gemById(next, gem.id)?.attracted,
    true,
    `the attracted flag on the first tick after Lure ${LURE_LEVEL} was placed`,
  );
});
