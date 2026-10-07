// world/grid-geometry — a cell occupies the rectangle the specification states.
//
// `specs/world.md`: "The world is a grid of square tiles `TILE` (`80`) logical
// units on a side ... the cell `(col, row)` occupies the world-space rectangle
// `x` in `[col * TILE, col * TILE + TILE]`, `y` in
// `[row * TILE, row * TILE + TILE]`."
//
// The rectangle is not readable on its own — it is a coordinate convention, and a
// convention is only observable where the game acts on it. Where it acts on it is
// collision: `specs/character.md` has the miner rest on top of solid cells, so a
// miner dropped down a one-column shaft comes to rest with its feet on the TOP of
// the first solid cell beneath it, which the convention puts at exactly
// `row * TILE`. A build whose tile were `64` units, or whose cell were addressed
// from its centre, would stop the miner somewhere else entirely.
//
// THE TOLERANCE. One world unit of an eighty-unit tile, on the low side alone:
// resting means the box's underside touches the cell's top face, and the frame
// that resolves the contact may leave the miner a fraction of that frame's travel
// short of it. Sinking into the cell is not resting and is not admitted at all,
// so the bound is one-sided.
//
// The drill is held for the drop, because a cut is not what is being read and a
// key is not held; the shaft's walls are what keep the fall in its column.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { MINER_W, TILE } from "../constants";
import {
  captureReplay,
  cellAt,
  createHarness,
  digShaft,
  driveFall,
  minerCenter,
  minerFeet,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

/** The column the shaft is sunk down, well clear of the camp and the Core. */
const COL = 8;
/** The shaft's open rows, and the solid cell the fall lands on. */
const TOP_ROW = 6;
const FLOOR_ROW = 24;
/** How far above the floor the miner is let go, in world units. */
const HEIGHT = 8 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rests the miner with its feet on the top of the cell beneath it", async () => {
  await openScene(h);
  await digShaft(h, COL, TOP_ROW, FLOOR_ROW - 1);
  await pinDrill(h);

  const fall = await captureReplay(h, "rest", () =>
    driveFall(h, COL, FLOOR_ROW, HEIGHT, { maxFrames: 300 }),
  );

  assertEqual(fall.landed, true, "the miner reached the floor of the shaft");
  const { miner } = fall.snapshot;

  // The floor cell's top face is at `row * TILE`, and that is where the feet
  // come to rest: never below it, and no more than a unit above it.
  assertGreaterThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE - 1,
    "the miner's feet against the top of the floor cell",
  );
  assertLessThanOrEqual(
    minerFeet(miner),
    FLOOR_ROW * TILE,
    "the miner's feet against the top of the floor cell",
  );

  // And the box sits inside the shaft's column, whose rectangle spans
  // `[col * TILE, col * TILE + TILE]`.
  assertGreaterThanOrEqual(miner.x, COL * TILE, "the box's left edge");
  assertLessThanOrEqual(
    miner.x + MINER_W,
    (COL + 1) * TILE,
    "the box's right edge",
  );

  // The cell the game says the miner is in is the cell that rectangle puts its
  // centre in, so the reported address and the coordinate space agree.
  const centre = minerCenter(miner);
  const cell = cellAt(centre.x, centre.y);
  assertEqual(miner.col, cell.col, "the miner's reported column");
  assertEqual(miner.row, cell.row, "the miner's reported row");
  assertBetween(
    centre.y,
    (FLOOR_ROW - 1) * TILE,
    FLOOR_ROW * TILE,
    "the box's centre inside the cell above the floor",
  );
});
