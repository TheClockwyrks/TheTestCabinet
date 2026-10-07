// Wick — flare/burst: what the Flare checks share. CASE-PROVIDED.
//
// Every check in this directory poses an isolated run, holds Flare at the
// level its point names with its timer at `0`, and runs the one tick on which
// it fires. What it then reads is the burst zone that tick created and what
// the burst did to an enemy standing inside it, and both readings are spelled
// here once so each check is the pose, the tick, and its own assertions.
//
// HOW THE BURST IS READ. `specs/state.md` (`ZoneState`) makes a zone's `kind`
// `burst` "for a Flare burst" and its `weapon` "the weapon that produced it",
// so a Flare burst is a zone of kind `burst` whose weapon is `flare`. A check
// that reads the burst reads exactly one such zone and fails when there are
// none or several, since either is a firing fault the check cannot see past.
//
// HOW A HIT IS READ. `specs/weapons.md` ("Flare"): "every enemy within
// `radius` of the player's center takes `damage` on that tick", and ("Hits
// and death") "A hit removes the shape's damage per hit from the enemy's
// `hp`" and "On any tick an enemy's `hp` is at or below `0` after the hits the
// enemy dies on that tick". So an enemy the burst reached is either gone from
// `enemies` or standing at a lower `hp` than it was posed with, and an enemy
// the burst did not reach keeps exactly the `hp` it was posed with:
// `enemyMotion`, `enemyContact`, and `despawning` are off in every isolated
// run and no other shape exists, so nothing else can touch it.
//
// WHERE AN ENEMY STANDS. `INSIDE` (100) units from the lamplighter's center,
// inside every row's radius of 640 by a wide margin and clear of the
// lamplighter's own circle, so the still shows the burst and the enemy apart.
// The rows are read off an owl: `specs/enemies.md` gives it 2000 hp and has
// each elite spawn "with exactly the HP in its row", more than the 500 of row
// 8, so an owl survives every row's burst and its `hp` reads the damage
// removed exactly. `FLARE_IMMUNE` holds `dark` alone, so an owl is hit like
// any other enemy.

import { fail } from "../assert";
import { REAL_EPS } from "../constants";
import {
  armWeapon,
  enemyById,
  holdWeapon,
  type Harness,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";

/** How far from the lamplighter's center a posed enemy stands, inside every row. */
export const INSIDE = 100;

/**
 * Hold Flare at `level` in the first free weapon slot and make it fire on the
 * next tick: its timer at `0` and `weaponFire` on. The slot it took.
 */
export function armFlare(h: Harness, level: number): number {
  const slot = holdWeapon(h, "flare", level);
  armWeapon(h, slot);
  return slot;
}

/** Every zone of kind `burst` whose weapon is `flare`, in id order. */
export function bursts(s: WickSnapshot): SnapshotZone[] {
  return s.run.zones.filter(
    (zone) => zone.kind === "burst" && zone.weapon === "flare",
  );
}

/** The one Flare burst `s` holds; none or several fails the check. */
export function theBurst(s: WickSnapshot): SnapshotZone {
  const found = bursts(s);
  if (found.length !== 1) {
    fail(
      "exactly one zone of kind burst with weapon flare (specs/weapons.md, Flare)",
      found.length,
    );
  }
  return found[0];
}

/** The `hp` enemy `id` holds in `s`; a missing enemy fails the check. */
export function hpOf(s: WickSnapshot, id: number): number {
  const enemy = enemyById(s, id);
  if (enemy === undefined) fail(`a live enemy with id ${id}`, "none");
  return enemy.hp;
}

/**
 * Whether the tick that ran took damage off enemy `id`, whose `hp` read
 * `hpBefore` before it: `true` when the enemy is gone or its `hp` fell,
 * `false` when it is still there at the `hp` it was posed with.
 */
export function tookDamage(
  after: WickSnapshot,
  id: number,
  hpBefore: number,
): boolean {
  const enemy = enemyById(after, id);
  if (enemy === undefined) return true;
  return enemy.hp < hpBefore - REAL_EPS;
}
