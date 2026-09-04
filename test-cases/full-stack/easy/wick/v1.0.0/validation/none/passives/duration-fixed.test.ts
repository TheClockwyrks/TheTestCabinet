// Wick — passives/duration-fixed: a projectile's and a zone's duration is the
// table figure at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("What passives leave as
// written"): "Projectile `speed` and `duration` are used as written for every
// weapon, at every passive level, so a bolt travels the same distance and a
// lantern, puddle, shard, or sconce lasts the same time whatever the passives
// held." `specs/weapons.md` ("Derived stats") says the same in its table:
// "Speed, Pierce, Duration | table value, unchanged", and ("Projectiles and
// pierce") "A projectile's `ttl` is set to its `duration` when it is fired".
// Row 1 of `EMBER_LEVELS` carries duration `2.0` and row 1 of
// `OIL_SPLASH_LEVELS` carries duration `2.5`, so the bolt reads `ttl` `2.0` and
// the puddle `2.5` on the tick they were created.
//
// THE POSE. An isolated night with Glass 5, Oil 5, Wick 5, and Mirror 2 held
// through `setPassive`, every one of the four multipliers a weapon reads at its
// largest, and Ember and Oil Splash held at level 1 and fired by one tick
// together. Ember "needs at least one enemy to fire", so one hound stands `FAR`
// (`5000`) units along `+x`, past every reach. `specs/world.md` (phase 6) has
// only a shape "that existed before this tick" count its `ttl` down, so the
// figures read are the ones the firing set. Every other faculty stays held.
//
// TOLERANCE. `TIMER_TOL` (`1e-6`) on each `ttl`, the case's allowance for a
// count in seconds. A build scaling either by a multiplier held is tenths of a
// second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { fireVolley, placeFarTarget, shapesOf, shotsOf } from "./stage";

/** The level both weapons are held at. */
const LEVEL = 1;

/** Mirror at its max level, which raises Oil Splash's amount by `2`. */
const MIRROR_LEVEL = 2;

/** Every multiplier a weapon reads, at the largest level its passive allows. */
const HELD = [
  { id: "glass", level: 5 },
  { id: "oil", level: 5 },
  { id: "wick", level: 5 },
  { id: "mirror", level: MIRROR_LEVEL },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads ttl 2.0 on a level-1 bolt and 2.5 on a level-1 puddle with every multiplier held", async () => {
  await isolate(h);
  for (const passive of HELD) await holdPassive(h, passive.id, passive.level);
  await placeFarTarget(h, "hound");

  const volley = await fireVolley(h, [
    { id: "ember", level: LEVEL },
    { id: "oil-splash", level: LEVEL },
  ]);
  await captureStill(h, "duration");

  const bolts = shotsOf(volley, "ember");
  assertEqual(bolts.length, 1, "Ember bolts the firing tick created");
  assertNear(
    bolts[0]!.ttl,
    weaponRow("ember", LEVEL).duration ?? NaN,
    TIMER_TOL,
    "the bolt's ttl with every multiplier held",
  );

  // The COUNT is Mirror's requirement rather than this one, so the reading is
  // only that there is a puddle to read a duration off at all.
  const puddles = shapesOf(volley, "oil-splash");
  assertGreaterThan(puddles.length, 0, "puddles the firing tick created");
  for (const puddle of puddles) {
    assertNear(
      puddle.ttl ?? NaN,
      weaponRow("oil-splash", LEVEL).duration ?? NaN,
      TIMER_TOL,
      `puddle ${puddle.id}'s ttl with every multiplier held`,
    );
  }
});
