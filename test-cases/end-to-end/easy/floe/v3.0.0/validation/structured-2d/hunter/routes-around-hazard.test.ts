// hunter/routes-around-hazard — a bear routes around a wall of traffic and
// through the one gap in it.
//
// specs/hunter.md: a tile a vehicle covers is CLOSED to a bear, and on settling a
// bear commits to "the first step of a shortest route from its tile to its target
// made only of tiles open to it". So a wall of parked vehicles across a row is not
// something a bear pushes through or is stopped by: it is something the route goes
// around, and where the wall has one gap the route goes through the gap.
//
// The wall is PARKED — `poseLane` stops the lane before laying it — for two
// reasons. A parked lane takes no bear off the strait (a vehicle removes a bear
// only from a lane whose speed is above `0`), so what this reads is the ROUTE and
// not a survival; and a wall that does not slide keeps the gap in one place, so
// the route the bear has to find is the same one for the whole six seconds.
//
// The verdict is the two halves of the item together: over the whole window the
// bear is never on a tile a vehicle covers, and within it the bear reaches the
// critter's row. The first alone would pass a bear that stood still; the second
// alone would pass a bear that walked through the wall.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import { COLS, ITEM_LEN, ROW_NEAR } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { vehicleCoversTile } from "./harness";

/** The row the wall is laid across, and the two columns left open in it. */
const WALL_ROW = 15;
const GAP_COLS = [26, 27];

/** Where the bear starts and where the critter waits: both past the wall's gap. */
const BEAR_COL = 30;
const BEAR_ROW = ROW_NEAR - 2;
const CRITTER_COL = 30;
const CRITTER_ROW = WALL_ROW - 2;

/**
 * The wall: a car every two columns, save the pair the gap is cut from.
 *
 * A `car` is `ITEM_LEN.car` (2) tiles long, so a car on every even column covers
 * the row end to end, and dropping the one whose left edge is `GAP_COLS[0]` leaves
 * exactly those two columns open.
 */
const WALL_COLS = Array.from(
  { length: COLS / ITEM_LEN.car },
  (_, index) => index * ITEM_LEN.car,
).filter((col) => col !== GAP_COLS[0]);

/** The game time the route is given, from the item. */
const ROUTE_SECONDS = 6;

/**
 * Ticks between two readings of where the bear is.
 *
 * A step spans a whole tile, which at `BEAR_ICE_SPEED` (3) tiles a second is 40
 * ticks, so reading every fourth tick sees every tile the bear settles on and
 * every tile it travels into — even for a build several times too fast — while
 * costing a hundred and eighty reads over the six seconds rather than seven
 * hundred and twenty.
 */
const POLL_TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("routes through the gap without ever standing on the wall", async () => {
  startCrossing(h);
  poseLane(h, WALL_ROW, "car", WALL_COLS);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const id = poseBear(h, BEAR_COL, BEAR_ROW);

  // The scenario this check needs, read off the game itself: the wall really does
  // close every column of its row but the two the gap is cut from. A bear that
  // crossed a row nothing was on would be routing around nothing.
  const posed = h.snapshot();
  const open = Array.from({ length: COLS }, (_, col) => col).filter(
    (col) => !vehicleCoversTile(posed, col, WALL_ROW),
  );
  assertDeepEqual(
    open,
    GAP_COLS,
    `the columns of row ${WALL_ROW} no vehicle covers, which is the gap the ` +
      `route has to find`,
  );

  const trespass: string[] = [];
  let reached = false;
  await captureReplay(h, "route", () =>
    h.until(
      (snapshot) => {
        const bear = snapshot.bears.find((entry) => entry.id === id);
        if (bear === undefined) return false;
        for (const tile of [
          { col: bear.col, row: bear.row },
          { col: bear.stepCol, row: bear.stepRow },
        ]) {
          if (vehicleCoversTile(snapshot, tile.col, tile.row)) {
            trespass.push(`(${tile.col}, ${tile.row}) at t=${snapshot.simTime}`);
          }
        }
        if (bear.row === CRITTER_ROW) reached = true;
        return false;
      },
      { maxFrames: ticksFor(ROUTE_SECONDS), poll: POLL_TICKS },
    ),
  );

  assertLength(
    trespass,
    0,
    `readings with the bear on a tile a vehicle covers: ` +
      `${trespass.slice(0, 3).join("; ")}`,
  );
  assertTrue(
    reached,
    `the bear on the critter's row (${CRITTER_ROW}) within ${ROUTE_SECONDS} s, ` +
      `the wall's only gap being columns ${GAP_COLS.join(" and ")}`,
  );
});
