// movement/stopped-by-wall — a walk into a wall stops at its face.
//
// `specs/character.md`: "The miner's box never overlaps a cell that is not a
// tunnel. It rests on top of solid cells and is stopped by walls." Where a fall
// meets a floor, a walk meets a wall, and the box comes to rest flush against the
// wall cell's near face: not inside it, and not a gap short of it.
//
// `specs/character.md` also has a side cut start exactly there — "the cut into the
// neighboring cell begins only once the miner's box is flush against it" — so a
// build that stops the miner a few units off the face never starts a side cut at
// all, and one that lets the box overlap has already dug through the wall it was
// meant to be stopped by.
//
// THE DRILL IS GATED, because a cut is the thing that happens NEXT and this is
// the check about the stop. With the drill running the wall would break and the
// miner would walk on, which is correct behaviour and a different requirement.
//
// THE TOLERANCE. One world unit of the eighty a tile spans, on the near side
// alone: a walk resolved within a frame may leave the box a fraction of that
// frame's travel short of the face, and overlapping the wall is not admitted at
// all.

import { afterEach, beforeEach, it } from "vitest";
import { MINER_W, TILE } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveHold,
  fillColumn,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

const START_COL = 6;
const WALL_COL = 13;
const ROW = 12;

/** Long enough to cross the run-up and settle against the wall. */
const WALK_FRAMES = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops a walk with the box flush against the wall's face", async () => {
  openScene(h);
  layFloor(h, ROW);
  // The wall rises out of the floor across the rows the box occupies.
  fillColumn(h, WALL_COL, ROW - 2, ROW - 1, "rock");
  standOn(h, START_COL, ROW, "east");
  pinDrill(h);

  const walk = await captureReplay(h, "wall", () =>
    driveHold(h, ACTION_KEY.right, WALK_FRAMES),
  );

  const { miner } = walk.snapshot;
  const face = WALL_COL * TILE;
  assertEqual(miner.grounded, true, "the miner still on the floor at the wall");
  assertLessThanOrEqual(
    miner.x + MINER_W,
    face,
    "the box's right edge against the wall's near face",
  );
  assertGreaterThanOrEqual(
    miner.x + MINER_W,
    face - 1,
    "the box's right edge against the wall's near face",
  );

  // And the wall is still a wall: it stopped the miner rather than being cut.
  assertEqual(
    h.tileAt(WALL_COL, ROW - 1).kind,
    "rock",
    "the cell the walk was stopped by",
  );
});
