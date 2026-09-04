// building/upgrade-costs — an upgrade is reported and charged at its multiple of
// the build cost.
//
// specs/building.md, Upgrading:
//
//   upgradeCost = round(buildCost * UPGRADE_COST_MULT[level - 1])
//
// with `UPGRADE_COST_MULT` "1.0 at level 1 and 1.8 at level 2", and "then the
// money falls by exactly that cost". A tower at MAX_LEVEL reports an
// `upgradeCost` of 0, which `building/upgrade-stops-at-three` decides.
//
// TWO READINGS PER STEP, and both are needed. `upgradeCost` is what the panel shows
// the player before they commit, and the balance is what they are actually charged;
// a build that displays one figure and charges another is exactly the defect this
// item exists to catch, and the failure names which of the two was wrong.
//
// A RIME IS UPGRADED RATHER THAN AN ARC. The level-II cost is `1.0` times the build
// cost for every type, so the level-III figure is the one that distinguishes, and
// the Rime's 45 makes both figures unmistakable: 45 to reach II and 81 to reach III
// are distinct from each other, from the build cost of every other tower, and from
// every refund in this group. A build charging one flat price per upgrade, or the
// build cost twice, reads a different balance at the second step.
//
// THE ROUNDING IS NOT WHAT IS BEING DISTINGUISHED HERE, and it cannot be: `1.8`
// times any of the eight build costs specs/towers.md fixes is a whole number, so
// no conformant build ever rounds. `round` is written out in `upgradeCost` below
// all the same, because the specification states it and this file asserts the
// specification.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TOWER_DEFS, upgradeCost } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { FREE_SITE } from "./sites";

/** The tower upgraded, on a quiet anchor, and its build cost. */
const HELD = "rime";
const AT = FREE_SITE;
const DEF = TOWER_DEFS[HELD];

/** What specs/building.md's formula gives each step. */
const TO_TWO = upgradeCost(DEF, 1);
const TO_THREE = upgradeCost(DEF, 2);

/** A round purse, far above both, so the arithmetic in a failure is legible. */
const PURSE = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports and charges each upgrade at its multiple of the build cost", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);

  assertEqual(
    towerOf(h.snapshot(), id).upgradeCost,
    TO_TWO,
    `the upgradeCost a level-I ${HELD} reports, 1.0 times its build cost of ${DEF.cost}`,
  );

  h.debug.upgradeTower(id);
  const afterFirst = h.snapshot();
  assertEqual(
    afterFirst.money,
    PURSE - TO_TWO,
    `the balance after taking a ${HELD} to level II at ${TO_TWO}`,
  );
  assertEqual(
    towerOf(afterFirst, id).upgradeCost,
    TO_THREE,
    `the upgradeCost a level-II ${HELD} reports, 1.8 times its build cost of ${DEF.cost}`,
  );

  h.debug.upgradeTower(id);
  const afterSecond = h.snapshot();

  await h.advance(1);
  captureStill(h, "cost");

  assertEqual(
    afterSecond.money,
    PURSE - TO_TWO - TO_THREE,
    `the balance after taking the same ${HELD} on to level III at ${TO_THREE}`,
  );
});
