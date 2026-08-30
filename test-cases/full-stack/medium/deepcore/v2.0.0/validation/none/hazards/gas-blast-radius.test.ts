// hazards/gas-blast-radius — the blast reaches GAS_BLAST_TILES and no further.
//
// `specs/hazards.md` bounds the damage by distance: a detonation deals its hull
// "when the miner's center is within `GAS_BLAST_TILES` of the pocket's center,
// and nothing beyond that radius". So one pocket is detonated with the miner's
// centre one tile from it and another with the miner's centre two tiles from it,
// on either side of the stated `1.5`, and the hull is read at each.
//
// WHY THE POCKET IS BLOWN RATHER THAN DRILLED. A drill reaches one cell, so a
// miner drilling a pocket is always inside the radius; there is no way to cut a
// cell two tiles away. `specs/items.md` gives the other trigger — "A gas pocket
// in the block detonates exactly as a drilled one does" — and Plastic Explosives
// clear the `5x5` block centred on the miner, which reaches two cells out. Both
// halves of this check use it, so the two readings differ in the distance alone.
//
// Travel is gated so the shove cannot carry the miner across the boundary the
// check is measuring, and the drill is gated because nothing here is cut.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { GAS_BLAST_TILES, PLASTIC_RADIUS, TILE } from "../constants";
import {
  captureReplay,
  cellCenter,
  createHarness,
  minerCenter,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type CellRef,
  type Harness,
} from "../harness";
import { armHull, bandRow, HAZARD_COL } from "./scene";

/** The tier whose hull survives a rockbed detonation with room to read it. */
const HULL_TIER = 5;

/** Frames the blast is given to resolve. */
const SETTLE_FRAMES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Stand the miner on `(HAZARD_COL, floorRow)`, pose a pocket `offset` cells to
 * its east, blow the block, and report the hull lost and the distance the blast
 * was read at.
 */
async function blastAt(floorRow: number, offset: number) {
  await standOn(h, HAZARD_COL, floorRow);
  await h.debug.setItemCount("plastic-explosives", 1);
  await armHull(h, HULL_TIER);
  // A frame before the pose is read, so the cell the snapshot puts the miner in
  // is one the build's own update has settled on rather than one read between a
  // pose and the next update.
  await h.advance(1);
  const posed = await h.snapshot();
  const pocket: CellRef = {
    col: posed.miner.col + offset,
    row: posed.miner.row,
  };
  await h.debug.setTile(pocket.col, pocket.row, "gas");

  const centre = minerCenter(posed.miner);
  const at = cellCenter(pocket.col, pocket.row);
  const tiles = Math.hypot(centre.x - at.x, centre.y - at.y) / TILE;

  await h.debug.useItem("plastic-explosives");
  await h.advance(SETTLE_FRAMES);
  const after = await h.snapshot();
  return {
    tiles,
    pocket,
    loss: posed.miner.hull - after.miner.hull,
    tile: await h.tileAt(pocket.col, pocket.row),
  };
}

it("costs hull inside the radius and nothing at all beyond it", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  const row = bandRow(await h.snapshot(), "rockbed");

  const readings = await captureReplay(h, "radius", async () => {
    const near = await blastAt(row, 1);
    const far = await blastAt(row + 6, PLASTIC_RADIUS);
    return { near, far };
  });

  // Both pockets really did detonate: each cell is open tunnel afterwards.
  assertEqual(readings.near.tile.kind, "tunnel", "specs/items.md");
  assertEqual(readings.far.tile.kind, "tunnel", "specs/items.md");

  // The near pose was inside the radius and the far pose outside it.
  assertLessThan(readings.near.tiles, GAS_BLAST_TILES, "specs/hazards.md");
  assertGreaterThan(readings.far.tiles, GAS_BLAST_TILES, "specs/hazards.md");

  assertGreaterThan(
    readings.near.loss,
    0,
    "specs/hazards.md, a detonation inside the radius",
  );
  assertEqual(
    readings.far.loss,
    0,
    "specs/hazards.md, a detonation beyond the radius",
  );
});
