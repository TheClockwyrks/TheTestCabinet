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
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { TILE } from "../constants";
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

/**
 * The floating-point slack on the floor's face, in world units.
 *
 * The feet come to rest ON the floor's top face and `specs/character.md` admits
 * no overlap, so this reading is closed there. But the descent integrates a fall
 * over hundreds of frames and the position that lands on the face is the sum of
 * them, so its last bits fall either side: a build that comes to rest exactly on
 * the floor reads `2480.0000000000023` as readily as `2480`, and failing it for
 * that says nothing about the build. This is that noise and nothing physical —
 * the smallest thing the reading discriminates against is a collision box inset
 * from the declared one, which shows as tenths of a unit, and the smallest
 * progress a cut can show is `TILE / 4`, twenty units.
 */
const SETTLE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("falls the length of a one-cell shaft without catching on either side", async () => {
  await openScene(h);
  await digShaft(h, COL, TOP_ROW, FLOOR_ROW - 1);
  await pinDrill(h);

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
    FLOOR_ROW * TILE + SETTLE,
    "the miner's feet on the shaft's floor",
  );
  assertGreaterThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE - 1,
    "the miner's feet on the shaft's floor",
  );

  // The walls are untouched: it fell through the shaft rather than through them.
  assertEqual(
    (await h.tileAt(COL - 1, FLOOR_ROW - 1)).kind,
    "rock",
    "the shaft's left wall",
  );
  assertEqual(
    (await h.tileAt(COL + 1, FLOOR_ROW - 1)).kind,
    "rock",
    "the shaft's right wall",
  );
});
