// building/upgrade-stops-at-three — level III is the ceiling, and a tower there
// reports no upgrade left.
//
// specs/building.md, Upgrading: "A tower at MAX_LEVEL (3) reports an upgradeCost of
// 0", and "an upgrade ... asked of a level III tower changes nothing at all".
// specs/towers.md, Levels: "Every tower runs at level 1, 2, or 3, and MAX_LEVEL is
// 3."
//
// THE MONEY IS FAR ABOVE ANY COST, which is the whole point of the posing: the
// refusal has to come from the ceiling and not from the purse, so a build that
// stopped at three only because it ran out of money is not credited with the rule.
// `building/upgrade-refused-when-unaffordable` is the other half of that pair.
//
// THE LEVEL IS POSED WITH `setTowerLevel`, the atom, which spends nothing while
// every stat specs/towers.md derives from the level follows
// (specs/instrumentation.md). Reaching level III by paying for two upgrades would
// make this item fail whenever the upgrade PRICES are wrong, which is
// `building/upgrade-costs`' business, and would leave the balance moved before the
// reading that matters is taken.
//
// TWO READINGS. `upgradeCost` is 0, which is what the panel shows the player, and
// the act itself changes neither the level nor the balance.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_LEVEL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { FREE_SITE } from "./sites";

/** The tower at the ceiling, on a quiet anchor. */
const HELD = "arc";
const AT = FREE_SITE;

/** Far above every cost in the game, so the purse can never be the refusal. */
const PURSE = 10_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports no upgrade left at level III and refuses one asked for", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);
  h.debug.setTowerLevel(id, MAX_LEVEL);

  const before = towerOf(h.snapshot(), id);
  assertEqual(
    before.level,
    MAX_LEVEL,
    `the level a ${HELD} posed at MAX_LEVEL reports`,
  );
  assertEqual(
    before.upgradeCost,
    0,
    `the upgradeCost a level-${MAX_LEVEL} ${HELD} reports`,
  );

  h.debug.upgradeTower(id);
  const snapshot = h.snapshot();

  await h.advance(1);
  captureStill(h, "ceiling");

  assertEqual(
    towerOf(snapshot, id).level,
    MAX_LEVEL,
    `the level after an upgrade asked of a level-${MAX_LEVEL} tower with ${PURSE} in hand`,
  );
  assertEqual(
    snapshot.money,
    PURSE,
    `the balance after an upgrade asked of a level-${MAX_LEVEL} tower`,
  );
});
