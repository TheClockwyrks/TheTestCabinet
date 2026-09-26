// Deepcore — the posed rock field the three carved-tunnel checks share.
// CASE-PROVIDED.
//
// specs/assets.md fixes how a carved cell is drawn: "A carved cell is drawn inset
// with a lip of the band's dirt and rounded corners, so a tunnel is narrower than
// a full cell; orthogonally adjacent open cells join into one passage and cells
// touching only at a corner stay separate." All three of those readings need the
// same scene — a solid field of one band's rock with a known pattern cut out of
// it — so the scene is written once here.
//
// THE FIELD IS SOLID TO ITS EDGE, AND THE FEATURES SIT INSIDE THAT EDGE. An
// emptied mine is open everywhere, so a carved cell laid at the field's border
// would join the open mine beyond it and read as a different shape than the one
// the check meant to pose. Every cell a check opens therefore sits at least one
// column and one row inside the block, and the block's own margin is solid.
//
// The band is the ROCKBED. Any band would do — the shaping is the same at every
// depth — and it is named here so the two colours the readings rest on come from
// one band rather than from a boundary between two.

import {
  fillBlock,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  rowInBand,
  type Harness,
} from "../harness";

/** The column the miner is parked in, clear of the field to its right. */
export const MINER_COL = 12;

/** The field's extent in columns: solid margin included. */
export const FIELD_FROM_COL = 13;
export const FIELD_TO_COL = 20;

/** How many rows either side of the field's centre row the block covers. */
export const FIELD_HALF_ROWS = 3;

/** A posed field of rock, and where its features may be cut. */
export interface Field {
  /** The row the field is centred on: the middle of the rockbed. */
  row: number;
  /** The columns a check may open: one inside the block either side. */
  fromCol: number;
  toCol: number;
  /** The rows a check may open: one inside the block either side. */
  fromRow: number;
  toRow: number;
}

/**
 * Open an empty mine, lay a solid block of the rockbed's rock, and park the
 * miner beside it with both faculties held.
 *
 * The miner is pinned rather than stood on the rock: what these checks read is
 * how the mine is DRAWN, so the miner must neither fall through the empty mine
 * around the block nor cut a cell of it, and the two faculty gates
 * specs/instrumentation.md fixes are what hold it. It is parked four columns
 * clear of the field so its own sprite is never inside a sampled cell.
 */
export function layRockField(h: Harness): Field {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  const { coreRow } = h.snapshot();
  const row = rowInBand("rockbed", coreRow);
  fillBlock(
    h,
    {
      fromCol: FIELD_FROM_COL,
      toCol: FIELD_TO_COL,
      fromRow: row - FIELD_HALF_ROWS,
      toRow: row + FIELD_HALF_ROWS,
    },
    "rock",
  );
  placeAt(h, minerXOn(MINER_COL), minerYOn(row));
  return {
    row,
    fromCol: FIELD_FROM_COL + 1,
    toCol: FIELD_TO_COL - 1,
    fromRow: row - FIELD_HALF_ROWS + 1,
    toRow: row + FIELD_HALF_ROWS - 1,
  };
}
