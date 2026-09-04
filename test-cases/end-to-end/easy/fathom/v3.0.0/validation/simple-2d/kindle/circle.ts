// kindle/circle — the reads the Kindle dive's six points share. CASE-PROVIDED.
//
// WHY THESE POINTS CANNOT ASK "IS THIS PIXEL DARK". Every Kindle point turns on
// one question: is the build drawing terrain here, or has it painted this ground
// back to the flat unrevealed fog? An absolute darkness cut cannot answer it. The
// two colors the question separates are only a few levels apart — the fog
// specs/overview.md fixes is "near-black and no brighter than a tenth of full
// brightness", and REMEMBERED ground is drawn "dim" (specs/sensing.md) — so both
// sit under any threshold low enough to mean "dark", and a build with no vision
// circle at all would pass on ground it is visibly drawing.
//
// So every reading here is RELATIVE to the build's own fog, sampled off a tile of
// the same fixture that nothing has ever touched. That is the comparison the
// review items themselves make ("painted with that same flat fog, within 25 of
// 441 of it"), it holds whatever palette a build chose, and it is the property
// the dive actually claims: ground beyond the circle is painted with the same
// flat fog as ground never explored.

import { fail } from "../assert";
import {
  colorDistance,
  MOTE_SEARCH,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { fromForager } from "../scene";
import { FathomSnapshot } from "../surface";
import { Tile } from "../maze";

/**
 * The vision circle's radius at `G = 0` and how much a full `G` adds, in logical
 * units.
 *
 * specs/sensing.md: "Its radius is `R = KINDLE_VISION_MIN + KINDLE_VISION_GAIN *
 * G`, with `KINDLE_VISION_MIN` (`192`) and `KINDLE_VISION_GAIN` (`128`) in
 * logical units". Stated on the validator's side of the line, like every other
 * figure a check grades by: the build writes its own `src/constants.ts` and a
 * check that read these back off it would be asking the build to agree with
 * itself. They sit here rather than in `../constants` because they are the Kindle
 * dive's alone, and this one project is staged into both variants.
 */
export const KINDLE_VISION_MIN = 192;
export const KINDLE_VISION_GAIN = 128;

/**
 * How far a sample may sit from the build's own fog and still read as "painted
 * back to fog", as an RGB distance out of the `441` that spans black to white.
 *
 * The bound every Kindle review item states for itself: `25` of `441`. Wide
 * enough for dithering, a soft circle edge and anti-aliasing; far too narrow for
 * terrain a build is actually drawing.
 *
 * NOT the bound for the mask itself, which is {@link MASKED_MATCH}.
 */
export const FOG_MATCH = 25;

/**
 * How far a sample the vision circle has MASKED may sit from that same fog.
 *
 * `specs/sensing.md` does not say a masked tile resembles the fog, it says it is
 * painted with it: ground beyond `R` carries "the same flat fog as
 * never-revealed ground". Two samples of one flat color match exactly, so the
 * only slack this owes is dithering and anti-aliasing, and `8` of `441` is
 * generous for that — every reference reads `0.0` here.
 *
 * IT IS SEPARATE FROM {@link FOG_MATCH} BECAUSE 25 CANNOT DECIDE THIS. How far a
 * build draws REMEMBERED ground from its fog is the build's own choice, and one
 * of this case's three references draws it only `34.3` away — so a tile that
 * build is fully drawing, with no mask over it at all, sits `14.7` from fog and
 * passes a bound of `25`. Measured: with `drawVisionMask` removed outright from
 * the Simple 2D reference, every Kindle point still passed. A build with no
 * vision circle whatever has to fail the points that own the circle, so the
 * mask's own bound is the tight one and the drawn-terrain bound stays wide.
 */
export const MASKED_MATCH = 8;

/**
 * How far from a creature's reported center its drawn light may sit, in logical
 * units.
 *
 * The `12` is the review items' own ("the brightest warm pixel within 12 units of
 * its reported center", "the pixels within 12 units of its reported center"), and
 * it is the harness's `MOTE_SEARCH`, which every mote reading in the suite is
 * taken over. Re-exported under the name the Kindle items use so their failure
 * messages can quote the figure they state.
 */
export const MOTE_REACH = MOTE_SEARCH;

// The neighborhood search itself is the harness's, shared with every other mote
// reading in the suite so that "the brightest warm pixel within 12 units" means
// one thing here and one thing everywhere else.
export { brightestNear, brightestWarmNear, type NearSample } from "../harness";

/**
 * The outer vision circle's radius as this build reports it, or a failure naming
 * what the Kindle dive's specs/state.md requires.
 *
 * A build that reports no `windowRadius` fails here, naming the field, rather
 * than by arithmetic on `undefined` several lines later.
 */
export function windowRadius(snapshot: FathomSnapshot): number {
  if (typeof snapshot.windowRadius !== "number") {
    fail(
      "snapshot() to report the outer vision circle's radius as `windowRadius`, " +
        "which specs/state.md requires of every snapshot in this dive",
      snapshot.windowRadius,
    );
  }
  return snapshot.windowRadius;
}

// How far a logical point lies from the forager's center is the scenario
// module's `fromForager`, shared with every other range reading in the suite.
export { fromForager } from "../scene";

/** How far a tile's center lies from the forager's center, in logical units. */
export function tileFromForager(snapshot: FathomSnapshot, tile: Tile): number {
  const grid = snapshot.grid;
  return fromForager(
    snapshot,
    grid.originX + tile.tx * grid.tile + grid.tile / 2,
    grid.originY + tile.ty * grid.tile + grid.tile / 2,
  );
}

/**
 * The rendered color at a tile's center, averaged over a five-point cluster that
 * stays well inside the tile.
 *
 * The review items read a tile "sampled at its center"; the cluster is there so a
 * single anti-aliased pixel cannot decide a verdict.
 */
export function tileColor(
  h: Harness,
  snapshot: FathomSnapshot,
  tile: Tile,
): Rgb {
  const grid = snapshot.grid;
  return sampleColor(
    h,
    grid.originX + tile.tx * grid.tile + grid.tile / 2,
    grid.originY + tile.ty * grid.tile + grid.tile / 2,
  );
}

/** How far `color` sits from the build's own flat fog, out of `441`. */
export function fromFog(color: Rgb, fog: Rgb): number {
  return colorDistance(color, fog);
}
