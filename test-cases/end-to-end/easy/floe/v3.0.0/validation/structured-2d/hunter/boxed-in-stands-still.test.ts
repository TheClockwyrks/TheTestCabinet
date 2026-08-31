// hunter/boxed-in-stands-still — a bear with no open neighbour takes no step.
//
// specs/hunter.md gives the routing rule three branches, and this is the third:
//
//   3. Where no neighboring tile is open, no step: the bear holds the tile it is
//      on and chooses again on the next tick.
//
// So a bear ringed on all four sides holds still. It does not push into a covered
// tile, it does not leave the grid, it does not thrash between two tiles, and it
// does not throw: over three seconds — three hundred and sixty ticks of choosing
// again and finding nothing — it is settled on exactly the tile it was posed on,
// with its centre exactly where it started.
//
// THE RING IS PARKED, so no vehicle ever arrives on the bear and the reading is
// the routing branch rather than a removal. THE BEAR'S OWN TILE IS CLEAR: the
// vehicles cover its four neighbours and not the tile it stands on. Its TRAVEL is
// left ON, because "holds its centre" is a claim about a bear that could have
// moved and did not; its SENSE is off and its target is posed above the ring, so
// it is a bear that wants to be somewhere else and cannot get there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import { tileCX, tileCY } from "../../src/constants";
import {
  bearStepTile,
  bearTile,
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { requireBear, vehicleCoversTile } from "./harness";

/** The bear's tile, and the tile it is hunting beyond the ring. */
const BEAR_COL = 20;
const BEAR_ROW = 15;
const TARGET = { col: BEAR_COL, row: 10 };

/**
 * The ring, laid on three ice rows.
 *
 * A `car` is two tiles long, so one at column 18 covers the bear's left neighbour
 * and one at column 21 covers its right, leaving its own column clear. A `plow` is
 * three tiles long and covers the neighbour above from column 19; a `dogsled` is
 * two and covers the neighbour below from column 20.
 */
const SIDE_CAR_COLS = [BEAR_COL - 2, BEAR_COL + 1];
const ABOVE_PLOW_COL = BEAR_COL - 1;
const BELOW_DOGSLED_COL = BEAR_COL;

/** The game time the ring is held for, from the item. */
const HOLD_SECONDS = 3;

/**
 * How far the bear's centre may move over those three seconds, in stage units.
 *
 * A bear that takes no step travels nowhere at all, so the only allowance is
 * arithmetic: a hundredth of a unit is three thousandths of a tile, and a single
 * tick of the slowest speed the specification states would be fifty times it.
 */
const CENTRE_TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes no step and holds its centre when every neighbour is closed", async () => {
  startCrossing(h);
  poseLane(h, BEAR_ROW, "car", SIDE_CAR_COLS);
  poseLane(h, BEAR_ROW - 1, "plow", [ABOVE_PLOW_COL]);
  poseLane(h, BEAR_ROW + 1, "dogsled", [BELOW_DOGSLED_COL]);
  const id = poseBear(h, BEAR_COL, BEAR_ROW, { sense: false });
  h.debug.setBearTarget(id, TARGET.col, TARGET.row);

  // The scenario this check needs, read off the game itself: all four neighbours
  // covered and the bear's own tile clear. A bear that held still on a strait the
  // vehicles never reached would be holding still for no reason the rule gives.
  const posed = h.snapshot();
  for (const [name, tile] of [
    ["above", { col: BEAR_COL, row: BEAR_ROW - 1 }],
    ["below", { col: BEAR_COL, row: BEAR_ROW + 1 }],
    ["left", { col: BEAR_COL - 1, row: BEAR_ROW }],
    ["right", { col: BEAR_COL + 1, row: BEAR_ROW }],
  ] as const) {
    assertEqual(
      vehicleCoversTile(posed, tile.col, tile.row),
      true,
      `a vehicle over the neighbour ${name} of the bear ` +
        `(${tile.col}, ${tile.row}), which is what closes it (specs/hunter.md)`,
    );
  }
  assertEqual(
    vehicleCoversTile(posed, BEAR_COL, BEAR_ROW),
    false,
    `a vehicle over the bear's own tile (${BEAR_COL}, ${BEAR_ROW}), which the ` +
      `ring leaves clear`,
  );

  const after = await captureReplay(h, "route", async () => {
    await h.advance(ticksFor(HOLD_SECONDS));
    return h.snapshot();
  });

  const bear = requireBear(after, id, "the boxed-in bear");
  assertDeepEqual(bearTile(bear), { col: BEAR_COL, row: BEAR_ROW }, "its tile");
  assertDeepEqual(
    bearStepTile(bear),
    { col: BEAR_COL, row: BEAR_ROW },
    "the tile it is travelling into, a bear that took no step being settled",
  );
  assertLessThanOrEqual(
    Math.max(
      Math.abs(bear.x - tileCX(BEAR_COL)),
      Math.abs(bear.y - tileCY(BEAR_ROW)),
    ),
    CENTRE_TOLERANCE,
    `stage units its centre moved over ${HOLD_SECONDS} s`,
  );
});
