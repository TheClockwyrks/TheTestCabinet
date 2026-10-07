// lantern/orbit — what the points of this category share: an isolated night
// holding Lantern alone at a level with its firing due on the next tick, the
// lanterns the firing tick created read against the row of `LANTERN_LEVELS` in
// force, and the timer rule Lantern alone follows. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Lantern", "Derived stats", and "Cooldown timers") that
// every row point asserts the same way.
//
// WHY NOTHING ELSE IS ON THE FIELD. "Taper, Lantern, Halo, Oil Splash, Pin,
// Shard, and Flare need no target and fire the same way" (specs/weapons.md,
// "Cooldown timers"), so a set is created on an empty field, and with no enemy
// posed no hit, kill, or drop joins the firing tick. A point that is ABOUT a
// hit poses its own enemy on the lantern's starting position.

import { assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  LANTERN_LEVELS,
  cooldownFor,
  derived,
  type OrbitRow,
} from "../constants";
import {
  armWeapon,
  distance,
  holdWeapon,
  isolate,
  type Harness,
  type Point,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** What {@link armLantern} posed: the slot Lantern took and the night before the firing. */
export interface Orbit {
  slot: number;
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Lantern alone at `level`, with its timer
 * at 0 and `weaponFire` on, so the next `playing` tick is the firing tick:
 * "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: `effectMotion` off
 * holds each lantern at its starting angle, so a reading after the firing tick
 * is the placement the firing made; a point about the revolution turns it on
 * itself.
 */
export function armLantern(h: Harness, level: number): Orbit {
  isolate(h);
  const player = { ...h.snapshot().run.player };
  const slot = holdWeapon(h, "lantern", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "lantern", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Lantern's posed level");
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Lantern's posed timer");
  assertEqual(posed.weaponFire, true, "weaponFire before the firing tick");
  assertEqual(posed.run.zones.length, 0, "zones before the firing tick");
  return { slot, player: { x: player.x, y: player.y }, posed };
}

/** Row `level` of LANTERN_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function lanternRow(level: number): OrbitRow {
  return LANTERN_LEVELS[level - 1];
}

/**
 * Every lantern Lantern produced, ascending by id: the zones of kind `lantern`
 * whose `weapon` is `lantern` (specs/state.md, `ZoneState`), which tells them
 * from the lanterns of Chandelier.
 */
export function lanternsOf(snapshot: WickSnapshot): ZoneSnapshot[] {
  return snapshot.run.zones.filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "lantern",
  );
}

/**
 * `lantern` carries the figures `row` gives a lantern created with no passive
 * held: radius `row.radius × areaMul`, damage `row.damage × damageMul`, `ttl`
 * `row.duration`, and its center `row.orbit × areaMul` from `player`, each as
 * specs/weapons.md ("Lantern" and "Derived stats") states it. With nothing
 * held every multiplier is `1` (specs/passives.md). The `ttl` is the full
 * duration because only a zone "that existed before this tick" counts down
 * (specs/world.md, "One tick", phase 6).
 */
export function assertLanternOfRow(
  lantern: ZoneSnapshot,
  row: OrbitRow,
  player: Point,
  context: string,
): void {
  assertWithin(
    lantern.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    lantern.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
  assertWithin(
    lantern.ttl ?? Number.NaN,
    row.duration,
    FIGURE_TOLERANCE,
    `${context}: ttl on the tick it was created`,
  );
  assertWithin(
    distance(player, lantern),
    row.orbit * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: distance from the lamplighter's center, the orbit`,
  );
}

/**
 * The seconds Lantern's timer reads after a firing at `row` with no passive
 * held: "On firing, Lantern's cooldown timer is set to `duration` plus the
 * current cooldown, both read on that tick" (specs/weapons.md, "Lantern"),
 * the current cooldown being "the table cooldown times `cooldownMul`, floored
 * at `MIN_COOLDOWN`" ("Cooldown timers"), `1` times the table figure with no
 * Oil held.
 */
export function timerAfterFiring(row: OrbitRow): number {
  return row.duration + cooldownFor(row.cooldown, {});
}

/** Lantern's timer in `slot` reads {@link timerAfterFiring} after the firing tick. */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: OrbitRow,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    timerAfterFiring(row),
    FIGURE_TOLERANCE,
    "Lantern's timer after the firing tick, duration plus cooldown",
  );
}
