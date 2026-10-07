// Meltdown — controls/upgrade-control: the panel's Upgrade control raises the
// selected tower.
//
// specs/hud.md gives the control: the inspector "offers two actions, Upgrade drawn
// with its cost and Sell drawn with its refund". specs/controls.md answers a press
// and release inside a panel control as "That control is operated", and
// specs/building.md says what an upgrade does: it "raises the selected tower one
// level, from `1` to `2` and from `2` to `3`", and "the money falls by exactly that
// cost".
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that raises the
// level and charges nothing has a free upgrade; one that charges and raises nothing
// has taken the player's money for nothing. The item's own description names both.
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS. specs/controls.md requires that
// "Every interaction and every menu is reachable with the pointer alone", so a build
// with a working `KeyU` and a dead Upgrade control cannot be played on a
// touchscreen; `controls.upgrade-key` reads the key.
//
// THE COST TABLE IS NOT ON TRIAL HERE. `building.upgrade-costs`,
// `building.upgrade-stops-at-three`, `building.upgrade-refused-when-unaffordable` and
// `building.upgrade-changes-the-stats` own the arithmetic, the ceiling, the boundary
// and the consequences. This point reads that the rectangle the panel reported
// reaches the action, against the one figure specs/building.md fixes for the step it
// drives.
//
// THE RECTANGLE IS THE BUILD'S OWN, and a missing one is a failure rather than a null
// to tolerate: specs/instrumentation.md reports `upgrade` as null only "when no tower
// is selected", so a scenario with a tower selected that finds no Upgrade control has
// found a missing control.
//
// THE MONEY IS POSED WELL CLEAR OF THE COST, at twice it, so specs/building.md's
// "at least the cost" boundary is not what this reading rests on.
//
// THE TOWER IS POSED AND SELECTED, NOT PLACED AND NOT TAPPED, at level I, which is
// the level `addTower` leaves it at — so the step driven is the `1` to `2` step. Its
// anchor is a quiet one clear of both vent-to-exhaust corridors.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, upgradeCost } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  requireControl,
  requireTower,
  startRun,
  tapControl,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

/** What the level I to II step costs, by specs/building.md's arithmetic. */
const COST = upgradeCost(TOWER_DEFS[TYPE], 1);

/** The money the run is posed with: twice that cost. */
const BUDGET = 2 * COST;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("raises the selected tower's level and takes its cost when the reported Upgrade rectangle is tapped", async () => {
  await startRun(h);
  const id = await poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setSelected(id);
  await h.debug.setMoney(BUDGET);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(
    requireTower(before, id, "the posed tower").level,
    1,
    "the level the tower is posed at",
  );

  await tapControl(
    h,
    requireControl(before, "upgrade", "tapping the Upgrade control"),
  );
  const after = await h.snapshot();
  await captureStill(h, "upgraded");

  assertEqual(
    requireTower(after, id, "the upgraded tower").level,
    2,
    "the selected tower's level after a press and release inside the reported upgrade rectangle, from level 1",
  );
  assertEqual(
    after.money,
    BUDGET - COST,
    `the money left after the tap, from ${BUDGET} with the step costing ${COST}`,
  );
});
