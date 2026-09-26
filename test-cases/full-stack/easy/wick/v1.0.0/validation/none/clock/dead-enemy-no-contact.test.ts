// clock/dead-enemy-no-contact — an enemy killed on a tick lands no contact
// hit on that tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick"): phase 6 ends
// with "Then an enemy whose `hp` is at or below `0` dies", and phase 7 is
// "Contact. Every live enemy's `contactCooldown` counts down, and, while
// `enemyContact` is on, an overlapping enemy whose cooldown is due hits". A
// dead enemy is not live in phase 7, so it hits nothing. The kill is
// (specs/weapons.md, "Hits and death"): "A hit removes the shape's damage per
// hit from the enemy's `hp` ... On any tick an enemy's `hp` is at or below `0`
// after the hits the enemy dies on that tick: the kill count rises by one".
// The pose is specs/instrumentation.md's: a posed projectile carries "`damage`
// ... that row's damage times the `damageMul` in force at the call", Ember's
// level-1 row giving `10` against a moth's `5`, and "first hits ... on the
// next tick"; a spawned enemy's `contactCooldown` is `0`, due.
//
// THE DRIVE. A moth five units from the lamplighter's center, overlapping it
// (`10` plus `PLAYER_RADIUS` `12`), with its cooldown at `0` and
// `enemyContact` on, so that on the next tick it lands a hit if it is alive
// in phase 7. An Ember bolt posed on the moth's center, standing still, kills
// it in phase 6 of that same tick. After the tick, `kills` is one higher, the
// moth is gone, and `hp` is what it was. A build that resolves contact before
// hits, or lets a dead enemy hit, reads `hp` five lower.
//
// THE NIGHT. An isolated run with the moth and the bolt alone. `enemyMotion`
// and `effectMotion` held, so both stand where they are posed; `enemyContact`
// on, because a hit is what would land if the order were wrong.
//
// THE TOLERANCE. None: `hp` untouched is `hp` unchanged, and a kill is a
// count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";

/** The moth's center, five units right of the lamplighter's: overlapping. */
const MOTH_DX = 5;

/** A bolt that stands still: no velocity, and `effectMotion` held besides. */
const BOLT_VX = 0;
const BOLT_VY = 0;
const BOLT_PIERCE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves hp untouched when the overlapping moth dies on the same tick", async () => {
  const posed = await isolate(h, { on: ["enemyContact"] });
  const moth = await placeEnemyNear(h, "moth", MOTH_DX, 0);
  await placeProjectile(
    h,
    "ember",
    moth.x,
    moth.y,
    BOLT_VX,
    BOLT_VY,
    BOLT_PIERCE,
  );
  const after = await h.step(1);
  await captureStill(h, "no-hit");

  assertEqual(
    moth.contactCooldown,
    0,
    "the moth's contactCooldown at spawn: due",
  );
  assertEqual(
    after.run.kills,
    posed.run.kills + 1,
    "kills after the tick: the bolt's kill resolved",
  );
  assertUndefined(
    enemyById(after, moth.id),
    "the moth after the tick: dead and removed",
  );
  assertEqual(
    after.run.player.hp,
    posed.run.player.hp,
    "hp after the tick: the moth that died in the hits phase landed no contact hit",
  );
});
