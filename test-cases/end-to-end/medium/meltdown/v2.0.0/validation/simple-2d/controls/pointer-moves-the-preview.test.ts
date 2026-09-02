// Meltdown — controls/pointer-moves-the-preview: moving the pointer carries the
// held preview to the tile under it.
//
// THE RULE. specs/controls.md says it under the pointer: "With a placement armed,
// the held preview follows the pointer over the floor, as `specs/building.md`
// states." specs/building.md states it as arithmetic — "The held footprint is the
// `size x size` block nearest the pointer, clamped so that the whole footprint
// stays on the grid" — and specs/floor.md fixes the footprint's centre as the
// point a tower reports as its own position.
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
// side, and an odd block centred on a tile has its centre AT that tile's centre;
// an even block's centre falls on a tile boundary instead, where "on that tile"
// would need a convention this specification does not state. The general formula,
// the clamp at the floor's edges and the even sizes are
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
// THE MOVE IS A MOVE, NOT A TAP, and it goes through the ENGINE's own pointer
// input — nothing is pressed and nothing is released, so nothing is built. That is
// what a player does carrying a preview across the floor.
//
// THE MONEY CLEARS THE BLOOM'S BUILD COST, so the entry is affordable and nothing
// here brushes against specs/hud.md's disabled entry. Whether the footprint reads
// VALID where it lands is `building.preview-valid-on-open-floor`'s reading, not
// this one's.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { footprintCentreOf, tileCentre } from "../geometry";
import { freeSite, heldPreview, movePointerTo } from "./panel";

/** The type held: the Bloom, whose footprint is three tiles a side and so odd. */
const TYPE = "bloom";

/** The money the run is posed with: twice the Bloom's build cost. */
const BUDGET = 2 * TOWER_DEFS[TYPE].cost;

/** Where the preview is posed before the move: a far quiet anchor. */
const START = freeSite(8);

/** The tile the pointer is moved to: a quiet anchor well away from `START`. */
const TARGET = freeSite(0);

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

afterEach(() => {
  h?.dispose();
});

it("puts the held footprint's centre on the tile the pointer moved to", async () => {
  startRun(h);
  h.debug.setMoney(BUDGET);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(START.col, START.row);
  await h.advance(1);
  const posed = heldPreview(h, "posing the preview before the move");
  assertEqual(
    posed.col,
    START.col,
    "posing: the preview's column before the move (specs/instrumentation.md)",
  );
  assertEqual(
    posed.row,
    START.row,
    "posing: the preview's row before the move (specs/instrumentation.md)",
  );

  const at = tileCentre(TARGET.col, TARGET.row);
  await movePointerTo(h, at.x, at.y);
  captureStill(h, "moved");

  const held = heldPreview(h, "after the pointer moved over the floor");
  const centre = footprintCentreOf(TYPE, held.col, held.row);
  const where =
    `after a move to the centre of tile (${TARGET.col}, ${TARGET.row}) ` +
    `with a ${TYPE} held (specs/controls.md, The pointer)`;
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
