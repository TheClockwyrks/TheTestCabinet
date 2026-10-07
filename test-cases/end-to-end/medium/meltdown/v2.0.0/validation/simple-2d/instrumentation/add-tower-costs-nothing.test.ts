// Meltdown — instrumentation/add-tower-costs-nothing: addTower spends no money and
// runs no placement check.
//
// specs/instrumentation.md, The towers: `addTower(type, col, row, rotation)` "Adds
// one tower ... It costs nothing, spends nothing, and runs no placement check."
// That is what makes a posed floor arrangeable at all: almost every scenario in this
// suite stands a tower somewhere a player could not have afforded or could not have
// built, and none of them is allowed to be limited by the run's economy.
//
// THE FOOTPRINT IS ONE THE REAL CHECK REFUSES, AND REFUSES FOR THE MONEY. It is
// pinned to the money by reading the same footprint three times through the game's
// own preview, whose `build.valid` "answers that through the same check"
// (specs/instrumentation.md, Building): refused on `137`, accepted the moment the
// purse covers the Lance's `150` build cost, refused again when the purse goes back.
// Every other condition specs/building.md lists is satisfied throughout and
// unchanged between the three readings — the footprint is on the grid, its tiles are
// open, no unit stands on them, Containment fixes no build zone, and the quiet corner
// seals nothing — so the money is the only thing that moved and therefore the only
// thing the refusal can be about.
//
// A PURSE OF `137` RATHER THAN AN EMPTY ONE. specs/economy.md never lets the money go
// below `0`, so a purse of `0` cannot tell a build that spends nothing apart from one
// that spent what it had and clamped. `137` is short of the Lance's cost by `13` and
// is not a figure anything else in this run derives, so a build that deducts the cost,
// deducts a part of it, or resets the purse all read something other than `137`.
//
// AND THE TOWER REALLY LANDS, on the exact footprint it was named for, so a build
// that satisfies "spends nothing" by declining to build anything fails here too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  lastTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { GUN } from "./scenes";

/** The type built: the roster's largest footprint and its dearest tier. */
const TYPE: TowerType = "lance";

/** The purse the leg is driven on, short of that type's build cost. */
const PURSE = 137;

/** The rotation the tower is posed at, off the `0` a build might default to. */
const ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds on a footprint the placement check refuses for want of money, and spends nothing", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(GUN.col, GUN.row);
  await h.advance(1);

  // The same footprint, three readings: the only thing that moves is the purse.
  assertEqual(
    h.snapshot().build?.valid,
    false,
    `the placement check refuses the footprint on ${PURSE}`,
  );
  h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  await h.advance(1);
  assertEqual(
    h.snapshot().build?.valid,
    true,
    "the same footprint is accepted the moment the purse covers the build cost",
  );
  h.debug.setMoney(PURSE);
  await h.advance(1);
  assertEqual(
    h.snapshot().build?.valid,
    false,
    `and refused again once the purse goes back to ${PURSE}`,
  );

  // And `addTower` builds on it anyway, without touching the purse.
  h.debug.addTower(TYPE, GUN.col, GUN.row, ROTATION);
  const posed = h.snapshot();
  await h.advance(1);
  captureStill(h, "posed");

  assertLength(posed.towers, 1, "the tower is on the floor");
  const tower = lastTower(posed);
  assertEqual(tower.type, TYPE, "the posed tower's type");
  assertEqual(tower.col, GUN.col, "the posed tower's footprint column");
  assertEqual(tower.row, GUN.row, "the posed tower's footprint row");
  assertEqual(tower.rotation, ROTATION, "the posed tower's placement rotation");
  assertEqual(posed.money, PURSE, "addTower spends nothing");
});
