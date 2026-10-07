// Meltdown — controls/upgrade-control: the panel's Upgrade control raises the
// selected tower.
//
// THE RULE. specs/hud.md gives the control: the inspector "offers two actions,
// Upgrade drawn with its cost and Sell drawn with its refund".
// specs/controls.md answers a press and release inside a panel control as "That
// control is operated", and specs/building.md says what an upgrade does: it
// "raises the selected tower one level, from `1` to `2` and from `2` to `3`", and
// "the money falls by exactly that cost".
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that raises
// the level and charges nothing has a free upgrade; one that charges and raises
// nothing has taken the player's money for nothing.
//
// THE CONTROL AND THE KEY ARE SEPARATE ITEMS. specs/controls.md requires that
// "Every interaction and every menu is reachable with the pointer alone", so a
// build with a working KeyU and a dead Upgrade control cannot be played on a
// touchscreen; `controls.upgrade-key` reads the key.
//
// THE COST TABLE IS NOT ON TRIAL HERE. `building.upgrade-costs`,
// `building.upgrade-stops-at-three`, `building.upgrade-refused-when-unaffordable`
// and `building.upgrade-changes-the-stats` own the arithmetic, the ceiling, the
// boundary and the consequences. This item reads that the rectangle the panel
// reported reaches the action, against the one figure specs/building.md fixes for
// the step it drives — written out below from the specification's own arithmetic.
//
// THE RECTANGLE IS THE BUILD'S OWN, and a missing one is a failure rather than a
// null to tolerate: specs/instrumentation.md reports `upgrade` as null only "when
// no tower is selected", so a scenario with a tower selected that finds no Upgrade
// control has found a missing control.
//
// THE MONEY IS POSED WELL CLEAR OF THE COST, at twice it, so specs/building.md's
// "at least the cost" boundary is not what this reading rests on.
//
// THE TOWER IS POSED AND SELECTED, NOT PLACED AND NOT TAPPED, at level I — which is
// the level `addTower` leaves it at, so the step driven is the `1` to `2` step. Its
// anchor is a quiet one clear of both vent-to-exhaust corridors.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TOWER_DEFS, UPGRADE_COST_MULT } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  tapControl,
  towerById,
  type Harness,
} from "../harness";
import { QUIET_SITE, requireControl } from "./scene";

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

/**
 * What the level I to II step costs, by specs/building.md's own arithmetic:
 * `round(buildCost * UPGRADE_COST_MULT[level - 1])` at level `1`.
 */
const COST = Math.round(TOWER_DEFS[TYPE].cost * UPGRADE_COST_MULT[0]);

/** The money the run is posed with: twice that cost. */
const PURSE = 2 * COST;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the selected tower's level and takes its cost when the reported Upgrade rectangle is tapped", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setSelected(id);
  h.debug.setMoney(PURSE);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    towerById(before, id)?.level,
    1,
    "the level the posed tower stands at",
  );

  await tapControl(
    h,
    requireControl(before, "upgrade", "tapping the Upgrade control"),
  );
  captureStill(h, "upgraded");

  const after = h.snapshot();
  assertEqual(
    towerById(after, id)?.level,
    2,
    "the selected tower's level after a press and release inside the reported upgrade rectangle, from level 1",
  );
  assertEqual(
    after.money,
    PURSE - COST,
    `the money left after the tap, from ${PURSE} with the step costing ${COST}`,
  );
});
