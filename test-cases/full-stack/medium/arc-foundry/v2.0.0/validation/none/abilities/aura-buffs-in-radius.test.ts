// abilities/aura-buffs-in-radius — a structure inside the aura hits harder.
//
// specs/components.md fixes the aura: "Every firing structure whose center lies
// within `auraRadius` of the source deals `1 + auraBonus` times its damage", and
// `REGULATOR_AURA` gives the Scrap Regulator a radius of `90` and a bonus of
// `+10%`. It fixes the reading too: "An aura-buffed damage figure is not
// rounded", and specs/instrumentation.md reports `damage` as "the structure's
// effective per-shot damage, including any aura buff on it, unrounded".
//
// The yard holds one Scrap Regulator and one Scrap Capacitor, their centres eighty
// apart, and one held unit inside the Capacitor's radius. Two readings decide it,
// because a build can report a buffed figure and fire an unbuffed shot: the
// `damage` the Capacitor reports, and the health one of its shots actually
// removes. Both are `6.6` — the unrounded product — so a build that rounds to `7`
// fails as squarely as one that ignores the aura.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { componentDamage, REGULATOR_AURA } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { awaitImpact } from "./impact";

/** Centres eighty apart, inside the Scrap Regulator's `90`. */
const REGULATOR = { col: 10, row: 10 };
const CAPACITOR = { col: 14, row: 10 };

/** The tiers this is read at. */
const REGULATOR_TIER = 1;
const CAPACITOR_TIER = 1;

/** Inside the Scrap Capacitor's `100`. */
const TARGET_RANGE = 70;

/** The buffed figure: the Capacitor's damage times one plus the Scrap bonus. */
const BONUS = REGULATOR_AURA[REGULATOR_TIER - 1]!.bonus;
const BUFFED = componentDamage("capacitor", CAPACITOR_TIER) * (1 + BONUS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports and fires 1 + auraBonus times the base damage, unrounded", async () => {
  await openYard(h, { wave: 1 });
  await standComponent(
    h,
    "regulator",
    REGULATOR_TIER,
    REGULATOR.col,
    REGULATOR.row,
  );
  const id = await standComponent(
    h,
    "capacitor",
    CAPACITOR_TIER,
    CAPACITOR.col,
    CAPACITOR.row,
  );
  const structure = structureById(await h.snapshot(), id);
  const target = await parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  assertCloseTo(
    structure.damage,
    BUFFED,
    6,
    `the damage a Capacitor reports inside a Scrap Regulator's ` +
      `${REGULATOR_AURA[REGULATOR_TIER - 1]!.radius} radius: its ` +
      `${componentDamage("capacitor", CAPACITOR_TIER)} times ${1 + BONUS}, ` +
      `unrounded (specs/components.md)`,
  );

  const before = await h.snapshot();
  const after = await captureReplay(h, "aura", () => awaitImpact(h, target));
  assertCloseTo(
    unitById(before, target).hp - unitById(after, target).hp,
    BUFFED,
    6,
    "the health one buffed shot removed, against the figure the structure " +
      "reports",
  );
});
