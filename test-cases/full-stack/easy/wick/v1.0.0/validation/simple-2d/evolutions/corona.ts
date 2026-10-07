// evolutions/corona — what the points about Corona share: the aura read off a
// snapshot, and where a probe stands inside it. CASE-PROVIDED.
//
// No review item names this file. The readings restate the rules of
// specs/evolutions.md ("Corona") and specs/state.md (`ZoneState`) that the
// points of this category assert the same way.
//
// WHERE A PROBE STANDS. The aura is "a circle of `radius` centered on the
// player's center every tick" with the fixed radius `150`
// (specs/evolutions.md), and an enemy is a circle of its own radius
// (specs/enemies.md), so a probe whose center is `PROBE_DX` (40) from the
// lamplighter's overlaps it: "Two circles overlap when the distance between
// their centers is less than the sum of their radii" (specs/weapons.md, "Shapes
// and overlap"). It stands clear of the lamplighter's own circle of radius 12,
// and every driver switch a point does not turn on is off, so nothing moves it,
// nothing touches it, and the pulse is the only thing that can change its hp.

import { fail } from "../assert";
import { zonesOfKind, type WickSnapshot, type ZoneSnapshot } from "../harness";

/** Where a probe stands, as an offset along +x from the lamplighter's center. */
export const PROBE_DX = 40;

/** Every zone of kind `aura` that Corona produced, ascending by id. */
export function coronaAuras(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOfKind(snapshot, "aura").filter(
    (zone) => zone.weapon === "corona",
  );
}

/** Every zone of kind `aura` that Halo produced, ascending by id. */
export function haloAuras(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOfKind(snapshot, "aura").filter((zone) => zone.weapon === "halo");
}

/**
 * The one Corona aura in `snapshot`: "one zone of kind `aura`"
 * (specs/evolutions.md, "Corona"). Any other count fails the point.
 */
export function theAura(snapshot: WickSnapshot, context: string): ZoneSnapshot {
  const auras = coronaAuras(snapshot);
  if (auras.length !== 1) {
    fail(`exactly one aura zone with weapon corona (${context})`, auras.length);
  }
  return auras[0];
}
