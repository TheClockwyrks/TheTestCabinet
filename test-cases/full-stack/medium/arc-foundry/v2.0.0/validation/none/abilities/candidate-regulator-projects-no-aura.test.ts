// abilities/candidate-regulator-projects-no-aura — a candidate carries, but does
// not project.
//
// `specs/components.md`: "An aura projects from a harvested Regulator. A candidate
// reads the aura it would carry once harvested and projects none while it stands
// as a candidate, so no structure's damage is raised by a candidate Regulator."
// The reading side is `specs/hud.md`'s: a selected candidate shows "its live
// damage, range, fire rate", and a Regulator shows "its aura radius and bonus in
// place of damage, range, and fire rate" — so the candidate is telling the player
// what keeping it would buy.
//
// SO THIS IS THE EDGE THE RULE IMPLIES AND NOTHING ELSE READS. `aura-buffs-in-
// radius` and its four siblings all pose harvested Regulators. A build that
// recomputes coverage over every structure on the yard buffs the Capacitor the
// moment the rock lands, and the player sees a damage figure that falls back the
// instant they keep a different candidate — which is the opposite of what the
// panel is for.
//
// BOTH SIDES, ONE POSE. One Capacitor, one candidate Regulator inside its radius,
// nothing else. The Capacitor's damage is read while the Regulator is a candidate
// and again once it has been harvested, and the candidate's own reported aura is
// read in between, because "reads the aura it would carry" is half the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { REGULATOR_AURA, componentDamage } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

/** Centres eighty apart, inside the Scrap Regulator's `90`. */
const REGULATOR = { col: 10, row: 10 };
const CAPACITOR = { col: 14, row: 10 };

const TIER = 1;
const AURA = REGULATOR_AURA[TIER - 1]!;

/** The Capacitor's damage, unbuffed and buffed. */
const PLAIN = componentDamage("capacitor", TIER);
const BUFFED = PLAIN * (1 + AURA.bonus);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no damage until the Regulator is harvested", async () => {
  await openYard(h);
  const capacitor = await standComponent(
    h,
    "capacitor",
    TIER,
    CAPACITOR.col,
    CAPACITOR.row,
  );
  const candidate = await standCandidate(
    h,
    "regulator",
    TIER,
    REGULATOR.col,
    REGULATOR.row,
  );

  await h.advance(1);
  await captureStill(h, "candidate");

  const standing = await h.snapshot();
  assertEqual(
    structureById(standing, candidate).kind,
    "candidate",
    "the Regulator to be standing as a candidate",
  );
  assertCloseTo(
    structureById(standing, capacitor).damage,
    PLAIN,
    6,
    `the Capacitor's damage inside a CANDIDATE Regulator's ${AURA.radius} ` +
      "radius: a candidate projects no aura (specs/components.md)",
  );
  assertCloseTo(
    structureById(standing, candidate).auraRadius,
    AURA.radius,
    6,
    "the aura radius the candidate reads, which is the one it would carry " +
      "once harvested (specs/components.md)",
  );
  assertCloseTo(
    structureById(standing, candidate).auraBonus,
    AURA.bonus,
    6,
    "the aura bonus the candidate reads",
  );

  // Harvesting it is what turns the aura on.
  await h.debug.keep(candidate);
  assertCloseTo(
    structureById(await h.snapshot(), capacitor).damage,
    BUFFED,
    6,
    `the Capacitor's damage once that Regulator is harvested: its ${PLAIN} ` +
      `times ${1 + AURA.bonus}, unrounded (specs/components.md)`,
  );
});
