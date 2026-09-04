// movement/fits-a-one-tile-shaft — the miner passes down a shaft one cell wide.
//
// `specs/character.md`: "It occupies an axis-aligned box `MINER_W` (`56`) by
// `MINER_H` (`72`) units, so it passes through a shaft one tile wide", against
// `specs/world.md`'s `TILE` of `80`. Twelve units of clearance either side is the
// whole reason a downward cut is a route rather than a dead end: the prospector
// bores one column and then falls down it.
//
// A build whose box is as wide as a tile, or whose collision resolves against a
// cell the box only touches, catches on the wall and stops partway. So the
// reading is the whole descent: the miner is let go at the top of a one-cell shaft
// with rock either side, and what is read is that it arrived at the bottom, on the
// floor, in the same column it started in and at the same horizontal position —
// a fall with nothing pushing it sideways moves in `x` only if something caught it.
//
// The drill is gated and no key is held, so nothing widens the shaft on the way
// down and nothing steers.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  digShaft,
  driveFall,
  minerFeet,
  minerXOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

const COL = 8;
const TOP_ROW = 6;
const FLOOR_ROW = 31;

/** The drop, which leaves the miner inside the shaft when it is let go. */
const HEIGHT = 20 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls the length of a one-cell shaft without catching on either side", async () => {
  openScene(h);
  digShaft(h, COL, TOP_ROW, FLOOR_ROW - 1);
  pinDrill(h);

  const fall = await captureReplay(h, "shaft", () =>
    driveFall(h, COL, FLOOR_ROW, HEIGHT, { maxFrames: 400 }),
  );

  assertEqual(fall.landed, true, "the miner reached the floor of the shaft");
  const { miner } = fall.snapshot;
  assertEqual(miner.col, COL, "the column the miner arrived in");
  // Nothing pushed it sideways on the way down, which is what catching would do.
  assertCloseTo(miner.x, minerXOn(COL), 3, "the box's horizontal position");
  assertLessThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE,
    "the miner's feet on the shaft's floor",
  );
  assertGreaterThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE - 1,
    "the miner's feet on the shaft's floor",
  );

  // The walls are untouched: it fell through the shaft rather than through them.
  assertEqual(
    h.tileAt(COL - 1, FLOOR_ROW - 1).kind,
    "rock",
    "the shaft's left wall",
  );
  assertEqual(
    h.tileAt(COL + 1, FLOOR_ROW - 1).kind,
    "rock",
    "the shaft's right wall",
  );
});
