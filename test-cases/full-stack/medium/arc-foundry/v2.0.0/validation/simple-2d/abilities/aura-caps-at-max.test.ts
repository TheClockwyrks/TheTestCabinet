// abilities/aura-caps-at-max — a summed aura stops at AURA_CAP.
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
// HOW IT IS DECIDED. Five Tesla-Prime Regulators over one Capacitor: their bonuses
// sum to `1.10`, over the cap, so the Capacitor must report exactly twice its bare
// damage and not a fraction more.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { AURA_CAP } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { BARE, MANY, REGULATOR_AURA, damageUnder } from "./aura";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a summed aura past the cap at exactly AURA_CAP", async () => {
  openYard(h);

  const capped = damageUnder(h, 5, MANY);
  await h.advance(1);
  captureStill(h, "cap");

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
