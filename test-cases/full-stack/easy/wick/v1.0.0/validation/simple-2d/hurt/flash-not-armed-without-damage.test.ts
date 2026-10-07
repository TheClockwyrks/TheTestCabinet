// hurt/flash-not-armed-without-damage — a tick that lands no contact hit leaves
// the hurt flash where it was.
//
// THE RULE, FROM THE SPEC. specs/world.md ("Contact damage"): the lamplighter's
// `hurtFlash` "is set to `HURT_FLASH` on every tick on which a contact hit
// lands", and "a contact hit is the only thing that sets it, so a heal from any
// source leaves it as it was". A hit is landed by an overlapping enemy, and
// "the enemy's circle overlaps the lamplighter's when the distance between
// their centers is less than the enemy's radius plus `PLAYER_RADIUS`", so an
// enemy further off than that sum lands none and the flash stays at the `0` the
// fresh run carries.
//
// THE POSE. An isolated night with `enemyContact` the only switch on and one
// rat posed 200 units along +x, well outside the 24 its radius 12 and
// PLAYER_RADIUS sum to. The faculty is left ON rather than the field left
// empty, so what the ten ticks decide is that the rule found no overlap, not
// that the rule was held: a build that arms the flash on every tick it runs
// contact fails here.
//
// WHY THE RAT HOLDS ITS DISTANCE. `enemyMotion` is off, so the rat stays at the
// offset it was posed at for every one of the ten ticks and never closes on the
// lamplighter, whatever a build's chase rule would otherwise do with it.
//
// WHAT IS READ. `run.hurtFlash` after the ten ticks, with the hp those ticks
// left read as the premise that no hit landed on any of them: recovery is 0
// with no Tinder held, so hp is the fresh run's 100 exactly when nothing hit.
//
// THE TOLERANCE. None on the flash: `0` is exact, both as the value the fresh
// run carries and as the value the count-down holds a spent timer at.
// FIGURE_TOLERANCE on the hp, a stated figure read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { BASE_MAX_HP, FIGURE_TOLERANCE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { CLEAR_OFFSET, CONTACT_DISTANCE, poseNight, spawnHitter } from "./hurt";

/** How many ticks run with nothing in reach. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves hurtFlash 0 across ten ticks with the rat out of reach", async () => {
  const posed = poseNight(h);
  assertEqual(posed.run.hurtFlash, 0, "hurtFlash on the fresh run");
  spawnHitter(h, CLEAR_OFFSET);
  // The pose stands outside the overlap the rule requires.
  assertGreaterThan(
    CLEAR_OFFSET,
    CONTACT_DISTANCE,
    "the posed distance against the radii's sum",
  );

  const after = await h.tick(TICKS);
  captureStill(h, "unarmed");

  assertWithin(
    after.run.player.hp,
    BASE_MAX_HP,
    FIGURE_TOLERANCE,
    `hp after ${TICKS} ticks, the premise that no contact hit landed`,
  );
  assertEqual(
    after.run.hurtFlash,
    0,
    `hurtFlash after ${TICKS} ticks landing no contact hit`,
  );
});
