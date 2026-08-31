// Meltdown — controls/no-auto-repeat: a key held down fires its action once.
//
// specs/controls.md states it flatly: "Every action is read as a press edge and
// fires once per press. Holding a key down fires its action exactly once, however
// long it is held."
//
// WHAT A HELD KEY IS, HERE. The key goes down, a full second of game time is
// driven with it still down, and only then does it come up. That is the shape a
// build reading its keyboard the second conformant way — comparing held state at
// the top of each frame — turns into a hundred and twenty firings, and it is the
// defect this point exists to catch: a rotate that spins, an upgrade that empties
// the purse, a highlight that runs away down the list. What it does not exercise is
// the operating system's own auto-repeat, which no browser automation can
// manufacture; a build that filters `KeyboardEvent.repeat` is answering the same
// requirement from the other side, and a build that ignores it fires once here and
// once for a player too, because the first repeat arrives long after the second
// this scenario spends.
//
// THREE KEYS, BECAUSE ONE READING CANNOT SEPARATE ONE FIRING FROM MANY EVERYWHERE.
// The item's description names "each one-shot key", and the honest way to read that
// is to hold keys whose action ACCUMULATES, so that one firing and a hundred land
// on different numbers:
//
//   - `rotate`, whose held rotation steps `0, 1, 2, 3, 0` — one press reads `1`.
//   - `upgrade`, whose level climbs and whose cost is taken each time — one press
//     reads level II and exactly one step's cost, and the money posed is enough for
//     the SECOND step too, so a build that fired twice reads level III and a purse
//     short by both.
//   - `down`, whose highlight walks a five-row list — one press reads row `1`.
//
// A TOGGLE WOULD BE THE WRONG INSTRUMENT and is deliberately not held here. `pause`,
// `speed` and `mute` each undo themselves, so an even number of firings is
// indistinguishable from none; their own items (`controls.pause-key`,
// `controls.speed-key`, `controls.mute-key`) read a single press twice over
// instead, which is what a toggle can be read by.
//
// A SECOND OF GAME TIME is the item's own figure, driven as the harness's frames at
// its steady rate, so the key is genuinely down while a great many real updates
// run. The world gate stays shut throughout, so the second spent does not let a
// wave in, and the anchor the tower stands on is a quiet one clear of both
// vent-to-exhaust corridors.
//
// EACH LEG IS POSED FRESH AND READ ALONE, so a failure names the key that repeated
// rather than the first one in the file.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, MODE_ITEMS, TOWER_DEFS, upgradeCost } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** How long each key is held: the second of game time the item names. */
const HOLD_FRAMES = framesFor(1);

/** The tower posed for the `upgrade` leg: the cheapest emitter in the shop. */
const TYPE = "arc";

/** What the level I to II step costs, by specs/building.md's arithmetic. */
const FIRST_STEP = upgradeCost(TOWER_DEFS[TYPE], 1);
/** What the level II to III step costs. */
const SECOND_STEP = upgradeCost(TOWER_DEFS[TYPE], 2);

/**
 * The money posed for the `upgrade` leg: enough for BOTH steps.
 *
 * This is the distinguishing value. Money enough for one step would leave a build
 * that fired a hundred times looking identical to one that fired once, because
 * specs/building.md refuses an upgrade the player cannot afford. Posed above both
 * steps, a repeat reads level III and a purse short by `FIRST_STEP + SECOND_STEP`,
 * so the failure names which wrong model the build implemented.
 */
const BUDGET = FIRST_STEP + SECOND_STEP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("fires rotate, upgrade and the down step exactly once each when its key is held for a second", async () => {
  await startRun(h);

  // --- rotate: the held rotation steps once, from 0 to 1 -------------------
  await h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  await h.debug.setArmed(TYPE);
  await h.debug.setPreview(FREE_SITE.col, FREE_SITE.row);
  await h.debug.setPreviewRotation(0);
  await h.advance(1);

  await h.holdFor(BINDINGS.rotate, HOLD_FRAMES);
  await h.advance(1);
  const rotated = await h.snapshot();
  await captureStill(h, "once");

  assertEqual(
    rotated.build?.rotation ?? null,
    1,
    `${BINDINGS.rotate}: the held rotation after the key was held for a second, from 0`,
  );

  // --- upgrade: the level climbs once, and one step is paid for ------------
  await h.debug.setArmed(null);
  const id = await poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setSelected(id);
  await h.debug.setMoney(BUDGET);
  await h.advance(1);

  await h.holdFor(BINDINGS.upgrade, HOLD_FRAMES);
  await h.advance(1);
  const upgraded = await h.snapshot();
  await captureStill(h, "once");

  assertEqual(
    requireTower(upgraded, id, "the selected tower").level,
    2,
    `${BINDINGS.upgrade}: the selected tower's level after the key was held for a second, from level 1 with money for two steps`,
  );
  assertEqual(
    upgraded.money,
    BUDGET - FIRST_STEP,
    `${BINDINGS.upgrade}: the money left after the key was held for a second, from ${BUDGET} with the first step costing ${FIRST_STEP}`,
  );

  // --- down: the highlight steps once, on a five-row menu ------------------
  await h.debug.setScreen("modeselect");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  await h.holdFor(BINDINGS.down, HOLD_FRAMES);
  await h.advance(1);
  const stepped = await h.snapshot();
  await captureStill(h, "once");

  assertEqual(
    stepped.menuIndex,
    1,
    `${BINDINGS.down}: the highlighted row after the key was held for a second, posed on row 0 of ${MODE_ITEMS.length}`,
  );
});
