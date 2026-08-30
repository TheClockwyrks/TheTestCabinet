// abilities/aura-sums-and-caps — auras add up, and stop adding up at AURA_CAP.
//
// specs/components.md fixes both: "Aura bonuses from several sources covering one
// structure sum, and the summed bonus is capped at `AURA_CAP` (`1.0`, doubling the
// structure's damage)."
//
// Two arrangements are read on one yard, the second replacing the first. Two Scrap
// Regulators over one Capacitor is the summing case: `0.10` and `0.10` make
// `0.20`, so a build that takes the largest bonus rather than the total reports
// `6.6` where `7.2` is due. Five Tesla-Prime Regulators over the same Capacitor is
// the ceiling: their bonuses sum to `1.10`, over the cap, so the Capacitor must
// report exactly twice its bare damage and not a fraction more.
//
// Every Regulator's centre is inside its own radius of the Capacitor's, and no
// Regulator is buffed by any of this: an aura reaches firing structures, and a
// Regulator never fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  AURA_CAP,
  componentDamage,
  REGULATOR_AURA,
  type Tier,
} from "../constants";
import {
  captureStill,
  createHarness,
  emptyYard,
  openYard,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

/** The Capacitor every arrangement is read on. */
const CAPACITOR = { col: 20, row: 15 };
const CAPACITOR_TIER = 1;

/** Two places within a Scrap Regulator's `90` of that centre. */
const PAIR = [
  { col: 17, row: 15 },
  { col: 23, row: 15 },
];

/** Five places within a Tesla-Prime Regulator's `114` of that centre. */
const MANY = [
  { col: 17, row: 15 },
  { col: 23, row: 15 },
  { col: 20, row: 12 },
  { col: 20, row: 18 },
  { col: 17, row: 12 },
];

const BARE = componentDamage("capacitor", CAPACITOR_TIER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Stand one Capacitor under `places` Regulators of `tier`, and read its damage. */
async function damageUnder(
  harness: Harness,
  tier: Tier,
  places: readonly { col: number; row: number }[],
): Promise<number> {
  await emptyYard(harness);
  const id = await standComponent(
    harness,
    "capacitor",
    CAPACITOR_TIER,
    CAPACITOR.col,
    CAPACITOR.row,
  );
  for (const place of places) {
    await standComponent(harness, "regulator", tier, place.col, place.row);
  }
  return structureById(await harness.snapshot(), id).damage;
}

it("sums two bonuses and holds a fifth of them at twice the bare damage", async () => {
  await openYard(h);

  const summed = await damageUnder(h, 1, PAIR);
  const scrapBonus = REGULATOR_AURA[0]!.bonus;
  assertCloseTo(
    summed,
    BARE * (1 + PAIR.length * scrapBonus),
    6,
    `the damage under ${PAIR.length} Scrap Regulators, whose ${scrapBonus} ` +
      `bonuses sum to ${PAIR.length * scrapBonus} (specs/components.md)`,
  );

  const capped = await damageUnder(h, 5, MANY);
  await h.advance(1);
  await captureStill(h, "cap");
  const uncapped = MANY.length * REGULATOR_AURA[4]!.bonus;
  assertCloseTo(
    capped,
    BARE * (1 + AURA_CAP),
    6,
    `the damage under ${MANY.length} Tesla-Prime Regulators, whose bonuses ` +
      `sum to ${uncapped} and are capped at AURA_CAP (${AURA_CAP}) ` +
      `(specs/components.md)`,
  );
});
