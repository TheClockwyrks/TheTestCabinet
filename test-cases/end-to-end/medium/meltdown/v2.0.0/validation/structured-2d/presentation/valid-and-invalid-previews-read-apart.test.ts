// presentation/valid-and-invalid-previews-read-apart — a refused footprint reads
// refused.
//
// THE RULE. specs/overview.md's legibility table: "A valid footprint and an
// invalid one read plainly apart." specs/building.md is what makes it matter: a
// placement on an invalid footprint builds nothing, blocks nothing and spends
// nothing, so a player carrying a preview over the floor is reading, on every
// tile, whether the press about to happen will do anything at all.
//
// HOW THE TWO STATES ARE REACHED, AND WHY THE ONLY DIFFERENCE IS THE VERDICT. The
// same held type, on the SAME tile, on two consecutive frames; between them, only
// the money moves. specs/building.md's money condition is that the current money
// is at least the held type's build cost, so a preview held with less than the
// cost is invalid and every other condition it is checked against is untouched:
// the footprint is on the grid, its tiles are open, no unit stands on them, the
// mode fixes no build zone, and one block on an empty floor seals nothing. Every
// other way of making a footprint invalid moves something into the picture — a
// tower under it, a unit on it, a marked zone around it — and the reading would
// then be of that thing rather than of the verdict.
//
// The build's own report of the verdict is read on each frame before the pixels
// are, because a picture of a refused footprint is only a picture of a refused
// footprint if the build agrees the footprint is refused. What the PREDICATE
// decides is `building.preview-*`'s business; this point needs only to know which
// of the two states it is looking at.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette, and in particular it does not say valid is green. The reading is the
// same footprint on the two frames, pixel for pixel: what proportion of it the
// build drew plainly differently once the verdict turned over. Everything about
// the preview that does NOT depend on the verdict — its outline, the radiator
// marks a build puts on a held type, the floor and the grid showing through a
// translucent wash — is identical in both frames and cancels out of the reading,
// so what is left is exactly the marking the verdict moved.
//
// WHY A PROPORTION AND NOT THE COLOUR THE FOOTPRINT MOSTLY READS AS. A build may
// mark refusal by washing the whole footprint, by filling it, by hatching it, or
// by drawing a border round it, and the specification asks for none of them in
// particular. A reading of what the footprint MOSTLY is would answer the first
// three and fail the fourth for being a border, so the reading is a proportion
// and the bar below is set at the thinnest border a player could see.
//
// WHAT IT DOES NOT DECIDE. Whether the preview follows the pointer, which
// footprint it lands on and which condition refuses it are the `building` group's.
// That the held preview draws a range ring is `range-ring-drawn`, and that a
// mode's build zone is drawn is `build-zone-drawn`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
  type Rgb,
  type TowerType,
} from "../harness";
import { footprintRegion, movedFraction, readRegion } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, the two previews must read.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. "Plainly apart" is
 * the legibility table's own phrase for this pair, and it is what a player
 * carrying a footprint across a floor has to answer without stopping to look.
 */
const APART_MIN = 50;

/**
 * How much of the footprint must be drawn differently for the verdict to have
 * been marked at all.
 *
 * The whole footprint is read, so a build that washes or fills it reads nearly
 * all of it and this figure is set for the LEANEST marking the rule admits: a
 * border round the footprint's own edge. A border of ordinary weight — two units
 * — laid on that edge puts about one unit of itself inside the footprint, which
 * on the 4-tile footprint read here is 4 * 76 * 1 of 76 * 76, a nineteenth. The
 * bar is half of that, because a border is anti-aliased against whatever it is
 * drawn over and only part of its width reads as plainly changed. A build that
 * draws the two states identically reads zero, so nothing separates a bordered
 * preview from an unmarked one but this.
 */
const CHANGED_MIN = 0.025;

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

/**
 * The whole footprint is read, at every pixel: a border is drawn on the
 * footprint's own edge, so a reading that inset itself past that edge could not
 * see one. Both frames are read over exactly the same region at exactly the same
 * step, which is what makes them comparable pixel for pixel.
 */
const FOOTPRINT_INSET = 0;
const FOOTPRINT_STEP = 1;

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
      `(specs/building.md), which is the state this reading is a picture of`,
  );
  captureStill(h, outputId);
  return readRegion(
    h,
    footprintRegion(COL, ROW, sizeOf(TYPE), FOOTPRINT_INSET),
    FOOTPRINT_STEP,
  );
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
  const valid = readPreview(h, true, "valid");

  // Only the money moves: the same type, over the same tile, on the next frame.
  h.debug.setMoney(TOWER_DEFS[TYPE].cost - 1);
  await h.advance(1);
  const refused = readPreview(h, false, "invalid");

  assertGreaterThanOrEqual(
    movedFraction(valid, refused, APART_MIN),
    CHANGED_MIN,
    `a ${TYPE} preview held over tile (${COL}, ${ROW}) reading valid against ` +
      `the same preview over the same tile reading refused: the proportion of ` +
      `its footprint drawn at least ${APART_MIN} of 441 differently between ` +
      `the two (specs/overview.md: a valid footprint and an invalid one read ` +
      `plainly apart)`,
  );
});
