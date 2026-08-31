// Meltdown — instrumentation/add-tower-costs-nothing: `addTower` builds a floor
// without touching the economy, and without asking the placement check first.
//
// THE RULE. `specs/instrumentation.md`: "`addTower(type, col, row, rotation)` Adds
// one tower ... It costs nothing, spends nothing, and runs no placement check."
// `place` is the operation that does both — "The money falls by exactly the type's
// build cost" and it "Commits the held preview at its current footprint if
// `build.valid` is true" (`specs/building.md`) — and `addTower` is deliberately
// not it.
//
// WHY THIS IS THE PROPERTY EVERY SUITE LEANS ON. A posed floor is a PRECONDITION,
// not a purchase. `poseTower` is how eighteen groups arrange their scenarios, and
// a Lance costs `150` against Containment Medium's `250` of starting money
// (`specs/towers.md`, `specs/modes.md`), so a build whose `addTower` charged for
// what it built would refuse the third tower of any scenario that wanted three —
// and every check that then measured a two-tower floor would read the wrong
// number without ever seeing an error. Worse, a build that ran the placement check
// would refuse a wall laid across a corridor whenever the check's own money
// happened to be short, which is exactly the arrangement the mazing group is made
// of.
//
// THE DISTINGUISHING POSE IS AN EMPTY PURSE. `specs/building.md` makes money at
// least the build cost one of the six conditions a footprint must satisfy, and the
// cheapest tower on the roster costs `15` (`specs/towers.md`), so at `0` money
// EVERY footprint on the floor fails that condition. A build that ran the check
// builds nothing there; a build that charged goes negative or refuses, and
// `specs/economy.md` forbids the first. Either way it reads as a floor this check
// did not pose.
//
// AND THE OTHER DIRECTION IS READ TOO: a purse with money in it must still be
// untouched afterwards, because a build that charged only when it could afford to
// would pass the empty-purse reading on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TOWER_DEFS, type TowerType } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** The floor posed: three of the roster's dearer entries. */
const POSED: readonly TowerType[] = ["lance", "bloom", "flak"];

/** A purse posed to a figure no accident could produce. */
const POSED_MONEY = 4137;

/**
 * The purse the second reading poses.
 *
 * `0` is below every build cost on the roster — the cheapest is the Arc's `15`
 * (`specs/towers.md`) — so condition 4 of `specs/building.md`'s placement check
 * fails for every type at every footprint.
 */
const EMPTY_PURSE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends nothing for the towers it builds", async () => {
  await startRun(h);
  await h.debug.setMoney(POSED_MONEY);

  for (const [index, type] of POSED.entries()) {
    const site = freeSite(index);
    await h.debug.addTower(type, site.col, site.row, 0);
  }

  await h.advance(1);
  const s = await h.snapshot();
  assertLength(s.towers, POSED.length, "the towers addTower built");
  assertEqual(
    s.money,
    POSED_MONEY,
    "the money after addTower built three towers",
  );
});

it("builds on a footprint the placement check would refuse for want of money", async () => {
  await startRun(h);
  await h.debug.setMoney(EMPTY_PURSE);

  const site = freeSite(0);
  const type: TowerType = "lance";
  await h.debug.addTower(type, site.col, site.row, 0);

  await h.advance(1);
  await captureStill(h, "posed");

  const s = await h.snapshot();
  assertLength(s.towers, 1, "the tower addTower built on an empty purse");
  const built = requireTower(
    s,
    s.towers[0].id,
    "the tower posed on an empty purse",
  );
  assertEqual(built.type, type, "the type addTower was asked for");
  assertEqual(built.col, site.col, "the footprint's column");
  assertEqual(built.row, site.row, "the footprint's row");
  assertEqual(
    built.spent,
    TOWER_DEFS[type].cost,
    "the tower's spent, which addTower sets to its build cost",
  );
  assertEqual(
    s.money,
    EMPTY_PURSE,
    "the money after addTower built on an empty purse",
  );
});
