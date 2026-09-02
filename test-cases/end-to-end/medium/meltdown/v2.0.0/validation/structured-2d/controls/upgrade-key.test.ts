// Meltdown — controls/upgrade-key: KeyU upgrades the selected tower.
//
// THE RULE. specs/controls.md binds `upgrade` to `KeyU` (The bindings) and gives
// it the effect "Upgrades the selected tower" (The actions). specs/building.md
// says what an upgrade does: it "raises the selected tower one level, from `1` to
// `2` and from `2` to `3`", and "the money falls by exactly that cost". So the
// pair read here is the level the tower reached and the money the upgrade took.
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that raises
// the level and charges nothing has a free upgrade; one that charges and raises
// nothing has taken the player's money for nothing. The item's own description
// names both, and a failure names which half went wrong.
//
// THE COST TABLE IS NOT ON TRIAL HERE. `building.upgrade-costs` reads
// `round(buildCost * UPGRADE_COST_MULT[level - 1])` across levels,
// `building.upgrade-stops-at-three` the ceiling,
// `building.upgrade-refused-when-unaffordable` the boundary, and
// `building.upgrade-changes-the-stats` what the new level does to the tower's
// figures. This item reads that the KEY reaches the action, against the one figure
// specs/building.md fixes for the step it drives — and that figure is written out
// from the specification's own arithmetic below rather than taken from a helper.
//
// THE MONEY IS POSED WELL CLEAR OF THE COST. specs/building.md makes an upgrade
// take effect "only when the tower is below level `3` and the current money is at
// least the cost", so a scenario posed at exactly the cost would be reading that
// boundary as well, and a build with `>` where the specification says "at least"
// would fail here rather than at the item that owns the boundary. Twice the cost
// is comfortably clear of it and still lets the deduction be read exactly.
//
// THE TOWER IS POSED AND SELECTED, NOT PLACED AND NOT TAPPED. `addTower` puts one
// Arc on the floor at no cost and runs no placement check, and `setSelected` opens
// its inspector (specs/instrumentation.md); neither is the act this item is about.
// The anchor is a quiet one, so nothing about the floor's routes enters a reading
// about a key.
//
// AN ARC AT LEVEL I, which is the level `addTower` leaves a tower at, so the step
// driven is the `1` to `2` step and the cost is that step's.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, UPGRADE_COST_MULT } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerById,
  type Harness,
} from "../harness";
import { QUIET_SITE } from "./scene";

/** The key specs/controls.md binds `upgrade` to, as a `KeyboardEvent.code`. */
const KEY = "KeyU";

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

/**
 * What taking an Arc from level I to level II costs, by specs/building.md's own
 * arithmetic: `round(buildCost * UPGRADE_COST_MULT[level - 1])` at level `1`,
 * which the specification works out as `15`.
 */
const COST = Math.round(TOWER_DEFS[TYPE].cost * UPGRADE_COST_MULT[0]);

/**
 * The money the run is posed with: twice that cost.
 *
 * Enough that affordability is plainly not the question this item asks — the
 * "at least the cost" boundary belongs to
 * `building.upgrade-refused-when-unaffordable` — and still a figure the deduction
 * can be read against exactly.
 */
const PURSE = 2 * COST;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the selected tower's level and takes its upgrade cost when KeyU is pressed", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setSelected(id);
  h.debug.setMoney(PURSE);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.selected, id, "the selection the scenario is posed with");
  assertEqual(
    towerById(before, id)?.level,
    1,
    "the level the posed tower stands at",
  );

  await h.tap(KEY);
  captureStill(h, "upgraded");

  const after = h.snapshot();
  assertEqual(
    towerById(after, id)?.level,
    2,
    `${KEY}: the selected tower's level after one press, from level 1`,
  );
  assertEqual(
    after.money,
    PURSE - COST,
    `${KEY}: the money left after one press, from ${PURSE} with the step costing ${COST}`,
  );
});
