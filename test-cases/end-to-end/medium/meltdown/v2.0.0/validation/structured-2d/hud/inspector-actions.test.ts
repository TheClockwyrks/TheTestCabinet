// hud/inspector-actions — the inspector offers Upgrade with its cost and Sell
// with its refund, and offers no rotate.
//
// THE RULE. specs/hud.md, The info panel and the inspector: the inspector "offers
// two actions, Upgrade drawn with its cost and Sell drawn with its refund, and it
// offers no rotate action, because a placed tower's orientation is fixed." The
// two figures are specs/building.md's:
//
//   upgradeCost = round(buildCost * UPGRADE_COST_MULT[level - 1])
//   refund      = spent in full while fresh, else floor(0.7 * spent)
//
// THE POSE MAKES THE TWO FIGURES DIFFERENT NUMBERS, which is the whole reason for
// it. A Lance costs `150`; posed at level II and NOT fresh, its upgrade costs
// `round(150 * 1.8) = 270` and its refund is `floor(0.7 * 150) = 105`. A fresh
// level-I Lance would read `150` for both, and a build that drew the same figure
// on both buttons would pass. `setTowerLevel` raises the level without spending,
// so the tower's `spent` is still its build cost and the refund follows from that
// alone; `setTowerFresh` sets the freshness the refund rate turns on.
//
// EACH FIGURE IS READ INSIDE ITS OWN BUTTON, not anywhere on the panel: the panel
// reports where it drew Upgrade and where it drew Sell, so a build that drew
// `270` on the Sell button fails. That is what makes this two requirements read
// in one direction each rather than one loose reading of the strip.
//
// NO ROTATE, read in the only way it can be: `controls.rotate` is `null` when no
// placement is armed, and nothing is armed here, so the panel reports no rotate
// rectangle for a selected tower. specs/hud.md puts Rotate and Cancel among the
// PLACEMENT controls, "drawn only while a preview is held", and this point stands
// where no preview is held and a tower is selected.
//
// THE MONEY IS POSED WELL ABOVE THE UPGRADE COST, so the action is plainly
// available. Whether an unaffordable upgrade is drawn differently is nothing
// specs/hud.md states, and posing the affordable case keeps this point to the two
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { REFUND_RATE, TOWER_DEFS, upgradeCost } from "../constants";
import { assertEqual, assertNotNull, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { controlOf, readPanel, reads, runsIn } from "./panel";
import { FREE_SITE } from "./sites";

/** The tower selected. */
const TYPE = "lance" as const;
const DEF = TOWER_DEFS[TYPE];

/** The level posed, so the upgrade cost and the refund are different figures. */
const LEVEL = 2;

/** What specs/building.md charges to take it to level III. */
const UPGRADE = upgradeCost(DEF, LEVEL);

/** And what selling it pays, the tower having faced a wave. */
const REFUND = Math.floor(REFUND_RATE * DEF.cost);

/** Money well above the upgrade cost, so the action is plainly available. */
const PURSE = 1000;

/** A figure of money is whole; only a trailing decimal point is allowed for. */
const EXACT = 0.05;

/**
 * How far outside its own button a run may be anchored: six logical units.
 *
 * The same slack `hud/shop-lists-eight` allows a shop entry, and for the same
 * reason: a run is placed by its baseline anchor, which sits a few units below
 * the glyphs it carries.
 */
const MARGIN = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws 270 on Upgrade and 105 on Sell, and no rotate action", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  h.debug.setTowerLevel(id, LEVEL);
  h.debug.setTowerFresh(id, false);
  h.debug.setSelected(id);

  const runs = await readPanel(h);
  captureStill(h, "actions");
  const posed = h.snapshot();

  assertEqual(posed.selected, id, "precondition: the posed tower is selected");
  assertNull(posed.build, "precondition: no placement is armed");
  assertEqual(
    UPGRADE,
    270,
    "the upgrade cost specs/building.md gives a level-II Lance",
  );
  assertEqual(
    REFUND,
    105,
    "the refund specs/building.md gives an unfresh Lance",
  );

  assertNotNull(
    posed.controls.upgrade,
    "the panel to offer an Upgrade action while a tower is selected " +
      "(specs/hud.md)",
  );
  assertNotNull(
    posed.controls.sell,
    "the panel to offer a Sell action while a tower is selected (specs/hud.md)",
  );
  assertNull(
    posed.controls.rotate,
    "the panel to offer no rotate action for a placed tower, whose " +
      "orientation is fixed (specs/hud.md)",
  );

  const upgrade = controlOf(posed.controls.upgrade, "Upgrade");
  const sell = controlOf(posed.controls.sell, "Sell");
  assertTrue(
    reads(runsIn(runs, upgrade, MARGIN), UPGRADE, EXACT),
    `the Upgrade action to be drawn with its cost of ${UPGRADE}`,
  );
  assertTrue(
    reads(runsIn(runs, sell, MARGIN), REFUND, EXACT),
    `the Sell action to be drawn with its refund of ${REFUND}`,
  );
});
