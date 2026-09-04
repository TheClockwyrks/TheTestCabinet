// abilities/aura-not-on-source — an aura reaches everything but its own source.
//
// specs/components.md fixes it: "An aura never buffs its own source." It is its own
// point because it is the case a build reaches by simply asking every structure
// which auras cover it — the source's own centre is trivially inside its own
// radius.
//
// Two arrangements are read, because the rule has two shapes on this yard. Two
// Scrap Regulators within reach of each other: neither fires, so neither can be
// buffed at all, and both must still report zero damage. Then a Null Core, whose
// aura is part of its own stat block, beside a Fork Array that carries no aura:
// the Fork Array is buffed by the Null Core's `+20%` and the Null Core reports its
// own damage flat. That pairing is what separates "the source is skipped" from
// "auras are not applied to towers": one of the two structures moves and the other
// does not, on one yard, in one reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  comboDamage,
  comboDef,
  createHarness,
  emptyYard,
  openYard,
  standCombo,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

/** Two Regulator footprints, centres sixty apart. */
const LEFT = { col: 10, row: 10 };
const RIGHT = { col: 13, row: 10 };

/** The tower that carries an aura, and the one that does not. */
const SOURCE = { col: 20, row: 15 };
const NEIGHBOUR = { col: 23, row: 15 };

/** The level both towers are read at. */
const LEVEL = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves an aura's own source unbuffed while its neighbour is buffed", async () => {
  openYard(h);

  // Two Regulators inside each other's radius. Neither fires, so neither is a
  // structure an aura reaches, and neither may report damage of any kind.
  const left = standComponent(h, "regulator", 1, LEFT.col, LEFT.row);
  const right = standComponent(h, "regulator", 1, RIGHT.col, RIGHT.row);
  let yard = h.snapshot();
  assertEqual(
    structureById(yard, left).damage,
    0,
    "the damage a Regulator reports inside another Regulator's radius",
  );
  assertEqual(
    structureById(yard, right).damage,
    0,
    "the damage the other Regulator of the pair reports",
  );

  // A tower whose stat block carries an aura, beside a tower that carries none.
  emptyYard(h);
  const source = standCombo(h, "nullcore", SOURCE.col, SOURCE.row, LEVEL);
  const neighbour = standCombo(
    h,
    "forkarray",
    NEIGHBOUR.col,
    NEIGHBOUR.row,
    LEVEL,
  );
  await h.advance(1);
  captureStill(h, "source");

  yard = h.snapshot();
  assertEqual(
    comboDef("nullcore").abilities.aura !== undefined,
    true,
    "the Null Core's own stat block carrying an aura (specs/combinations.md)",
  );
  const bonus = structureById(yard, source).auraBonus;

  assertCloseTo(
    structureById(yard, source).damage,
    comboDamage("nullcore", LEVEL),
    6,
    `the damage the aura's own source reports at level ${LEVEL}: its own bonus ` +
      `of ${bonus} does not apply to it (specs/components.md)`,
  );
  assertCloseTo(
    structureById(yard, neighbour).damage,
    comboDamage("forkarray", LEVEL) * (1 + bonus),
    6,
    `the damage the tower beside it reports: its level ${LEVEL} figure times ` +
      `one plus the source's ${bonus}`,
  );
});
