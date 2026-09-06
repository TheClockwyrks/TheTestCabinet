// evolutions/chest — what the points about the recipe and the chest's result
// share: an isolated night whose loadout is posed item by item, a chest reached
// the real way, and the readings of what that chest did. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them.
//
// HOW A CHEST IS REACHED. Through the collection path and never through a pose
// of the screen: "The chest overlay is reached through `spawnPickup("chest", x,
// y)` at the lamplighter's center and one tick, which is the real collection
// path" (specs/instrumentation.md, `setScreen`). `harness.ts`'s `openChest` is
// exactly that sequence, and the result, the evolution, and the overlay all
// come from the tick it runs: "No pose decides an outcome: every hit, kill,
// drop, collection, level-up, evolution, and ending comes from the ticks run
// after the pose".
//
// WHY THE NIGHT IS EMPTY BUT FOR THE LOADOUT. A chest's result is decided from
// the held items alone (specs/evolutions.md, "Opening a chest"), so every point
// here poses the loadout its rule concerns and nothing else: no enemy, no other
// weapon, no other passive, and every driver switch off, so no spawn, no hit,
// and no kill joins the collecting tick.

import { assertEqual, fail } from "../assert";
import { EVOLUTION_IDS, type WeaponId } from "../constants";
import {
  isolate,
  type ChestResult,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Which of the three results a chest reported (specs/state.md, ChestResult). */
export type ChestResultKind = ChestResult["kind"];

/**
 * Reset to an isolated night on `playing` with nothing held, nothing on the
 * field, and every driver switch off. The caller poses the loadout its rule
 * concerns through `holdWeapon` and `holdPassive`, then opens a chest with
 * `openChest`.
 */
export function poseChestNight(h: Harness): WickSnapshot {
  const posed = isolate(h);
  assertEqual(posed.run.weapons.length, 0, "weapons held before the loadout");
  assertEqual(posed.run.passives.length, 0, "passives held before the loadout");
  return posed;
}

/**
 * The result the chest recorded, or the point fails: "`chestResult` records it"
 * on the tick the chest is collected (specs/progression.md, "The chest
 * overlay"). A build that collected no chest, or recorded no result, leaves
 * `null`.
 */
export function chestResult(
  snapshot: WickSnapshot,
  context: string,
): ChestResult {
  const result = snapshot.run.chestResult;
  if (result === null) fail(`a chest result (${context})`, null);
  return result;
}

/** The chest's result is of `kind`, and the result itself, for a closer read. */
export function assertResultKind(
  snapshot: WickSnapshot,
  kind: ChestResultKind,
  context: string,
): ChestResult {
  const result = chestResult(snapshot, context);
  assertEqual(result.kind, kind, `${context}: the chest result's kind`);
  return result;
}

/** The weapon slot `slot` holds `id` at `level`, as the chest left it. */
export function assertSlotHolds(
  snapshot: WickSnapshot,
  slot: number,
  id: WeaponId,
  level: number,
  context: string,
): void {
  assertEqual(snapshot.run.weapons[slot]?.id, id, `${context}: the weapon id`);
  assertEqual(
    snapshot.run.weapons[slot]?.level,
    level,
    `${context}: the weapon's level`,
  );
}

/**
 * No evolution happened: the chest's result is not an `evolve`, and no evolved
 * weapon stands in any slot. "One chest evolves at most one weapon" and an
 * evolution "replaces its base in the same slot" (specs/evolutions.md), so a
 * build that evolved anything shows it in both readings.
 */
export function assertNothingEvolved(
  snapshot: WickSnapshot,
  context: string,
): void {
  const result = chestResult(snapshot, context);
  assertEqual(
    result.kind === "evolve",
    false,
    `${context}: whether the chest's result was an evolution`,
  );
  const evolved = snapshot.run.weapons
    .filter((held) => (EVOLUTION_IDS as readonly string[]).includes(held.id))
    .map((held) => held.id);
  assertEqual(
    evolved.join(","),
    "",
    `${context}: the evolved weapons held after the chest`,
  );
}
