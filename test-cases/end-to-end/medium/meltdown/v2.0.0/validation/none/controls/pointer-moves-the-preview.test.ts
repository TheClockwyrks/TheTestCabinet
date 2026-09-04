// Meltdown — controls/pointer-moves-the-preview: moving the pointer carries the
// held preview to the tile under it.
//
// specs/controls.md says it under the pointer: "With a placement armed, the held
// preview follows the pointer over the floor, as `specs/building.md` states."
// specs/building.md states it as arithmetic — "The held footprint is the
// `size x size` block nearest the pointer, clamped so that the whole footprint
// stays on the grid" — and specs/floor.md fixes the footprint's centre,
// `footprintCentre(col, row, size)`, as "the point range is measured from and the
// point a tower reports as its own position".
//
// THE READING IS THE ITEM'S OWN: the pointer is moved to a tile's centre and the
// held footprint's centre must land on that tile. For an odd footprint the two
// coincide exactly — that is what "the block nearest the pointer" means when the
// pointer is at a tile's middle — so the reading is a single point compared with a
// single point, with no interpretation in between.
//
// WHY THIS IS CAPPED `broken`. A preview that does not follow the pointer cannot
// be aimed, so nothing can be built with the pointer, and specs/controls.md
// requires the whole game to be reachable with the pointer alone.
//
// THE BLOOM, BECAUSE ITS FOOTPRINT IS ODD. specs/towers.md gives it three tiles a
// side, and an odd block centred on a tile has its centre AT that tile's centre; an
// even block's centre falls on a tile boundary instead, where "on that tile" would
// need a convention this specification does not state. The general formula, the
// clamp at the floor's edges and the even sizes are
// `building.preview-follows-the-pointer` and
// `building.preview-clamped-to-the-grid`; this point reads that the pointer moves
// the thing at all.
//
// THE PREVIEW STARTS SOMEWHERE ELSE, POSED. `setPreview` puts the footprint on a
// far quiet anchor first, so a build whose preview never moves reads as still
// sitting there rather than as having happened to be in the right place. Both
// anchors are clear of all four openings and of both vent-to-exhaust corridors, so
// nothing about the floor's routes enters this reading.
//
// THE MOVE IS A MOVE, NOT A TAP. Nothing is pressed and nothing is released, so
// nothing is built: `pointer.pointerMove` alone is what specs/instrumentation.md
// calls a report of "a move to that position", and what a player does carrying a
// preview across the floor.
//
// THE MONEY CLEARS THE BLOOM'S BUILD COST, so the entry is affordable and nothing
// here brushes against specs/hud.md's disabled entry. Whether the footprint reads
// VALID where it lands is `building.preview-valid-on-open-floor`'s reading, not
// this one's.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, footprintCentre, tileCX, tileCY } from "../constants";
import { assertCloseTo, assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { freeSite } from "../fixtures";

/** The type held: the Bloom, whose footprint is three tiles a side and so odd. */
const TYPE = "bloom";

/** Its footprint's side, from specs/towers.md's table. */
const SIZE = TOWER_DEFS[TYPE].size;

/** The money the run is posed with: twice the Bloom's build cost. */
const BUDGET = 2 * TOWER_DEFS[TYPE].cost;

/** Where the preview is posed before the move: a far quiet anchor. */
const START = freeSite(5);

/** The tile the pointer is moved to: a quiet one, well away from `START`. */
const TARGET = { col: 5, row: 5 };

/**
 * How far the reported footprint centre may sit from the tile's centre, as
 * decimal places for `assertCloseTo`.
 *
 * Three places is a two-thousandth of a logical unit, which is a
 * thirty-eight-thousandth of specs/floor.md's `19`-unit tile. The comparison is
 * exact arithmetic on whole tile indices and the specification's own figures, so
 * the only slack a conforming build needs here is the noise of adding those
 * figures in floating point; anything larger would be a real disagreement about
 * which tile the preview is on.
 */
const CENTRE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts the held footprint's centre on the tile the pointer moved to", async () => {
  await startRun(h);
  await h.debug.setMoney(BUDGET);
  await h.debug.setArmed(TYPE);
  await h.debug.setPreview(START.col, START.row);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(before.build?.col ?? null, START.col, "the posed preview column");
  assertEqual(before.build?.row ?? null, START.row, "the posed preview row");

  await h.debug.pointerMove(tileCX(TARGET.col), tileCY(TARGET.row));
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "moved");

  const held = after.build;
  if (held === null) {
    fail(
      "a preview still held after the pointer moved (specs/controls.md)",
      null,
    );
  }
  const centre = footprintCentre(held.col, held.row, SIZE);
  assertCloseTo(
    centre.x,
    tileCX(TARGET.col),
    CENTRE_DIGITS,
    `the held footprint's centre x after a move to the centre of tile (${TARGET.col}, ${TARGET.row})`,
  );
  assertCloseTo(
    centre.y,
    tileCY(TARGET.row),
    CENTRE_DIGITS,
    `the held footprint's centre y after a move to the centre of tile (${TARGET.col}, ${TARGET.row})`,
  );
});
