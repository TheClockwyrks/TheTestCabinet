// hurt/flash-not-armed-without-damage — a tick landing no contact hit arms
// nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): the
// lamplighter's `hurtFlash` "is set to `HURT_FLASH` on every tick on which a
// contact hit lands", and "a contact hit is the only thing that sets it". A hit
// is landed by an overlapping enemy alone: "the enemy's circle overlaps the
// lamplighter's when the distance between their centers is less than the enemy's
// radius plus `PLAYER_RADIUS`". So a night whose only enemy stands outside that
// distance lands no hit, and the timer stays at the `0` specs/ui.md ("A fresh
// run") starts it at.
//
// THE DRIVE. The category's isolated night with `enemyContact` on — the switch
// that would let a hit land is the one left on, so the reading is about the
// overlap and not about a faculty being held — and a rat posed 200 units from
// the lamplighter's center, far outside the 24 its radius 12 and
// `PLAYER_RADIUS` 12 add to. `enemyMotion` is held, so the rat never closes the
// distance, and ten ticks are run.
//
// THE TOLERANCE. `TIMER_TOL` (`1e-6`): the timer is never set, so a conformant
// build reads 0 outright, and the allowance covers only a build that arrives
// there by arithmetic of its own. A build that armed the flash on a tick that
// landed no hit reads 0.3, five orders outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { AWAY_OFFSET, HITTER, flashOf, poseNight } from "./flash";

/** Ticks run with nothing overlapping the lamplighter. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves hurtFlash 0 over ten ticks with no enemy overlapping", async () => {
  const posed = await poseNight(h);
  assertNear(
    flashOf(posed),
    0,
    TIMER_TOL,
    "run.hurtFlash on the night the ticks start from",
  );
  await placeEnemyNear(h, HITTER, AWAY_OFFSET, 0);

  const after = await h.step(TICKS);

  // The view with the rat out of reach. Captured before the assertion, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "unarmed");

  assertEqual(
    after.run.player.hp,
    posed.run.player.hp,
    `the lamplighter's health over ${TICKS} ticks with nothing overlapping it`,
  );
  assertNear(
    flashOf(after),
    0,
    TIMER_TOL,
    `run.hurtFlash after ${TICKS} ticks landing no contact hit`,
  );
});
