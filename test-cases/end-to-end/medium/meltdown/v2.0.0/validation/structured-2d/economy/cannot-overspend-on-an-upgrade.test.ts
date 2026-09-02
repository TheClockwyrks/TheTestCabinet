// Meltdown — economy/cannot-overspend-on-an-upgrade: an upgrade the money cannot
// cover changes nothing.
//
// `specs/building.md`: "An upgrade takes effect only when the tower is below
// level `3` and the current money is at least the cost. Then the money falls by
// exactly that cost, the cost is added to the tower's `spent` ... An upgrade that
// is unaffordable, or one asked of a level III tower, changes nothing at all."
// The cost is `round(buildCost * UPGRADE_COST_MULT[level - 1])`, which for the
// Arc's `15` at level `1` is `15`.
//
// THE MONEY IS ONE SHORT OF THE COST, which is the tightest case there is and the
// one a build is likeliest to have got wrong: the purse holds `14`.
//
// THE UPGRADE IS PROVED AVAILABLE AFTERWARD, and without that this point would
// decide nothing. A build whose upgrade never fires at all — because it demands a
// selection, or because it was never wired up — would pass a check that only ever
// looked at the unaffordable case. So the same tower is upgraded twice: once a
// single unit short, which must change nothing, and then with the cost exactly on
// hand, where `specs/building.md`'s "at least the cost" makes it take effect. The
// second reading is this point's precondition; the first is its verdict.
//
// THREE THINGS ARE READ, BECAUSE "CHANGES NOTHING AT ALL" IS THREE THINGS: the
// level did not move, the money did not move, and the tower's `spent` did not
// move. A build that banks the cost against the tower without charging the purse,
// or charges the purse without raising the level, fails on the one it got wrong.
//
// THE TOWER IS POSED WITH `addTower`, which "costs nothing, spends nothing, and
// runs no placement check" and starts the tower at "level `1` ... with `spent`
// equal to its build cost" (`specs/instrumentation.md`) — so the level this
// upgrade is refused from, and the `spent` it must not add to, are the ones a
// freshly placed tower carries. Nothing else stands on the floor and no frame of
// game time is spent before the refusal, so nothing but the upgrade can move
// anything this point reads.
//
// WHAT EVERY WRONG MODEL READS. A build that upgrades anyway reads level `2`; one
// that charges the purse and refuses the level reads money `-1`, or `0` if it
// clamps; one that adds the cost to `spent` before checking the purse reads
// `spent` `30`. Only `(1, 14, 15)` passes.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, upgradeCost } from "../constants";
import { assertEqual, assertTrue, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerById,
  type Harness,
  type MeltdownSnapshot,
  type TowerSnapshot,
  type TowerType,
} from "../harness";

/** The type whose upgrade is refused. */
const TYPE: TowerType = "arc";

/** The footprint's top-left tile: open floor, well clear of every opening. */
const SPOT = { col: 20, row: 12 } as const;

/** What `specs/building.md` charges to take it from level I to level II. */
const COST = upgradeCost(TOWER_DEFS[TYPE], 1);

/**
 * The purse the upgrade is refused with: one short of the cost.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number
 * and `specs/building.md` fixes the comparison exactly, so one unit short is
 * unaffordable.
 */
const SHORT_PURSE = COST - 1;

/**
 * The level a posed tower stands at, and the level a refused upgrade leaves it
 * at.
 */
const LEVEL_ONE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The posed tower, as the snapshot reports it.
 *
 * A roster that lost the tower this point posed is a build that removed a tower
 * nobody sold, which is a different fault from the one under test — so it fails
 * here naming what was expected rather than throwing a `TypeError` further down.
 */
function posedTower(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(
      `the posed tower, id ${String(id)}, still on the floor ` +
        "(specs/instrumentation.md)",
      "no tower on the roster carries that id",
    );
  }
  return tower;
}

it("refuses an upgrade the money cannot cover, and changes nothing at all", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, SPOT.col, SPOT.row);
  const posed = posedTower(h.snapshot(), id);

  h.debug.setMoney(SHORT_PURSE);
  h.debug.upgradeTower(id);
  await h.advance(1);

  captureStill(h, "refused");
  const refused = h.snapshot();
  const tower = posedTower(refused, id);

  h.debug.setMoney(COST);
  h.debug.upgradeTower(id);
  const upgraded = posedTower(h.snapshot(), id);

  assertTrue(
    upgraded.level > LEVEL_ONE,
    "precondition: the same upgrade takes effect with the cost on hand",
  );
  assertEqual(
    tower.level,
    LEVEL_ONE,
    "the level the refused upgrade left the tower at",
  );
  assertEqual(
    refused.money,
    SHORT_PURSE,
    "the money left after the refused upgrade",
  );
  assertEqual(
    tower.spent,
    posed.spent,
    "the money the refused upgrade banked against the tower",
  );
});
