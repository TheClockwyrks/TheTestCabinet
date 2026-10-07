// evolutions/chandelier — what the points about Chandelier share: the set of
// lanterns read off a snapshot, and the angles they ride at. CASE-PROVIDED.
//
// No review item names this file. The readings restate the rules of
// specs/evolutions.md ("Chandelier") and specs/state.md (`ZoneState`) that the
// points of this category assert the same way.
//
// WHY THE SET IS READ BY WEAPON AND KIND. "`amount` Chandelier lanterns are
// created, each a zone of kind `lantern` with `ttl` `null`" (specs/evolutions.md),
// and `ZoneState.weapon` is "the weapon that produced it" (specs/state.md), so
// the pair tells a Chandelier lantern from a Lantern one on a night that held
// both.

import { fail } from "../assert";
import {
  angleAbout,
  type Point,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** Every Chandelier lantern in `snapshot`, ascending by id. */
export function chandelierLanterns(snapshot: WickSnapshot): ZoneSnapshot[] {
  return snapshot.run.zones.filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "chandelier",
  );
}

/** Every Lantern lantern in `snapshot`, ascending by id. */
export function baseLanterns(snapshot: WickSnapshot): ZoneSnapshot[] {
  return snapshot.run.zones.filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "lantern",
  );
}

/** The lantern of `set` with the lowest id, which the respacing rule names. */
export function lowestId(
  set: readonly ZoneSnapshot[],
  context: string,
): ZoneSnapshot {
  if (set.length === 0) fail(`a lantern (${context})`, "none");
  return set.reduce((lowest, zone) => (zone.id < lowest.id ? zone : lowest));
}

/**
 * The angles of `set` about `center`, in degrees in `[0, 360)`, ascending.
 * "Angles are in degrees, with `0` along `+x` and positive angles turning
 * toward `+y`" (specs/weapons.md, "The nearest enemy").
 */
export function anglesOf(
  set: readonly ZoneSnapshot[],
  center: Point,
): number[] {
  return set.map((zone) => angleAbout(center, zone)).sort((a, b) => a - b);
}
