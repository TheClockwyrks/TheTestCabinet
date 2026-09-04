// hud/inspector-actions — the inspector offers Upgrade with its cost and Sell
// with its refund, and offers no rotate action.
//
// THE RULE. specs/hud.md, The info panel and the inspector: the inspector "offers
// two actions, Upgrade drawn with its cost and Sell drawn with its refund, and it
// offers no rotate action, because a placed tower's orientation is fixed."
// specs/instrumentation.md reports each of the four as a rectangle, `upgrade` and
// `sell` being `null` "when no tower is selected" and `rotate` and `cancel`
// `null` "when no placement is armed".
//
// FOUR READINGS, AND THE NEGATIVE IS AS MUCH THE ITEM AS THE POSITIVES. Both
// actions are offered; each carries its own figure; and no rotate action appears
// beside them. The last is what specs/building.md's fixed orientation costs the
// panel, and a build that reuses the placement's Rotate control on a selected
// tower fails it.
//
// EACH FIGURE IS ATTRIBUTED TO THE ACTION IT BELONGS TO, through the rectangle
// the build itself reported for that action, which is what lets specs/hud.md fix
// WHAT the inspector offers and leave WHERE to the build. A `270` anywhere in the
// strip is not the upgrade's cost: the check requires it on the Upgrade control,
// and the refund on the Sell control, so a build that draws both figures under
// one of them has not drawn each action with its own.
//
// THE TWO FIGURES ARE POSED APART, AND NEITHER IS THE OTHER. A Bloom costs 150
// (specs/towers.md); at level II its next upgrade costs `round(150 * 1.8)`, which
// is 270 (specs/building.md, Upgrading), and once it is no longer fresh its
// refund is `floor(0.7 * 150)`, which is 105 (specs/building.md, Selling). A
// build that draws the same figure under both actions, or the build cost under
// either, reads wrong under at least one of them. The level and the freshness are
// both posed rather than played into, because this point is about the panel:
// `setTowerLevel` "spends nothing" and `setTowerFresh` sets the flag alone
// (specs/instrumentation.md).
//
// THE FIGURES ARE READ FROM THE SNAPSHOT RATHER THAN COMPUTED. This item's domain
// is `presentation`, and its requirement is that the panel DRAWS the tower's cost
// and its refund — so what the panel is held to is the `upgradeCost` and `refund`
// the build itself reports for that tower. Whether those figures are the ones
// specs/building.md derives is `building.upgrade-costs`,
// `building.sell-refunds-seventy-percent` and `building.refund-includes-upgrades`,
// and a build that got them wrong is failed there rather than twice.
//
// THE PHASE IS `wave`, so the strip carries no build countdown and no next-wave
// preview, and nothing is armed, so the two placement controls are due to be
// absent for exactly the reason specs/instrumentation.md gives.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
  type RectSnapshot,
} from "../harness";
import { readPanel, readsNumber, runsInside, textsOf } from "./read";

/** The tower inspected: the level and the freshness posed put its two figures
 * far apart and make neither of them its build cost. */
const TYPE = "bloom";
const LEVEL = 2;
const FRESH = false;

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/** The run the panel is read on, posed to carry neither figure elsewhere. */
const MODE = "containment";
const DIFFICULTY = "hard";
const MONEY = 9999;
const LIVES = 17;
const WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("offers Upgrade with its cost and Sell with its refund, and no rotate action", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  const id = poseTower(h, TYPE, AT.col, AT.row);
  h.debug.setTowerLevel(id, LEVEL);
  h.debug.setTowerFresh(id, FRESH);
  h.debug.setSelected(id);

  const { runs, controls } = await readPanel(h);
  captureStill(h, "actions");
  const tower = towerOf(h.snapshot(), id);

  assertNotNull(
    controls.upgrade,
    "a hit rectangle for the Upgrade action, which the inspector offers on a " +
      "selected tower (specs/hud.md, The info panel and the inspector; " +
      "specs/instrumentation.md, controls)",
  );
  assertNotNull(
    controls.sell,
    "a hit rectangle for the Sell action, which the inspector offers on a " +
      "selected tower (specs/hud.md, The info panel and the inspector; " +
      "specs/instrumentation.md, controls)",
  );
  assertNull(
    controls.rotate,
    "no rotate action beside a selected tower's Upgrade and Sell: a placed " +
      "tower's orientation is fixed, so the inspector offers none " +
      "(specs/hud.md, The info panel and the inspector; specs/building.md)",
  );

  const upgrade = controls.upgrade as RectSnapshot;
  const sell = controls.sell as RectSnapshot;
  const onUpgrade = runsInside(runs, upgrade);
  const onSell = runsInside(runs, sell);

  assertTrue(
    readsNumber(onUpgrade, tower.upgradeCost),
    `the upgrade's cost of ${tower.upgradeCost}, which snapshot() reports for ` +
      `this level-${LEVEL} ${TYPE}, drawn on the Upgrade action itself ` +
      `(specs/hud.md, The info panel and the inspector); that control drew ` +
      `${JSON.stringify(textsOf(onUpgrade))}`,
  );
  assertTrue(
    readsNumber(onSell, tower.refund),
    `the sale's refund of ${tower.refund}, which snapshot() reports for this ` +
      `tower, drawn on the Sell action itself (specs/hud.md, The info panel ` +
      `and the inspector); that control drew ` +
      `${JSON.stringify(textsOf(onSell))}`,
  );
});
