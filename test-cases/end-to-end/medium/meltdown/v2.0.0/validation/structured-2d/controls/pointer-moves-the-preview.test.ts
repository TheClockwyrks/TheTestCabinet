// Meltdown — controls/pointer-moves-the-preview: moving the pointer carries the
// held preview to the tile under it.
//
// THE RULE. specs/controls.md says it under The pointer: "With a placement armed,
// the held preview follows the pointer over the floor, as `specs/building.md`
// states." specs/building.md states it as arithmetic — "The held footprint is the
// `size x size` block nearest the pointer, clamped so that the whole footprint
// stays on the grid" — and specs/floor.md fixes the footprint's centre as the
// point a tower's range is measured from.
//
// THE READING IS THE ITEM'S OWN: the pointer is moved to a tile's centre and the
// held footprint's centre must land on that tile. For an ODD footprint the two
// coincide exactly — that is what "the block nearest the pointer" means when the
// pointer is at a tile's middle — so the reading is a single point compared with a
// single point, with no interpretation in between.
//
// WHY THE CAP IS `broken`. A preview that does not follow the pointer cannot be
// aimed, so nothing can be built with the pointer, and specs/controls.md requires
// the whole game to be reachable with the pointer alone.
//
// THE BLOOM, BECAUSE ITS FOOTPRINT IS ODD. specs/towers.md gives it three tiles a
// side, and an odd block centred on a tile has its centre AT that tile's centre;
// an even block's centre falls on a tile boundary instead, where "on that tile"
// would need a convention no specification states. The general formula, the clamp
// at the floor's edges and the even sizes are
// `building.preview-follows-the-pointer` and
// `building.preview-clamped-to-the-grid`; this item reads that the pointer moves
// the thing at all.
//
// THE PREVIEW STARTS SOMEWHERE ELSE, POSED, so a build whose preview never moves
// reads as still sitting there rather than as having happened to be in the right
// place. Both anchors are quiet ones, clear of all four openings and of both
// vent-to-exhaust corridors, so nothing about the floor's routes enters this
// reading, and both are far enough inside the grid that specs/building.md's clamp
// is inert.
//
// THE MOVE IS A MOVE, NOT A TAP. Nothing is pressed and nothing is released, so
// nothing is built.
//
// THE MONEY CLEARS THE BLOOM'S BUILD COST, so the entry is affordable and nothing
// here brushes against specs/hud.md's disabled entry. Whether the footprint reads
// VALID where it lands is `building.preview-valid-on-open-floor`'s reading.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertCloseTo, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  footprintCenter,
  movePointerTo,
  startRun,
  tileCenter,
  type Harness,
} from "../harness";
import { FAR_SITE } from "./scene";

/** The type held: the Bloom, whose footprint is three tiles a side and so odd. */
const TYPE = "bloom";

/** The money the run is posed with: twice the Bloom's build cost. */
const PURSE = 2 * TOWER_DEFS[TYPE].cost;

/** Where the preview is posed before the move: a quiet anchor far from the target. */
const START = FAR_SITE;

/** The tile the pointer is moved to: quiet, and well away from `START`. */
const TARGET = { col: 5, row: 5 } as const;

/**
 * How far the reported footprint centre may sit from the tile's centre, as
 * decimal places for `assertCloseTo`.
 *
 * Three places is a two-thousandth of a logical unit, a thirty-eight-thousandth of
 * specs/floor.md's `19`-unit tile. The comparison is exact arithmetic on whole
 * tile indices and the specification's own figures, so the only slack a conforming
 * build needs is the noise of adding those figures in floating point; anything
 * larger would be a real disagreement about which tile the preview is on.
 */
const CENTRE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the held footprint's centre on the tile the pointer moved to", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(START.col, START.row);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.build?.col, START.col, "the posed preview column");
  assertEqual(before.build?.row, START.row, "the posed preview row");

  const at = tileCenter(TARGET.col, TARGET.row);
  await movePointerTo(h, at.x, at.y);
  captureStill(h, "moved");

  const held = h.snapshot().build;
  assertNotNull(held, "a preview still held after the pointer moved");
  const centre = footprintCenter(TYPE, held?.col ?? 0, held?.row ?? 0);
  const where = `after a move to the centre of tile (${TARGET.col}, ${TARGET.row})`;
  assertCloseTo(
    centre.x,
    at.x,
    CENTRE_DIGITS,
    `the held footprint's centre x ${where}`,
  );
  assertCloseTo(
    centre.y,
    at.y,
    CENTRE_DIGITS,
    `the held footprint's centre y ${where}`,
  );
});
