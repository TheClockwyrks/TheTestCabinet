// abilities/aura-sums — two auras over one structure add up.
//
// specs/components.md fixes both halves in one sentence: "Aura bonuses from
// several sources covering one structure sum, and the summed bonus is capped at
// `AURA_CAP` (`1.0`, doubling the structure's damage)."
//
// THE RULE AND ITS CEILING ARE TWO POINTS. A build that takes the largest bonus
// rather than the total never reaches the cap at all, so decided together the two
// builds are indistinguishable: one that sums and never caps grades exactly like
// one that ignores every Regulator past the first. `aura-sums` decides the rule
// and `aura-caps-at-max` decides the ceiling.
//
// HOW IT IS DECIDED. Two Scrap Regulators over one Capacitor: `0.10` and `0.10`
// make `0.20`, so a build that takes the largest bonus rather than the total
// reports `6.6` where `7.2` is due. The arrangement is far short of the cap, so
// nothing but the summing can move the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { BARE, PAIR, REGULATOR_AURA, damageUnder } from "./aura";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sums the bonuses of two Regulators covering one structure", async () => {
  await openYard(h);

  const summed = await damageUnder(h, 1, PAIR);
  await h.advance(1);
  await captureStill(h, "sum");

  const scrapBonus = REGULATOR_AURA[0]!.bonus;
  assertCloseTo(
    summed,
    BARE * (1 + PAIR.length * scrapBonus),
    6,
    `the damage under ${PAIR.length} Scrap Regulators, whose ${scrapBonus} ` +
      `bonuses sum to ${PAIR.length * scrapBonus} (specs/components.md)`,
  );
});
