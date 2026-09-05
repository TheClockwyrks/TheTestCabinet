// presentation/valid-and-invalid-previews-read-apart — a refused footprint reads
// refused.
//
// THE RULE. specs/overview.md's legibility table: "A valid footprint and an
// invalid one read plainly apart." specs/building.md is what makes it matter: a
// placement on an invalid footprint "builds nothing, blocks nothing, and spends
// nothing", so a player carrying a preview over the floor is reading, on every
// tile, whether the press about to happen will do anything at all. The preview is
// drawn "the tiles of its footprint, drawn plainly apart valid and invalid".
//
// HOW THE TWO STATES ARE REACHED, AND WHY THE ONLY DIFFERENCE IS THE VERDICT. The
// same held type, on the SAME tile, on two consecutive frames; between them, only
// the money moves. specs/building.md's fourth validity condition is "The current
// money is at least the held type's build cost", so a preview held with less than
// the cost is invalid and every other condition it is checked against is
// untouched: the footprint is on the grid, its tiles are open, no unit stands on
// them, the mode fixes no build zone, and one block on an empty floor seals
// nothing. Every other way of making a footprint invalid moves something into
// the picture — a tower under it, a unit on it, a marked zone around it — and the
// reading would then be of that thing rather than of the verdict.
//
// The build's own report of the verdict is read on each frame before the pixels
// are, because a picture of a refused footprint is only a picture of a refused
// footprint if the build agrees the footprint is refused. What the PREDICATE
// decides is `building.preview-*`'s business; this point needs only to know which
// of the two states it is looking at.
//
// WHAT IS DECIDED, AND WHERE THE BAR COMES FROM. specs/overview.md fixes no
// palette, and in particular it does not say valid is green — how plainly the
// two read apart is the reviewer's to judge. What is decided here is that the
// build drew the verdict at all: the same footprint, pixel for pixel, on the
// valid frame and on the refused one, reduced to the position the two diverge
// most at, so a build that marks refusal with a wash, a fill, a hatch or a border
// all answer. How far they must diverge is measured rather than stated: the valid
// footprint is read on two frames, which is how much the preview moves on its
// own, and the refusal has to beat that by `NOISE_MARGIN`. A build that draws the
// two the same reads zero.
//
// WHAT IT DOES NOT DECIDE. Whether the preview follows the pointer, which
// footprint it lands on and which of the six conditions refuses it are the
// `building` group's. That the held preview draws a range ring is
// `range-ring-drawn`, and that a mode's build zone is drawn is
// `build-zone-drawn`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { TOWER_DEFS } from "../constants";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import type { TowerType } from "../surface";
import {
  NOISE_MARGIN,
  footprintRegion,
  largestShift,
  readRegion,
} from "./read";

/**
 * The type held, and the tile it is held over.
 *
 * The Lance, because its 4x4 footprint is the largest in the roster and so gives
 * the reading the most of the preview to read. The tile is clear of the vent and
 * exhaust runs specs/floor.md fixes, and one block of it on an empty floor
 * satisfies every condition specs/building.md states but the money.
 */
const TYPE: TowerType = "lance";
const COL = 8;
const ROW = 22;

/** How far inside the footprint the reading starts, and how dense it is. */
const FOOTPRINT_INSET = 3;
const FOOTPRINT_STEP = 3;

/** Every pixel of the footprint on the frame now on the canvas. */
function readFootprint(h: Harness): Rgb[] {
  return readRegion(
    h,
    footprintRegion(COL, ROW, sizeOf(TYPE), FOOTPRINT_INSET),
    FOOTPRINT_STEP,
  );
}

/** The footprint as it stands on this frame, once the verdict is confirmed. */
function readPreview(h: Harness, wanted: boolean, outputId: string): Rgb[] {
  const held = h.snapshot().build;
  assertNotNull(
    held,
    `a held preview after arming a ${TYPE} (specs/building.md: arming a type ` +
      `holds a build preview), which is what this point reads the drawing of`,
  );
  assertEqual(
    held?.valid,
    wanted,
    `snapshot().build.valid with the money ${wanted ? "at or above" : "below"}` +
      ` the ${TYPE}'s build cost of ${TOWER_DEFS[TYPE].cost} ` +
      `(specs/building.md, condition 4), which is the state this reading is ` +
      `a picture of`,
  );
  captureStill(h, outputId);
  return readFootprint(h);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a valid footprint plainly apart from a refused one", async () => {
  startRun(h);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(COL, ROW);
  await h.advance(1);
  const first = readFootprint(h);

  // How far the held preview moves on its own, with nothing changed at all.
  await h.advance(1);
  const valid = readPreview(h, true, "valid");
  const noise = largestShift(first, valid);

  // Only the money moves: the same type, over the same tile, on the next frame.
  h.debug.setMoney(TOWER_DEFS[TYPE].cost - 1);
  await h.advance(1);
  const refused = readPreview(h, false, "invalid");

  assertGreaterThanOrEqual(
    largestShift(valid, refused),
    noise + NOISE_MARGIN,
    `a ${TYPE} preview held over tile (${COL}, ${ROW}) reading valid against ` +
      `the same preview reading refused: the footprint is drawn differently, ` +
      `past the ${noise} two frames of the valid preview moved on their own ` +
      `(specs/overview.md: a valid footprint and an invalid one read plainly ` +
      `apart)`,
  );
});
