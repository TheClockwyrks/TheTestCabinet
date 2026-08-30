// yard/tile-centres — the grid is anchored where `specs/yard.md` anchors it, so a
// structure's center is the formula's answer and not a pixel near it.
//
// EVERYTHING IN THE GAME IS MEASURED FROM THIS. Range is a radius from a
// structure's center, targeting compares distances to it, a projectile launches
// from it, and the pointer's hit test on a footprint is the same arithmetic read
// backwards. A grid off by half a tile leaves every one of those subtly wrong in
// a way no single check would name, so the geometry is decided here, once, at the
// four corners of the yard and at its middle — the anchors where an origin error,
// a tile-size error and a sign error each show up differently.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  MAX_ANCHOR_COL,
  MAX_ANCHOR_ROW,
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  structureById,
  structureCenter,
  type Harness,
} from "../harness";

/** The four corners of the anchor range, and its middle. */
const ANCHORS = [
  { col: 0, row: 0 },
  { col: MAX_ANCHOR_COL, row: 0 },
  { col: 0, row: MAX_ANCHOR_ROW },
  { col: MAX_ANCHOR_COL, row: MAX_ANCHOR_ROW },
  { col: 24, row: 15 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each structure's center at the anchor's computed point", async () => {
  openYard(h);

  const placed = ANCHORS.map((anchor) => ({
    anchor,
    id: standBlocker(h, anchor.col, anchor.row),
  }));
  await h.advance(1);
  captureStill(h, "grid");

  const s = h.snapshot();
  for (const { anchor, id } of placed) {
    const structure = structureById(s, id);
    const center = structureCenter(anchor.col, anchor.row);
    const where = `the structure anchored at (${anchor.col}, ${anchor.row})`;
    assertEqual(structure.col, anchor.col, `${where}: its reported col`);
    assertEqual(structure.row, anchor.row, `${where}: its reported row`);
    assertEqual(
      structure.cx,
      center.x,
      `${where}: cx, which specs/yard.md fixes at 20 * (col + 1)`,
    );
    assertEqual(
      structure.cy,
      center.y,
      `${where}: cy, which specs/yard.md fixes at 56 + 20 * (row + 1)`,
    );
  }
});
