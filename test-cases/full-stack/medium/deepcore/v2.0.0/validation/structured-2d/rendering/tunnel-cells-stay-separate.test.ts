// rendering/tunnel-cells-stay-separate — two carved cells that share only a
// corner stay two holes.
//
// specs/assets.md: "orthogonally adjacent open cells join into one passage and
// cells touching only at a corner stay separate."
//
// TWO OUTCOMES, TWO POINTS. Joining and staying apart are opposite results a
// build produces from opposite inputs, so a build that joins everything, corners
// included, must grade differently from one that joins nothing. The other half is
// `rendering/tunnel-cells-join`.
//
// THE READING. Two colours are established first, from the same frame: the FILL,
// at the centre of one of the open cells, and the DIRT, at the centre of a solid
// cell of the field. Then the TOUCH, the single corner the two diagonally
// adjacent open cells share. Separate means the dirt is still between them, so
// the touch reads as dirt. A build that treated a diagonal neighbour as a join
// opens the corner and the touch reads as fill.
//
// The touch is averaged over three samples two units apart ACROSS the corner, so
// the reading is of the boundary rather than of one pixel that happened to land
// on an anti-aliased edge. The opened cells sit inside the field's solid margin.
//
// THE PRODUCED FILES ARE STOOD UP, because specs/assets.md draws both the band
// rock and the tunnel fill from produced tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TILE } from "../constants";
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

it("keeps two carved cells that share only a corner apart", async () => {
  const field = layRockField(h);
  const { row } = field;

  // The pair that must stay apart: touching at one corner alone.
  const apartCol = field.toCol - 1;
  const apartRow = row + 1;
  h.debug.setTile(apartCol, apartRow, "tunnel");
  h.debug.setTile(apartCol + 1, apartRow + 1, "tunnel");

  // Two frames, which is what puts the produced tiles in the build's hand.
  await h.advance(2);
  const snapshot = h.snapshot();
  const fill = sampleCell(h, snapshot, apartCol, apartRow);
  const dirt = sampleCell(h, snapshot, field.fromCol, row);

  // The touch: the single corner the diagonal pair shares.
  const touchAt = stageOf(
    snapshot,
    (apartCol + 1) * TILE,
    (apartRow + 1) * TILE,
  );
  const touch = meanAt(h, [
    touchAt,
    { x: touchAt.x - ACROSS, y: touchAt.y + ACROSS },
    { x: touchAt.x + ACROSS, y: touchAt.y - ACROSS },
  ]);
  captureStill(h, "apart");

  // The reading only says something where the two ends of it are apart.
  assertGreaterThan(
    colorDistance(dirt, fill),
    DISTINCT_MIN,
    "the band's unmined rock drawn clearly apart from the carved tunnel's fill, in RGB distance",
  );
  assertEqual(
    readsAs(touch, dirt, fill),
    "dirt",
    "the corner two diagonally adjacent carved cells touch at carrying the band's dirt, so the two stay separate",
  );
});
