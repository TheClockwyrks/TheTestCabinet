// abilities/aura-not-outside — the aura's radius is a real bound.
//
// specs/components.md fixes the aura by its radius: "Every firing structure whose
// center lies within `auraRadius` of the source deals `1 + auraBonus` times its
// damage", and `REGULATOR_AURA` gives the Scrap Regulator `90`. A build that
// applies the bonus to the whole yard turns one cheap support piece into a global
// multiplier, which is a different economy from the one the table describes.
//
// This is the other direction of `aura-buffs-in-radius`, and its own point. One
// Scrap Regulator and one Scrap Capacitor stand with their centres a hundred
// apart, ten past the radius the Regulator itself reports, and nothing else is on
// the yard. The Capacitor must report its bare `6`. The Regulator's own reported
// radius is read alongside it, so the failure says whether the bound was wrong or
// the source was projecting nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { componentDamage, REGULATOR_AURA } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
  openYard,
  standComponent,
  structureById,
} from "../harness";

/** Centres a hundred apart, past the Scrap Regulator's `90`. */
const REGULATOR = { col: 10, row: 10 };
const CAPACITOR = { col: 15, row: 10 };

/** The tiers this is read at. */
const REGULATOR_TIER = 1;
const CAPACITOR_TIER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a structure whose centre is past the radius on its bare damage", async () => {
  openYard(h);
  const source = standComponent(
    h,
    "regulator",
    REGULATOR_TIER,
    REGULATOR.col,
    REGULATOR.row,
  );
  const id = standComponent(
    h,
    "capacitor",
    CAPACITOR_TIER,
    CAPACITOR.col,
    CAPACITOR.row,
  );

  await h.advance(1);
  captureStill(h, "outside");

  const yard = h.snapshot();
  const regulator = structureById(yard, source);
  const capacitor = structureById(yard, id);

  assertEqual(
    regulator.auraRadius,
    REGULATOR_AURA[REGULATOR_TIER - 1]!.radius,
    "the radius the Scrap Regulator projects (specs/components.md)",
  );
  assertCloseTo(
    capacitor.damage,
    componentDamage("capacitor", CAPACITOR_TIER),
    6,
    `the damage a Capacitor reports with its centre ` +
      `${distance({ x: regulator.cx, y: regulator.cy }, { x: capacitor.cx, y: capacitor.cy })} ` +
      `from a Regulator whose radius is ${regulator.auraRadius}: no bonus at ` +
      `all (specs/components.md)`,
  );
});
