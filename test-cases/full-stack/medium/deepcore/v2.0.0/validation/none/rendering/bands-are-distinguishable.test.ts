// rendering/bands-are-distinguishable — the four bands' rock is drawn as four
// different rocks.
//
// specs/overview.md fixes what a player must read at a glance: "The four bands'
// rock is drawn distinctly enough that a player descending tells one band from
// the next without reading the depth meter." It deliberately fixes no palette,
// so separation is the whole of what a check can read, and the review item
// states the figure that separation is held to: no two bands' sampled mean
// colours within an RGB distance of 40 of the 441 the cube spans.
//
// THE READING. A rock cell in each band, posed inside a block of its own band's
// rock so nothing else of the mine is in the sample, and its interior sampled
// through the camera the snapshot reports. One band at a time, because the four
// bands are hundreds of rows apart and no camera holds two of them at once. The
// miner is pinned beside each cell with both faculties held, so nothing walks,
// falls or drills into the picture being read.
//
// The sample is a small cluster at the cell's centre rather than a mean over the
// whole face, because specs/assets.md asks for a fine, even grain across the
// tile and a cell's centre is that grain; a mean over the whole face would also
// average in whatever the build draws at the cell's edges.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { BAND_ORDER, TILE, type Band } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  rowInBand,
  sampleCell,
  fillBlock,
  minerXOn,
  minerYOn,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far apart two bands' rock must read, in RGB distance.
 *
 * The review item's figure: 40 of the 441 the RGB cube spans, which is the
 * quantity "drawn distinctly" is held to for a specification that fixes no
 * palette.
 */
const BAND_APART_MIN = 40;

/** The column the sampled cell sits in, mid-mine so the camera holds it. */
const CELL_COL = 16;

/** How far to the side the miner waits, clear of the cell being read. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose a block of one band's rock, park the miner beside it, and read it. */
async function readBand(band: Band): Promise<Rgb> {
  const snapshotBefore = await h.snapshot();
  const row = rowInBand(band, snapshotBefore.coreRow);
  await fillBlock(
    h,
    {
      fromCol: CELL_COL - 1,
      toCol: CELL_COL + 1,
      fromRow: row - 1,
      toRow: row + 1,
    },
    "rock",
  );
  await placeAt(h, minerXOn(CELL_COL - MINER_OFFSET), minerYOn(row));
  await h.advance(1);
  const snapshot = await h.snapshot();
  return sampleCell(h, snapshot, CELL_COL, row);
}

it("draws the four bands' rock clearly apart from one another", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);

  const read = new Map<Band, Rgb>();
  for (const band of BAND_ORDER) {
    read.set(band, await readBand(band));
  }
  // The last band posed is the one on screen, so the still shows the coreshell
  // rock the loop finished on rather than a frame between two of them.
  await captureStill(h, "bands");

  for (let i = 0; i < BAND_ORDER.length; i += 1) {
    for (let j = i + 1; j < BAND_ORDER.length; j += 1) {
      const a = BAND_ORDER[i];
      const b = BAND_ORDER[j];
      assertGreaterThanOrEqual(
        colorDistance(read.get(a) as Rgb, read.get(b) as Rgb),
        BAND_APART_MIN,
        `the ${a} rock against the ${b} rock, each sampled at the centre of a ${TILE}-unit cell of its own band`,
      );
    }
  }
});
