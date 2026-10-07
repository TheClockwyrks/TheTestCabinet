// pin/firing — one posed Pin firing, shared by the checks in this directory.
// CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Pin "fires whether or not any enemy exists"
// (`specs/weapons.md`, Pin), so every check on a dart poses an isolated run
// holding nothing at all, holds Pin at the level under test, and runs the one
// tick on which it fires. That arrangement is spelled once here and decides
// nothing: Pin is placed through `setWeapon`, the firing through
// `setWeaponCooldown(slot, 0)` and `weaponFire` on ("`setWeaponCooldown(slot,
// 0)` makes that the next tick", `specs/instrumentation.md`), and what the
// tick created is read back by id, telling this tick's darts from anything
// posed before it.
//
// WHY THE DARTS ARE READ WHERE THEY WERE FIRED. `specs/world.md` ("One tick"),
// phase 5, has a due weapon fire "creating its projectiles and zones at the
// lamplighter's and the enemies' positions of this tick", and phase 6 has a
// new projectile hit "at the position it was created at and first moving on
// the next tick" — so after the firing tick every dart still sits at its
// start, carrying exactly the velocity the firing gave it. `effectMotion` is
// off in an isolated run anyway, so nothing moves a dart on any later tick a
// check might run. No enemy exists, so no dart hits anything and no pierce is
// spent.
//
// THE FACING. `specs/world.md` ("Facing"): `facing` "starts as `"right"`",
// and `setFacing` poses either value. A check about one direction poses that
// direction explicitly and reads it back before the firing, so the verdict
// rests on the facing the check named rather than on the fresh run's default.

import { assertEqual } from "../assert";
import {
  advanceTicks,
  armWeapon,
  holdWeapon,
  isolate,
  projectilesCreatedSince,
  type Harness,
  type SnapshotProjectile,
  type WickSnapshot,
} from "../harness";

/** The two values `facing` takes (`specs/world.md`, Facing). */
export type Facing = "left" | "right";

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Pin was placed in. */
  slot: number;
  /** The state before the firing tick, with Pin armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The Pin projectiles the firing tick created, in id order. */
  darts: SnapshotProjectile[];
}

/**
 * Pose an isolated run facing `facing`, hold Pin at `level` armed to fire on
 * the next tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but Pin: no enemy, no other
 * weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on. When `facing` is named it is posed
 * through `setFacing` and read back, so a surface that does not pose it
 * fails the check here rather than on the direction the darts flew.
 */
export async function firePin(
  h: Harness,
  level: number,
  facing?: Facing,
): Promise<Firing> {
  isolate(h);
  if (facing !== undefined) {
    h.debug.setFacing(facing);
    assertEqual(
      h.snapshot().run.player.facing,
      facing,
      "the facing posed before the firing (specs/instrumentation.md, setFacing)",
    );
  }
  const slot = holdWeapon(h, "pin", level);
  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return {
    slot,
    before,
    after,
    darts: projectilesCreatedSince(before, after).filter(
      (projectile) => projectile.weapon === "pin",
    ),
  };
}
