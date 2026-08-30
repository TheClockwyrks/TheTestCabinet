// rendering/tunnel-joins-and-separates — two carved cells that share a side make
// one passage; two that share only a corner stay two holes.
//
// specs/assets.md: "orthogonally adjacent open cells join into one passage and
// cells touching only at a corner stay separate." Both halves are one rule about
// where the dirt lip is kept and where it is dropped, and both are read from one
// posed field so the pair that must join and the pair that must not are drawn by
// the same build in the same frame.
//
// THE READING. Two colours are established first, from the same frame: the FILL,
// at the centre of one of the joined cells, and the DIRT, at the centre of a
// solid cell of the field. Then two points:
//
//   - the SEAM, the midpoint of the side two orthogonally adjacent open cells
//     share. Joined means the fill runs straight through it, so the seam reads
//     as fill. A build that kept a lip on every side draws a bar of dirt down
//     the middle of a two-cell passage, and the seam reads as dirt.
//   - the TOUCH, the single corner two diagonally adjacent open cells share.
//     Separate means the dirt is still between them, so the touch reads as dirt.
//     A build that treated a diagonal neighbour as a join opens the corner and
//     the touch reads as fill.
//
// Each point is averaged over three samples two units apart ACROSS the boundary
// it names, so the reading is of the boundary rather than of one pixel that
// happened to land on an anti-aliased edge.
//
// Every opened cell sits inside the field's solid margin, and each pair's cells
// are two rows and columns clear of the other pair, so neither reading can be
// looking at the other's shape.
//
// THE PRODUCED FILES ARE STOOD UP, because specs/assets.md draws both the band
// rock and the tunnel fill from produced tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TILE } from "../../src/constants";
import {
  DISTINCT_MIN,
  captureStill,
  colorDistance,
  createHarness,
  sampleCell,
  type Harness,
} from "../harness";
import { layRockField } from "./field";
import { meanAt, readsAs, stageOf } from "./sample";

/** How far either side of a boundary the three samples of it sit, in units. */
const ACROSS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("joins two carved cells that share a side and keeps two that share a corner apart", async () => {
  const field = layRockField(h);
  const { row } = field;

  // The pair that must join: side by side, one row above the field's centre.
  const joinedRow = row - 1;
  const joinedLeft = field.fromCol + 1;
  h.debug.setTile(joinedLeft, joinedRow, "tunnel");
  h.debug.setTile(joinedLeft + 1, joinedRow, "tunnel");

  // The pair that must stay apart: touching at one corner, three columns over
  // and two rows down, so the two features share no neighbour.
  const apartCol = field.toCol - 1;
  const apartRow = row + 1;
  h.debug.setTile(apartCol, apartRow, "tunnel");
  h.debug.setTile(apartCol + 1, apartRow + 1, "tunnel");

  // Two frames, which is what puts the produced tiles in the build's hand.
  await h.advance(2);
  const snapshot = h.snapshot();
  const fill = sampleCell(h, snapshot, joinedLeft, joinedRow);
  const dirt = sampleCell(h, snapshot, field.fromCol, row);

  // The seam: the midpoint of the side the joined pair shares.
  const seamAt = stageOf(
    snapshot,
    (joinedLeft + 1) * TILE,
    joinedRow * TILE + TILE / 2,
  );
  const seam = meanAt(h, [
    seamAt,
    { x: seamAt.x - ACROSS, y: seamAt.y },
    { x: seamAt.x + ACROSS, y: seamAt.y },
  ]);

  // The touch: the single corner the diagonal pair shares.
  const touchAt = stageOf(snapshot, (apartCol + 1) * TILE, (apartRow + 1) * TILE);
  const touch = meanAt(h, [
    touchAt,
    { x: touchAt.x - ACROSS, y: touchAt.y + ACROSS },
    { x: touchAt.x + ACROSS, y: touchAt.y - ACROSS },
  ]);
  captureStill(h, "join");

  // The reading only says something where the two ends of it are apart.
  assertGreaterThan(
    colorDistance(dirt, fill),
    DISTINCT_MIN,
    "the band's unmined rock drawn clearly apart from the carved tunnel's fill, in RGB distance",
  );

  assertEqual(
    readsAs(seam, dirt, fill),
    "fill",
    "the side two orthogonally adjacent carved cells share carrying the tunnel fill, so the two are one passage",
  );
  assertEqual(
    readsAs(touch, dirt, fill),
    "dirt",
    "the corner two diagonally adjacent carved cells touch at carrying the band's dirt, so the two stay separate",
  );
});
