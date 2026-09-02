// Meltdown — controls/no-auto-repeat: a key held down fires its action once.
//
// THE RULE. specs/controls.md states it flatly, under The actions: "Every action
// is read as a press edge and fires once per press. Holding a key down fires its
// action exactly once, however long it is held."
//
// WHAT A HELD KEY IS, HERE. The key goes down, a full second of game time is
// driven with it still down, and only then does it come up. That is the shape a
// build reading held state at the top of each frame turns into a hundred and
// twenty firings, and it is the defect this item exists to catch: a rotate that
// spins, an upgrade that empties the purse, a highlight that runs away down the
// list. What it does not exercise is the operating system's own auto-repeat, which
// no automation can manufacture; a build that filters `KeyboardEvent.repeat` is
// answering the same requirement from the other side, and a build that ignores it
// fires once here and once for a player too, because the first repeat arrives long
// after the second this scenario spends.
//
// THREE KEYS, BECAUSE ONE READING CANNOT SEPARATE ONE FIRING FROM MANY EVERYWHERE.
// The item's description names "each one-shot key", and the honest way to read
// that is to hold keys whose action ACCUMULATES, so one firing and a hundred land
// on different numbers:
//
//   - `rotate`, whose held rotation steps `0, 1, 2, 3, 0` — one press reads `1`.
//   - `upgrade`, whose level climbs and whose cost is taken each time — one press
//     reads level II and exactly one step's cost, and the money posed covers the
//     SECOND step too, so a build that fired twice reads level III and a purse
//     short by both.
//   - `down`, whose highlight walks a five-row list — one press reads row `1`.
//
// A TOGGLE WOULD BE THE WRONG INSTRUMENT and is deliberately not held here.
// `pause`, `speed` and `mute` each undo themselves, so an even number of firings
// is indistinguishable from none; their own items (`controls.pause-key`,
// `controls.speed-key`, `controls.mute-key`) read a single press twice over
// instead, which is what a toggle can be read by.
//
// A SECOND OF GAME TIME is the item's own figure, driven as whole frames of the
// suite's clock, so the key is genuinely down while a great many real updates run.
// The world gate `startRun` shuts holds the run's own release of surge, so the
// second spent does not let a wave in, and the anchor the tower stands on is a
// quiet one clear of both vent-to-exhaust corridors.
//
// EACH LEG IS POSED FRESH AND READ ALONE, so a failure names the key that repeated
// rather than the first one in the file.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS, TOWER_DEFS, UPGRADE_COST_MULT } from "../constants";
import {
  captureStill,
  createHarness,
  holdFor,
  poseTower,
  startRun,
  ticksFor,
  towerById,
  type Harness,
} from "../harness";
import { QUIET_SITE } from "./scene";

/** How long each key is held: the second of game time the item names. */
const HOLD_FRAMES = ticksFor(1);

/** The type held for the `rotate` leg and posed for the `upgrade` leg. */
const TYPE = "arc";

/** What the level I to II step costs, by specs/building.md's arithmetic. */
const FIRST_STEP = Math.round(TOWER_DEFS[TYPE].cost * UPGRADE_COST_MULT[0]);
/** What the level II to III step costs, by the same arithmetic. */
const SECOND_STEP = Math.round(TOWER_DEFS[TYPE].cost * UPGRADE_COST_MULT[1]);

/**
 * The money posed for the `upgrade` leg: enough for BOTH steps.
 *
 * This is the distinguishing value. Money enough for one step would leave a build
 * that fired a hundred times looking identical to one that fired once, because
 * specs/building.md refuses an upgrade the player cannot afford. Posed above both
 * steps, a repeat reads level III and a purse short by `FIRST_STEP + SECOND_STEP`,
 * so the failure names which wrong model the build implemented.
 */
const PURSE = FIRST_STEP + SECOND_STEP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires rotate, upgrade and the down step exactly once each when its key is held for a second", async () => {
  startRun(h);

  // --- rotate: the held rotation steps once, from 0 to 1 --------------------
  h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setPreviewRotation(0);
  await h.advance(1);

  await holdFor(h, "KeyR", HOLD_FRAMES);
  await h.advance(1);
  captureStill(h, "once");

  assertEqual(
    h.snapshot().build?.rotation,
    1,
    "KeyR: the held rotation after the key was held for a second, from 0",
  );

  // --- upgrade: the level climbs once, and one step is paid for -------------
  h.debug.setArmed(null);
  const id = poseTower(h, TYPE, QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setSelected(id);
  h.debug.setMoney(PURSE);
  await h.advance(1);

  await holdFor(h, "KeyU", HOLD_FRAMES);
  await h.advance(1);
  captureStill(h, "once");

  const upgraded = h.snapshot();
  assertEqual(
    towerById(upgraded, id)?.level,
    2,
    "KeyU: the selected tower's level after the key was held for a second, " +
      "from level 1 with money for two steps",
  );
  assertEqual(
    upgraded.money,
    PURSE - FIRST_STEP,
    `KeyU: the money left after the key was held for a second, from ${PURSE} ` +
      `with the first step costing ${FIRST_STEP}`,
  );

  // --- down: the highlight steps once, on a five-row menu -------------------
  h.debug.setScreen("modeselect");
  h.debug.setMenuIndex(0);
  await h.advance(1);

  await holdFor(h, "ArrowDown", HOLD_FRAMES);
  await h.advance(1);
  captureStill(h, "once");

  assertEqual(
    h.snapshot().menuIndex,
    1,
    "ArrowDown: the highlighted row after the key was held for a second, " +
      `posed on row 0 of ${MODE_ITEMS.length}`,
  );
});
