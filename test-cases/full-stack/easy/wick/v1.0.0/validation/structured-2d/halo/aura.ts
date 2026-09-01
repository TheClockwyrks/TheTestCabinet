// Wick — halo/aura: what the Halo checks share. CASE-PROVIDED.
//
// Every check in this directory poses an isolated run, holds Halo at the
// level its point names, and runs the tick that creates the aura and, when
// `weaponFire` is on, pulses it. What it then reads is the one aura zone the
// tick left or what a pulse did to an enemy posed inside it, and both readings
// are spelled here once so each check is the pose, the tick, and its own
// assertions.
//
// HOW THE AURA IS READ. `specs/weapons.md` ("Halo"): "Halo is a permanent
// aura: one zone of kind `aura`", and `specs/state.md` makes the zone's
// `weapon` `halo`. A check that reads the aura reads exactly one such zone
// and fails when there are none or several, since either is a placement
// fault the check cannot see past.
//
// HOW A PULSE IS READ. `specs/weapons.md` ("Halo"): "every enemy whose circle
// overlaps the aura takes `damage`", and ("Hits and death") "A hit removes
// the shape's damage per hit from the enemy's `hp`". The enemy's `hp` is read
// before the tick and after it, and what is graded is the difference: nothing
// else can touch the enemy, since `enemyMotion`, `enemyContact`, and
// `despawning` are off in every isolated run and no other shape exists.
//
// WHERE THE ENEMY STANDS. `INSIDE` (40) units from the lamplighter's center,
// well inside every row's radius (the smallest is 80, and an enemy's circle
// overlaps the aura when the distance is "less than the sum of their radii",
// `specs/weapons.md`, Shapes and overlap) and clear of the lamplighter's own
// circle, so the still shows the aura and the enemy apart.

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
export const INSIDE = 40;

/**
 * Hold Halo at `level` in the first free weapon slot and make it pulse on the
 * next tick: its timer at `0` and `weaponFire` on. The slot it took.
 */
export function armHalo(h: Harness, level: number): number {
  const slot = holdWeapon(h, "halo", level);
  armWeapon(h, slot);
  return slot;
}

/** Every zone of kind `aura` whose weapon is `halo`, in id order. */
export function haloAuras(s: WickSnapshot): SnapshotZone[] {
  return s.run.zones.filter(
    (zone) => zone.kind === "aura" && zone.weapon === "halo",
  );
}

/** The one Halo aura `s` holds; none or several fails the check. */
export function theAura(s: WickSnapshot): SnapshotZone {
  const auras = haloAuras(s);
  if (auras.length !== 1) {
    throw new Error(
      `Expected: exactly one zone of kind aura with weapon halo (specs/weapons.md, Halo)\nActual: ${auras.length}`,
    );
  }
  return auras[0];
}

/** The `hp` enemy `id` holds in `s`; a missing enemy fails the check. */
export function hpOf(s: WickSnapshot, id: number): number {
  const enemy = enemyById(s, id);
  if (enemy === undefined) {
    throw new Error(`Expected: a live enemy with id ${id}\nActual: none`);
  }
  return enemy.hp;
}

/**
 * Whether the tick that ran hit enemy `id`, whose `hp` read `hpBefore` before
 * it: `true` when the enemy is gone or its `hp` fell, `false` when it is
 * still there at the `hp` it was posed with.
 */
export function wasHit(
  after: WickSnapshot,
  id: number,
  hpBefore: number,
): boolean {
  const enemy = enemyById(after, id);
  if (enemy === undefined) return true;
  return enemy.hp < hpBefore - REAL_EPS;
}
