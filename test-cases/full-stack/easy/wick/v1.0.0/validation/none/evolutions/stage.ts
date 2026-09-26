// evolutions/stage — what the Evolutions checks share: the chest that pays a
// recipe off, the result it reports, the shapes each evolved weapon puts in the
// world, and the readings the six evolved rows are checked against.
//
// THE CHEST IS REACHED THE REAL WAY. `specs/evolutions.md` ("Opening a chest"):
// "A chest is collected as `specs/world.md` states", and `specs/world.md`
// ("Collection") collects a pickup "on any tick on which the distance between
// its center and the lamplighter's center is less than `PICKUP_ITEM_RADIUS`
// (`16`) plus `PLAYER_RADIUS` (`12`)". `specs/instrumentation.md` (`setScreen`)
// says so in as many words: "The chest overlay is reached through
// `spawnPickup("chest", x, y)` at the lamplighter's center and one tick, which
// is the real collection path." The harness's `openChest` is exactly that, and
// every chest check here goes through it: no check poses `screen` `chest`, and
// no check poses a result.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer
// is `0`, so a weapon fires on the first `playing` tick it is held", and
// `specs/evolutions.md` ("Passives still apply") has an evolved weapon read
// every common rule of that file unchanged. The harness's `fireWeapon` is that:
// hold the weapon at level `1` (an evolved weapon "has a single level"), arm
// it, turn `weaponFire` on, step one tick. Everything else stays held, so the
// tick counts one timer, fires one weapon, and resolves phase 6's hits
// (`specs/world.md`, "One tick"); `enemyMotion` and `enemyContact` are off, so a
// posed enemy stands where it was posed and lands nothing back, and
// `effectMotion` is off, so a projectile stands at the center it was created at
// with the velocity the firing gave it.
//
// THE PROBES. A moth is the probe where a hit must be told from a miss: it has
// `5` hp unscaled at a run clock of `0` (`specs/enemies.md`), which every
// evolved damage figure takes past `0`, so "hit" reads as gone-or-lowered and
// "untouched" as present at the hp it was posed with. A rat (`15` hp) is the
// probe where a damage FIGURE must be read off a survivor of a `12` pulse, and a
// hound (`120` hp, radius `18`) where a schedule of several hits must be
// outlived.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, fail } from "../assert";
import {
  ANGLE_TOL,
  ENEMIES,
  EVOLUTION_IDS,
  FLOAT_TOL,
  POSITION_TOL,
  type EvolutionId,
  type WeaponId,
  type ZoneKind,
} from "../constants";
import {
  angleFrom,
  distanceBetween,
  enemyById,
  holdWeapon,
  newZones,
  type ChestResult,
  type EnemyView,
  type Firing,
  type Harness,
  type ProjectileView,
  type WickSnapshot,
  type XY,
  type ZoneView,
  zonesOfKind,
} from "../harness";

/* ---- The chest ------------------------------------------------------------ */

/** What a chest reported, with the `null` an unopened chest leaves ruled out. */
export type ChestOutcome = NonNullable<ChestResult>;

/**
 * The result `snapshot` reports for the chest that was just opened, or the
 * point fails: "`chestResult` records it" (`specs/progression.md`), and a run
 * that reports nothing after a collected chest cannot be read for the rule the
 * check is about.
 */
export function chestOutcome(
  snapshot: WickSnapshot,
  what: string,
): ChestOutcome {
  const result = snapshot.run.chestResult;
  if (result === null || result === undefined) {
    fail(`a chest result after ${what}`, result);
  }
  return result;
}

/**
 * The chest's result was not an evolution: one of the two fallbacks
 * `specs/evolutions.md` lists, "Level" or "Heal".
 */
export function assertNotEvolved(
  snapshot: WickSnapshot,
  what: string,
): ChestOutcome {
  const result = chestOutcome(snapshot, what);
  if (result.kind === "level" || result.kind === "heal") return result;
  fail(`a level or heal result after ${what}`, result);
}

/**
 * No slot holds any of the six evolved weapons: "The recipes are `EVOLUTIONS`,
 * keyed by the evolved weapon's id; the six ids are `EVOLUTION_IDS`"
 * (`specs/evolutions.md`).
 */
export function assertNoEvolutionHeld(
  snapshot: WickSnapshot,
  what: string,
): void {
  const held = (snapshot.run.weapons ?? [])
    .filter((slot) => (EVOLUTION_IDS as readonly string[]).includes(slot.id))
    .map((slot) => slot.id);
  if (held.length === 0) return;
  fail(`no evolved weapon held ${what}`, held);
}

