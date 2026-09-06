// combos/crit — a critical hit removes critMult times the shot's damage.
//
// specs/components.md: "Each shot has the stated chance to deal `critMult` times
// its damage instead of its damage. The chance is rolled independently on every
// shot." specs/combinations.md gives the Slag Driver `crit(0.25, 2.0)`, a
// reference damage of `120` and a cadence of `0.6` /s, and neither file states any
// rounding of the product. The Slag Driver is the one tower in the table whose
// only ability is the crit, so every point it tallies is a shot's and none of it
// is a burn's.
//
// THE OUTCOME IS POSED, NOT WAITED FOR. `specs/instrumentation.md` carries
// `setNextCrit` for exactly this: it fixes whether the structure's next shot
// crits and nothing else, and the shot itself is launched, flown and landed by
// the real systems. So one tower is armed to crit, its first shot is read off its
// damage tally, and then it is armed not to crit and its next shot is read the
// same way. Each reading is one shot's figure and nothing else.
//
// THE TARGET IS THE ONE UNIT THAT CANNOT DIE. Reading two shots needs a target
// that outlives them and never changes what the tower is aiming at, and
// specs/enemies.md gives exactly one: the Overload Dynamo, which "cannot be
// killed", carries no depleting health, and takes every point dealt to it as a
// tally rather than as damage. It is held frozen inside the tower's reach, so it
// neither walks out of range nor grounds out.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { comboDamage, comboDef, structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standCombo,
  structureById,
  ticks,
  type Harness,
} from "../harness";

const TOWER = comboDef("slagdriver");
/** The multiplier of the `crit(chance, multiplier)` its row names. */
const CRIT_MULT = TOWER.abilities.crit!.multiplier;
const LEVEL = 0;

/** Where the tower stands, clear of the Substation's chain. */
const ANCHOR = { col: 12, row: 12 };
/** Where the target is held: forty units off the tower's center, well inside its reach. */
const TARGET = {
  x: structureCenter(ANCHOR.col, ANCHOR.row).x + 40,
  y: structureCenter(ANCHOR.col, ANCHOR.row).y,
};

/** How long each shot is waited for, in seconds: several cadences of `0.6` /s. */
const PATIENCE = 6;

/** Digits a tally is held to: a product the specs leave unrounded, read exactly. */
const DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Drive until the tower's tally moves past `from`, and hand back what it moved by. */
async function nextShot(id: number, from: number): Promise<number> {
  const landed = await h.until(
    (s) => structureById(s, id).damageDealt > from,
    { maxFrames: ticks(PATIENCE), poll: 1 },
  );
  assertEqual(
    landed.hit,
    true,
    `the ${TOWER.name} to land a shot on the held target within ${PATIENCE}s`,
  );
  return structureById(landed.snapshot, id).damageDealt - from;
}

it("removes critMult times the damage on a crit, and the damage alone otherwise", async () => {
  openYard(h);
  const id = standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row, LEVEL);
  parkUnit(h, "overload", TARGET);
  const damage = comboDamage(TOWER.id, LEVEL);

  h.debug.setNextCrit(id, true);
  const critical = await captureReplay(h, "crit", () => nextShot(id, 0));
  assertCloseTo(
    critical,
    damage * CRIT_MULT,
    DIGITS,
    `the damage a shot armed to crit removed, against critMult (${CRIT_MULT}) ` +
      `times the ${TOWER.name}'s ${damage} (specs/components.md)`,
  );

  h.debug.setNextCrit(id, false);
  const ordinary = await nextShot(
    id,
    structureById(h.snapshot(), id).damageDealt,
  );
  assertCloseTo(
    ordinary,
    damage,
    DIGITS,
    `the damage a shot armed not to crit removed, against the ${TOWER.name}'s ` +
      `${damage} (specs/components.md)`,
  );
});
