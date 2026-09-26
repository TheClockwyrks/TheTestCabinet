// Meltdown — instrumentation/clear-towers-pays-nothing: clearTowers pays no
// refund.
//
// specs/instrumentation.md, The towers: `clearTowers()` "pays no refund and
// changes neither money nor score". It is the counterpart to `sellTower`, which
// specs/building.md pays a refund for; the two must not be the same code path, and
// this point is what says so.
//
// THE FLOOR IS UPGRADED, WHICH IS WHAT MAKES A REFUND WORTH SEEING. specs/building.md
// measures a refund against "everything spent on the tower, its build cost plus
// every upgrade paid on it", in full while the tower is fresh. Three Arcs taken to
// level III through the game's own `upgradeTower` therefore each carry a `spent` of
// `15 + 15 + 27` — `57` — so a `clearTowers` that paid what selling pays would
// return `171` into the money. That is more than a quarter of the balance the leg
// opens with, so no rounding hides it.
//
// THE UPGRADES ARE THE ACT, NOT THE POSE. `setTowerLevel` "spends nothing"
// (specs/instrumentation.md), so a floor posed to level III would carry a `spent`
// of the build cost alone and a refund a third of the size. `upgradeTower` runs
// through the real upgrade code and adds each cost to `spent`, which is the floor
// a player would actually have built.
//
// THE BALANCE IS READ AFTER THE UPGRADES, so what this point asserts is that the
// clear moved nothing — never what the upgrades cost, which `economy` and
// `building` decide.
//
// AND THE SCORE IS POSED AWAY FROM ZERO. A score left at `0` cannot be told from a
// build that clears the score on a `clearTowers`, because `0` is where it would
// land either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
  type TowerType,
} from "../harness";

/** The type upgraded, the level it is taken to, and how many stand on the floor. */
const TYPE: TowerType = "arc";
const LEVEL = 3;
const COUNT = 3;

/** The purse the leg opens with: enough for every upgrade, with room to spare. */
const PURSE = 1000;

/** The score posed before the clear, so a cleared score is observable. */
const SCORE = 90210;

/** The anchors the three towers stand on: quiet floor, clear of both corridors. */
const ANCHORS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 6, row: 6 },
  { col: 10, row: 6 },
  { col: 14, row: 6 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves money and score exactly as they were when an upgraded floor is cleared", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setScore(SCORE);

  const ids = ANCHORS.map((at) => poseTower(h, TYPE, at.col, at.row));
  for (const id of ids) {
    for (let level = 1; level < LEVEL; level += 1) h.debug.upgradeTower(id);
  }
  await h.advance(1);

  // The precondition: three real level-III towers, each carrying more `spent`
  // than its build cost, so a refund would be plainly visible.
  const upgraded = h.snapshot();
  assertLength(upgraded.towers, COUNT, "precondition: the floor is built");
  for (const id of ids) {
    const tower = towerOf(upgraded, id);
    assertEqual(
      tower.level,
      LEVEL,
      `precondition: tower ${id} reached level III`,
    );
    assertGreaterThan(
      tower.spent,
      TOWER_DEFS[TYPE].cost,
      `precondition: tower ${id} has upgrades paid on it`,
    );
  }

  const money = upgraded.money;
  const score = upgraded.score;

  h.debug.clearTowers();
  await h.advance(1);
  const cleared = h.snapshot();
  captureStill(h, "balance");

  assertLength(cleared.towers, 0, "precondition: the floor really was cleared");
  assertEqual(
    cleared.money,
    money,
    "clearTowers pays no refund into the money",
  );
  assertEqual(cleared.score, score, "clearTowers changes no score");
});
