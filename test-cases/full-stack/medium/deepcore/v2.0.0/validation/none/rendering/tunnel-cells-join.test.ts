// rendering/tunnel-cells-join — two carved cells that share a side make one
// passage.
//
// specs/assets.md: "orthogonally adjacent open cells join into one passage and
// cells touching only at a corner stay separate."
//
// TWO OUTCOMES, TWO POINTS. Joining and staying apart are opposite results a
// build produces from opposite inputs, so a build that joins everything, corners
// included, must grade differently from one that joins nothing. The other half is
// `rendering/tunnel-cells-stay-separate`.
//
// THE READING. Two colours are established first, from the same frame: the FILL,
// at the centre of one of the joined cells, and the DIRT, at the centre of a
// solid cell of the field. Then the SEAM, the midpoint of the side the two
// orthogonally adjacent open cells share. Joined means the fill runs straight
// through it, so the seam reads as fill. A build that kept a lip on every side
// draws a bar of dirt down the middle of a two-cell passage, and the seam reads
// as dirt.
//
// The seam is averaged over three samples two units apart ACROSS the boundary, so
// the reading is of the boundary rather than of one pixel that happened to land
// on an anti-aliased edge. The opened cells sit inside the field's solid margin.

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
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("joins two carved cells that share a side", async () => {
  const field = await layRockField(h);
  const { row } = field;

  // The pair that must join: side by side, one row above the field's centre.
  const joinedRow = row - 1;
  const joinedLeft = field.fromCol + 1;
  await h.debug.setTile(joinedLeft, joinedRow, "tunnel");
  await h.debug.setTile(joinedLeft + 1, joinedRow, "tunnel");

  // Two frames, which is what puts the produced tiles in the build's hand.
  await h.advance(2);
  const snapshot = await h.snapshot();
  const fill = await sampleCell(h, snapshot, joinedLeft, joinedRow);
  const dirt = await sampleCell(h, snapshot, field.fromCol, row);

  // The seam: the midpoint of the side the joined pair shares.
  const seamAt = stageOf(
    snapshot,
    (joinedLeft + 1) * TILE,
    joinedRow * TILE + TILE / 2,
  );
  const seam = await meanAt(h, [
    seamAt,
    { x: seamAt.x - ACROSS, y: seamAt.y },
    { x: seamAt.x + ACROSS, y: seamAt.y },
  ]);
  await captureStill(h, "join");

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
});