/** The weapon in `slot`, or the point fails: a slot the check posed must be held. */
export function slotOf(
  snapshot: WickSnapshot,
  slot: number,
  what: string,
): { id: WeaponId; level: number; cooldown: number } {
  const held = (snapshot.run.weapons ?? [])[slot];
  if (held === undefined) {
    fail(`a weapon in slot ${slot} ${what}`, snapshot.run.weapons);
  }
  return held;
}

/**
 * Stand the game back on `playing` when a chest overlay was opened, to pose the
 * next scenario: `setScreen("playing")` "Sets `screen` to `name` ... Nothing
 * else changes" (`specs/instrumentation.md`), so the loadout the check posed
 * crosses it untouched. Closing the overlay for real is `confirm`'s, which
 * `screens/chest-confirm-closes` decides.
 *
 * A build that opened no overlay is already on `playing`, and the call is
 * skipped rather than made. Whether the overlay opens at all is decided by the
 * progression points; this leaves the run standing either way.
 */
export async function closeChest(
  h: Harness,
  opened: WickSnapshot,
): Promise<void> {
  if (opened.screen === "chest") await h.debug.setScreen("playing");
}

/* ---- Shapes an evolved weapon puts in the world ---------------------------- */

/** The zones of `kind` and `weapon` among the ones `firing` created, in id order. */
export function zonesFired(
  firing: Firing,
  weapon: WeaponId,
  kind: ZoneKind,
): ZoneView[] {
  return firing.zones.filter(
    (zone) => zone.kind === kind && zone.weapon === weapon,
  );
}

/** The zones of `kind` and `weapon` `after` holds that `before` did not, in id order. */
export function zonesCreated(
  before: WickSnapshot,
  after: WickSnapshot,
  weapon: WeaponId,
  kind: ZoneKind,
): ZoneView[] {
  return newZones(before, after).filter(
    (zone) => zone.kind === kind && zone.weapon === weapon,
  );
}

/** The projectiles of `weapon` among the ones `firing` created, in id order. */
export function boltsFired(
  firing: Firing,
  weapon: EvolutionId,
): ProjectileView[] {
  return firing.projectiles.filter((shape) => shape.weapon === weapon);
}

/** Every zone of `kind` and `weapon` `snapshot` holds, in id order. */
export function zonesHeld(
  snapshot: WickSnapshot,
  weapon: WeaponId,
  kind: ZoneKind,
): ZoneView[] {
  return zonesOfKind(snapshot, kind).filter((zone) => zone.weapon === weapon);
}

/**
 * The one aura `snapshot` holds, or the point fails: Corona is "one zone of
 * kind `aura`" (`specs/evolutions.md`), so a run with none, or with two, cannot
 * be read for the figure a check is about.
 */
export function soleAura(snapshot: WickSnapshot, what: string): ZoneView {
  const auras = zonesOfKind(snapshot, "aura");
  if (auras.length !== 1) {
    fail(
      `exactly one zone of kind aura (${what})`,
      auras.map((zone) => ({ id: zone.id, weapon: zone.weapon })),
    );
  }
  return auras[0] as ZoneView;
}

/* ---- The moth probe -------------------------------------------------------- */

/** A moth's table hp, `5`, which a run clock of `0` leaves unscaled. */
export const MOTH_HP = ENEMIES.moth.hp;

/**
 * The moth `posed` was hit by the tick that left `after`: it is gone, having
 * died of the hit, or its hp is below what it was posed with.
 */
export function assertHit(
  after: WickSnapshot,
  posed: EnemyView,
  what: string,
): void {
  const now = enemyById(after, posed.id);
  if (now === undefined || now.hp < posed.hp) return;
  fail(
    `${what}: enemy ${posed.id} hit (gone, or hp below ${posed.hp})`,
    `present at hp ${now.hp}`,
  );
}

/** The enemy `posed` was left alone: still live, at exactly the hp it was posed with. */
export function assertUntouched(
  after: WickSnapshot,
  posed: EnemyView,
  what: string,
): void {
  const now = enemyById(after, posed.id);
  if (now !== undefined && now.hp === posed.hp) return;
  fail(
    `${what}: enemy ${posed.id} untouched (present at hp ${posed.hp})`,
    now === undefined ? "gone" : `present at hp ${now.hp}`,
  );
}

/* ---- The Chandelier set ---------------------------------------------------- */

/** What {@link placeChandelierSet} arranged. */
export interface ChandelierSet {
  /** The slot Chandelier went into. */
  slot: number;
  /** The state before the tick that placed the set. */
  before: WickSnapshot;
  /** The state the placing tick left. */
  after: WickSnapshot;
  /** The lanterns that tick created, in id order. */
  lanterns: ZoneView[];
}

