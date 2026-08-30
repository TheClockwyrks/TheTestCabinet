// rendering/lava-is-distinguishable — lava reads as molten, not as more rock.
//
// specs/overview.md: "Lava is plainly visible as molten and dangerous against
// safe ground." A pool has to be read BEFORE the miner is standing in it, and
// specs/hazards.md makes contact cost hull continuously, so a lava cell a player
// mistakes for rock is a lava cell a player drills into. The specification fixes
// no palette, so separation is what a check can read, and the review item states
// the figure: a lava cell's sampled interior at least an RGB distance of 60 from
// the rock of its own band.
//
// THE READING. A run of that band's rock with one cell of it posed to lava, so
// the two samples are the same band, the same camera and the same frame: the
// only difference between them is the kind of the cell. The deepstone is the
// band used, because specs/world.md puts the shallowest lava there.
//
// The miner is parked clear of the pool with both faculties held, so it neither
// walks into the lava nor drills it while the frame is read — the contact drain
// and the drilling lump belong to the hazards checks, not to this one.
//
// THE PRODUCED FILES ARE STOOD UP for this reading, because specs/assets.md has
// both the band rock and the lava come from produced tiles: the picture a player
// has to tell apart is the one drawn with those files in hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  fillBlock,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  rowInBand,
  sampleCell,
  type Harness,
} from "../harness";

/** The review item's figure for "plainly visible": 60 of the 441 RGB spans. */
const LAVA_APART_MIN = 60;

/** The column the pool sits in, mid-mine so the camera holds it. */
const LAVA_COL = 16;

/** How many columns to the side the plain rock is read from. */
const ROCK_OFFSET = 2;

/** How far to the side the miner waits, clear of the pool and of the rock read. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws lava clearly apart from the rock of its band", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);

  const row = rowInBand("deepstone", h.snapshot().coreRow);
  fillBlock(
    h,
    {
      fromCol: LAVA_COL - ROCK_OFFSET,
      toCol: LAVA_COL + ROCK_OFFSET,
      fromRow: row - 1,
      toRow: row + 1,
    },
    "rock",
  );
  h.debug.setTile(LAVA_COL, row, "lava");
  placeAt(h, minerXOn(LAVA_COL - MINER_OFFSET), minerYOn(row));

  // Two frames, which is what puts the produced tiles in the build's hand.
  await h.advance(2);
  const snapshot = h.snapshot();
  const lava = sampleCell(h, snapshot, LAVA_COL, row);
  const rock = sampleCell(h, snapshot, LAVA_COL + ROCK_OFFSET, row);
  captureStill(h, "lava");

  assertGreaterThanOrEqual(
    colorDistance(lava, rock),
    LAVA_APART_MIN,
    "a lava cell against a rock cell of the same band, sampled at each cell's centre in the same frame",
  );
});
