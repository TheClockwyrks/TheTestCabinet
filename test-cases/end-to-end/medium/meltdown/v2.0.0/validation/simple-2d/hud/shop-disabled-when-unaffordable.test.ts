// hud/shop-disabled-when-unaffordable — an entry the money cannot cover is drawn
// plainly apart from the same entry when it can.
//
// THE RULE. specs/hud.md, The shop: "An entry whose build cost is above the
// current money is drawn disabled, plainly apart from an affordable entry."
//
// ONE ENTRY, TWO PURSES, AND THE PURSES STRADDLE THE COST BY ONE. The Flak costs
// 60 (specs/towers.md), so the money is posed at exactly 60 and then at 59, and
// the SAME entry is read both times. That is the whole scenario, and both halves
// of it are load-bearing:
//
//   ONE ENTRY, so the two readings differ in one thing. Comparing an affordable
//   entry against an unaffordable NEIGHBOUR would compare two rows of the shop,
//   which differ in their tower, their name, their cost and wherever the build
//   chose to draw them, and a build that painted every row a different colour
//   would pass without ever drawing a disabled state.
//
//   STRADDLING BY ONE, so the reading pins the threshold as well as the state.
//   specs/hud.md disables an entry whose cost is ABOVE the money, so at 60 the
//   Flak is affordable and at 59 it is not; a build that disables an entry it can
//   exactly afford reads the two frames alike and fails, and so does one that
//   never disables anything. Every other entry's affordability is the same at
//   both purses — the five cheaper than 59 stay affordable and the two dearer
//   than 60 stay unaffordable — so the Flak's row is the only thing on the panel
//   that changed.
//
// AND A SECOND ROW IS READ AS THE CONTROL, WHICH IS WHAT MAKES THE FIRST READING
// MEAN "DISABLED" RATHER THAN "REPAINTED". A build that answers a change of money
// by repainting the whole shop strip — dimming every row while the purse is
// short, or redrawing the panel in a different key — moves the Flak's paint as
// far as a disabled state would and would otherwise pass without ever marking one
// entry apart from another. So the Rime's row is sampled across the same two
// frames and must be drawn the SAME: it costs 45, which both purses afford, so
// specs/hud.md asks for no change in it at all. The Rime rather than the Arc
// because it is the dearest row still affordable at both, so a build that shades
// its rows by how near the purse is to their cost is caught here too.
//
// THE READING IS PIXELS, BECAUSE THE PALETTE IS THE BUILD'S. specs/overview.md
// fixes no colour and asks only that things read apart, so the check samples the
// entry's own interior in both frames and asks how far the paint moved. It knows
// no colour, no font and no styling: a build that greys the row, one that dims
// the caption, one that strikes the cost through and one that drops the row's
// contrast all clear it, and only a build that paints the two states the same
// does not.
//
// WHAT IT DOES NOT DECIDE. That an unaffordable type cannot actually be built is
// `building.place-disarms-when-unaffordable` and
// `building.preview-invalid-when-unaffordable`. This point decides that the
// player can SEE it.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  shopEntry,
  startRun,
  type Harness,
} from "../harness";
import { largestChange, sampleRect } from "./read";

/** The entry read, and the cost specs/towers.md gives it: 60. */
const TYPE = "flak";
const COST = TOWER_DEFS[TYPE].cost;

/** The control entry, and its cost: 45, which both purses below afford. */
const CONTROL_TYPE = "rime";
const CONTROL_COST = TOWER_DEFS[CONTROL_TYPE].cost;

/**
 * The two purses: exactly the cost, and one below it.
 *
 * specs/hud.md disables an entry whose cost is ABOVE the money, so the first is
 * the dearest purse that still affords this entry and the second the richest that
 * does not.
 */
const AFFORDS = COST;
const CANNOT = COST - 1;

/**
 * How far the two paintings of the entry must sit apart, out of the 441 the RGB
 * cube spans.
 *
 * The suite's figure for "plainly apart" (specs/overview.md), the same one the
 * `presentation` group holds a tower against the floor and a tripped tower
 * against an online one to. 60 is about a seventh of the scale: a shade a
 * reviewer would call a different state rather than a different rendering of the
 * same one.
 */
const APART_MIN = 60;

/**
 * How far the control entry's painting may move, out of the same 441.
 *
 * A third of {@link APART_MIN}, so one painting cannot satisfy both bounds: what
 * clears this one is a row a reviewer would call unchanged, and what clears the
 * other is a row they would call a different state. It is not zero because a
 * build is free to anti-alias its rows against whatever it drew behind them, and
 * a shade of movement is not a state; it is well under the bound the disabled row
 * has to clear because anything that far is.
 */
const STILL_MAX = 20;

/**
 * How finely the entry is sampled: a grid over its interior.
 *
 * Enough points that a build which marks the disabled state on the caption alone,
 * or on the cost alone, has some sample land on it, and the reading is the
 * LARGEST distance any one point moved rather than the average, because a row
 * whose figure alone is dimmed has still drawn the two states plainly apart.
 */
const SAMPLE_COLS = 24;
const SAMPLE_ROWS = 5;

/** The run the panel is read on, posed so nothing else moves between the frames. */
const MODE = "containment";
const DIFFICULTY = "hard";
const WAVE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an entry it cannot afford apart from the same entry it can", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setWave(WAVE);

  h.debug.setMoney(AFFORDS);
  await drawFrame(h);
  const entry = shopEntry(h.snapshot().controls, TYPE);
  const control = shopEntry(h.snapshot().controls, CONTROL_TYPE);
  const affordable = sampleRect(h, entry, SAMPLE_COLS, SAMPLE_ROWS);
  const controlAffordable = sampleRect(h, control, SAMPLE_COLS, SAMPLE_ROWS);

  h.debug.setMoney(CANNOT);
  await drawFrame(h);
  captureStill(h, "disabled");
  const disabled = sampleRect(h, entry, SAMPLE_COLS, SAMPLE_ROWS);
  const controlShort = sampleRect(h, control, SAMPLE_COLS, SAMPLE_ROWS);

  assertGreaterThanOrEqual(
    largestChange(affordable, disabled),
    APART_MIN,
    `how far the ${TYPE} entry's paint moved, out of 441, between a purse of ` +
      `${AFFORDS} that affords its cost of ${COST} and one of ${CANNOT} that ` +
      `does not — specs/hud.md draws the second "disabled, plainly apart from ` +
      `an affordable entry"`,
  );
  assertLessThanOrEqual(
    largestChange(controlAffordable, controlShort),
    STILL_MAX,
    `how far the ${CONTROL_TYPE} entry's paint moved, out of 441, across the ` +
      `same two purses — it costs ${CONTROL_COST}, which both ${AFFORDS} and ` +
      `${CANNOT} afford, so specs/hud.md leaves it affordable in both and the ` +
      `disabled state above has to be this entry's rather than the strip's`,
  );
});