/**
 * Hold Chandelier and run the one `playing` tick that places its set.
 *
 * `specs/evolutions.md` ("Chandelier"): "On the first `playing` tick Chandelier
 * is held and no Chandelier lantern exists, any Lantern lanterns still in the
 * world are removed and `amount` Chandelier lanterns are created".
 * `specs/instrumentation.md` ("The driver switches"): "Placement is gated by
 * neither `weaponFire` nor `effectMotion`", so the set appears on an isolated
 * night with every switch off.
 */
export async function placeChandelierSet(h: Harness): Promise<ChandelierSet> {
  const slot = await holdWeapon(h, "chandelier", 1);
  const before = await h.snapshot();
  const after = await h.step(1);
  return {
    slot,
    before,
    after,
    lanterns: zonesCreated(before, after, "chandelier", "lantern"),
  };
}

/** The Chandelier lanterns `snapshot` holds, in id order. */
export function chandelierLanterns(snapshot: WickSnapshot): ZoneView[] {
  return zonesHeld(snapshot, "chandelier", "lantern");
}

/**
 * The angles at which a set of `amount` lanterns stands when it is created:
 * "lantern `i`, counted from `0`, at angle `i × 360 / amount`"
 * (`specs/evolutions.md`), taken from `base`.
 */
export function spacedAngles(amount: number, base = 0): number[] {
  return Array.from(
    { length: amount },
    (_, i) => (((base + (i * 360) / amount) % 360) + 360) % 360,
  );
}

/** The short-way-round distance between two angles, in degrees. */
function angleGap(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * `lanterns` stand at exactly the angles of `expected` about `center`, each
 * angle taken by a distinct lantern within `ANGLE_TOL`, in whatever id order
 * the build chose: the specification counts the lanterns by `i` without fixing
 * which id each takes.
 */
export function assertAnglesAre(
  lanterns: readonly ZoneView[],
  center: XY,
  expected: readonly number[],
  what: string,
): void {
  const actual = lanterns.map((lantern) => angleFrom(center, lantern));
  assertEqual(actual.length, expected.length, `${what}: lanterns to match`);
  const free = new Set(actual.keys());
  for (const angle of expected) {
    let taken: number | undefined;
    for (const index of free) {
      if (angleGap(actual[index] as number, angle) <= ANGLE_TOL) {
        taken = index;
        break;
      }
    }
    if (taken === undefined) {
      fail(
        `${what}: a lantern at ${angle} degrees +/- ${ANGLE_TOL} about the lamplighter`,
        actual,
      );
    }
    free.delete(taken);
  }
}

/** Every lantern of `lanterns` sits exactly `orbit` from `center`. */
export function assertOnOrbit(
  lanterns: readonly ZoneView[],
  center: XY,
  orbit: number,
  what: string,
): void {
  for (const lantern of lanterns) {
    assertNear(
      distanceBetween(center, lantern),
      orbit,
      POSITION_TOL,
      `${what}: lantern ${lantern.id}'s distance from the lamplighter's center`,
    );
  }
}

/** The lantern of `lanterns` with the lowest id, or the point fails. */
export function lowestId(
  lanterns: readonly ZoneView[],
  what: string,
): ZoneView {
  if (lanterns.length === 0) fail(`at least one lantern (${what})`, []);
  return [...lanterns].sort((a, b) => a.id - b.id)[0] as ZoneView;
}

/** Every entry of `shape.hits` is empty: "with fresh ids and empty `hits`". */
export function assertNoHits(zone: ZoneView, what: string): void {
  assertEqual(
    (zone.hits ?? []).length,
    0,
    `${what}: hits entries on zone ${zone.id}`,
  );
}

/* ---- Scatter --------------------------------------------------------------- */

/** The center of `zone`, as a point. */
export function centerOf(zone: ZoneView): XY {
  return { x: zone.x, y: zone.y };
}

/** Whether two points are the same point, within `POSITION_TOL`. */
export function samePoint(a: XY, b: XY): boolean {
  return distanceBetween(a, b) <= POSITION_TOL;
}

/** The distinct points among `points`, each counted once within `POSITION_TOL`. */
export function distinctPoints(points: readonly XY[]): XY[] {
  const distinct: XY[] = [];
  for (const point of points) {
    if (!distinct.some((held) => samePoint(held, point))) distinct.push(point);
  }
  return distinct;
}

/** A hit removed exactly `damage` from `posed`, read off `after`. */
export function assertDamaged(
  after: WickSnapshot,
  posed: EnemyView,
  damage: number,
  what: string,
): void {
  const now = enemyById(after, posed.id);
  if (now === undefined) {
    fail(`${what}: enemy ${posed.id} alive at hp ${posed.hp - damage}`, "gone");
  }
  assertNear(now.hp, posed.hp - damage, FLOAT_TOL, what);
}
