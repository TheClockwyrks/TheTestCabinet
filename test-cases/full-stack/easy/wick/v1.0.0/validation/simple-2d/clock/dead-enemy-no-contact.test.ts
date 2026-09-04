// Wick — clock/dead-enemy-no-contact: an enemy killed on a tick lands no hit on
// that tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 6, "every projectile and zone hits
//     ... Then an enemy whose `hp` is at or below `0` dies", comes before phase
//     7, "Contact. Every live enemy's `contactCooldown` and the lamplighter's
//     `hurtFlash` count down, and, while `enemyContact` is on, an overlapping
//     enemy whose cooldown is due hits".
//   - `specs/world.md` ("Contact damage"): an enemy's `contactCooldown` "is
//     `0` when the enemy spawns", and "An overlapping enemy whose
//     `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`".
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed Ember bolt's
//     "`damage` is that row's damage times the `damageMul` in force", level 1
//     when Ember is not held, which is `10`; "a posed enemy, projectile ...
//     first hits ... on the next tick".
//   - `specs/enemies.md`: a moth has HP `5`, radius `10`, and damage `5`.
//
// WHAT IS READ. A moth is posed overlapping the lamplighter with its cooldown
// due at spawn and `enemyContact` on, so on the next tick it would hit for 5.
// An Ember bolt is posed on the moth's center, so on that same tick the bolt's
// 10 damage takes the moth's 5 hp to 0 and it dies in phase 6. Phase 7 then
// finds no live moth, and `hp` after the tick must read `BASE_MAX_HP`
// untouched, while the kill count and the moth's absence show the kill did
// happen on that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and one bolt are the whole of the
// order under test. `effectMotion` is off so the bolt holds its place; hits
// still resolve with it off, as the switch table states. `enemyMotion` is off
// so the moth stays where it overlaps. Recovery is `0` with no Tinder, so
// nothing but a hit could change `hp`.
//
// TOLERANCE. None on `hp`: nothing in the tick adds to or removes from it when
// the order is right, so it is the stated `BASE_MAX_HP` exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The moth's offset from the lamplighter: inside 10 + 12, so it overlaps. */
const MOTH_DX = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves hp untouched by a moth the same tick's bolt killed", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "hp before the tick");
  const moth = spawnEnemyNear(h, "moth", MOTH_DX, 0);
  const placed = enemyById(h.snapshot(), moth);
  assertEqual(placed?.contactCooldown, 0, "the moth's cooldown at spawn");
  h.debug.spawnProjectile(
    "ember",
    placed?.x ?? Number.NaN,
    placed?.y ?? Number.NaN,
    0,
    0,
    0,
  );
  enable(h, "enemyContact");

  const after = await h.tick(1);
  captureStill(h, "no-hit");

  assertEqual(enemyById(after, moth), undefined, "the moth after the tick");
  assertEqual(after.run.kills, posed.run.kills + 1, "kills after the tick");
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp after the tick");
});
