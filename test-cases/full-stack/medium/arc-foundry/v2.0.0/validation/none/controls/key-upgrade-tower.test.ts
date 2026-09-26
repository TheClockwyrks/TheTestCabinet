// controls/key-upgrade-tower — `KeyU` raises the selected combination tower.
//
// THE REQUIREMENT. `specs/controls.md` binds `upgrade` to `KeyU` and gives it two
// jobs: "Raises the selected combination tower's level, or refines the press when
// the selection is not a combination tower." This point decides the first.
// `specs/combinations.md` fixes the cost of each rung as a fraction of the tower's
// reference damage, and `specs/economy.md` makes upgrading a combination tower one
// of exactly two things Charge is ever spent on.
//
// HOW IT IS DECIDED. One combination tower is the only structure on an otherwise
// empty yard, at level `0`, with Charge banked well past the cost of its first
// rung, and it is selected. `KeyU` is pressed as a player presses it, a real
// browser key event through the build's own keyboard layer. The tower's level and
// the bank are read back: one rung up, and exactly the stated cost gone.
//
// WHY A NULL CORE. Its reference damage of `420` makes the first rung cost `336`,
// a figure far enough from every other number in the scenario that a build
// spending the wrong one cannot land on it by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { comboUpgradeCost, keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCombo,
  structureById,
  type Harness,
} from "../harness";

/** Where the tower stands: clear of the chain and of the yard edges. */
const ANCHOR = { col: 10, row: 0 };

/** The tower raised, and the Charge banked before the press. */
const COMBO = "nullcore";
const BANK = 5_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the selected tower one level and spends its cost on KeyU", async () => {
  await openYard(h, { charge: BANK });
  const id = await standCombo(h, COMBO, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  const posed = await h.snapshot();
  assertEqual(
    structureById(posed, id).level,
    0,
    "a combination tower standing at level 0 before the upgrade key " +
      "(specs/instrumentation.md)",
  );

  await h.tap(keyFor("upgrade"));
  await captureStill(h, "upgraded");

  const after = await h.snapshot();
  assertEqual(
    structureById(after, id).level,
    1,
    `pressing ${keyFor("upgrade")} with a combination tower selected to raise ` +
      "it by one level (specs/controls.md)",
  );
  assertEqual(
    after.charge,
    BANK - comboUpgradeCost(COMBO, 1),
    `the Charge left after buying the ${COMBO}'s first rung, which costs ` +
      `${comboUpgradeCost(COMBO, 1)} (specs/combinations.md)`,
  );
});
