// abilities — the Capacitor a Regulator's aura is read on. CASE-PROVIDED, LOCAL
// TO THIS CATEGORY.
//
// specs/components.md: "Aura bonuses from several sources covering one structure
// sum, and the summed bonus is capped at `AURA_CAP` (`1.0`, doubling the
// structure's damage)." That is a rule and a ceiling, and `abilities/aura-sums`
// and `abilities/aura-caps-at-max` decide them apart, so the arrangement they
// share sits here.
//
// EVERY REGULATOR'S CENTRE IS INSIDE ITS OWN RADIUS of the Capacitor's, and no
// Regulator is buffed by any of this: an aura reaches firing structures, and a
// Regulator never fires.

import { componentDamage, REGULATOR_AURA, type Tier } from "../constants";
import {
  emptyYard,
  type Harness,
  standComponent,
  structureById,
} from "../harness";

/** Re-exported so the two suites can name the bonuses they assert. */
export { REGULATOR_AURA };

/** The Capacitor every arrangement is read on. */
export const CAPACITOR = { col: 20, row: 15 };
export const CAPACITOR_TIER = 1;

/** Two places within a Scrap Regulator's `90` of that centre. */
export const PAIR = [
  { col: 17, row: 15 },
  { col: 23, row: 15 },
];

/** Five places within a Tesla-Prime Regulator's `114` of that centre. */
export const MANY = [
  { col: 17, row: 15 },
  { col: 23, row: 15 },
  { col: 20, row: 12 },
  { col: 20, row: 18 },
  { col: 17, row: 12 },
];

/** What the Capacitor hits for with no aura over it at all. */
export const BARE = componentDamage("capacitor", CAPACITOR_TIER);

/** Stand one Capacitor under `places` Regulators of `tier`, and read its damage. */
export function damageUnder(
  h: Harness,
  tier: Tier,
  places: readonly { col: number; row: number }[],
): number {
  emptyYard(h);
  const id = standComponent(
    h,
    "capacitor",
    CAPACITOR_TIER,
    CAPACITOR.col,
    CAPACITOR.row,
  );
  for (const place of places) {
    standComponent(h, "regulator", tier, place.col, place.row);
  }
  return structureById(h.snapshot(), id).damage;
}
