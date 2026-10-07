// Wick — taper/slash: what the Taper checks share. CASE-PROVIDED.
//
// Every check in this directory poses an isolated run, holds Taper at the
// level its row names, arms it, and runs the one tick it fires on. What it
// then reads is either the slash zones that tick created or what the slash
// did to a moth it was posed against, and both readings are spelled here once
// so each check is the pose, the tick, and its own assertions.
//
// HOW A HIT IS READ. `specs/weapons.md` ("Hits and death"): "A hit removes
// the shape's damage per hit from the enemy's `hp`", and "On any tick an
// enemy's `hp` is at or below `0` after the hits the enemy dies on that
// tick". A moth has 5 hp (`specs/enemies.md`) and every Taper row deals at
// least 10, so a moth the slash reaches dies on the firing tick and is gone
// from `enemies`; a build that lowered its `hp` without removing it has
// landed the hit all the same, and whether a dead enemy is removed is the
// death checks' point, not a geometry check's. A moth the slash did not reach
// keeps exactly the `hp` it was posed with: `enemyMotion`, `enemyContact`,
// and `despawning` are off in every isolated run, so nothing but the slash
// can touch it and nothing can remove it.

import { REAL_EPS } from "../constants";
import {
  armWeapon,
  enemyById,
  holdWeapon,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** What the firing tick did to a posed enemy. */
export type EnemyOutcome = "hit" | "untouched";

/**
 * Hold Taper at `level` in the first free weapon slot and make it fire on the
 * next tick: its timer at `0` and `weaponFire` on. The slot it took.
 */
export function armTaper(h: Harness, level: number): number {
  const slot = holdWeapon(h, "taper", level);
  armWeapon(h, slot);
  return slot;
}

/**
 * Whether the tick that ran hit enemy `id`, whose `hp` read `hpBefore` before
 * it: `"hit"` when the enemy is gone or its `hp` fell, `"untouched"` when it
 * is still there at the `hp` it was posed with.
 */
export function enemyOutcome(
  after: WickSnapshot,
  id: number,
  hpBefore: number,
): EnemyOutcome {
  const enemy = enemyById(after, id);
  if (enemy === undefined) return "hit";
  return enemy.hp < hpBefore - REAL_EPS ? "hit" : "untouched";
}

/** The `hp` enemy `id` holds in `s`; a missing enemy fails the check. */
export function hpOf(s: WickSnapshot, id: number): number {
  const enemy = enemyById(s, id);
  if (enemy === undefined) {
    throw new Error(`Expected: a live enemy with id ${id}\nActual: none`);
  }
  return enemy.hp;
}
