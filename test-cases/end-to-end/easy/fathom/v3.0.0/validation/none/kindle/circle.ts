// kindle/circle — the outer vision circle, and the reads its six points share.
// CASE-PROVIDED.
//
// WHY THESE POINTS CANNOT ASK "IS THIS PIXEL DARK". Every Kindle point turns on
// one question: is the build drawing terrain here, or has it painted this ground
// back to the flat unrevealed fog? An absolute darkness cut cannot answer it. The
// two colors the question separates are only a few levels apart — the fog
// `specs/overview.md` fixes is "near-black and no brighter than a tenth of full
// brightness", and REMEMBERED ground is drawn "dim" (`specs/sensing.md`) — so
// both sit under any threshold low enough to mean "dark", and a build with no
// vision circle at all would pass on ground it is visibly drawing.
//
// So every reading here is RELATIVE to the build's own fog, sampled off a tile of
// the same fixture that nothing has ever touched. That is the comparison the
// review items themselves make ("painted with that same flat fog, within 25 of
// 441 of it"), it holds whatever palette a build chose, and it is the property
// the dive actually claims: ground beyond the circle is painted with the same
// flat fog as ground never explored.
//
// The readings themselves are the harness's — `tileColor` for a tile's center,
// `brightestNear` and `brightestWarmNear` for a creature's mote, `colorDistance`
// for the gap between two colors — so a Kindle point and a Standard one read a
// tile the same way. What is here is the dive's own geometry and the bounds its
// points share.

import type { FathomSnapshot } from "../harness";
import { tileCenter, type Tile } from "../maze";
import { fromForager } from "../scene";

/**
 * How far a sample may sit from the build's own fog and still read as "painted
 * back to fog", as an RGB distance out of the `441` that spans black to white.
 *
 * The bound every Kindle review item states for itself: `25` of `441`. Wide
 * enough for dithering, a soft circle edge and anti-aliasing; far too narrow for
 * terrain a build is actually drawing.
 *
 * NOT the sensing floor a drawn sample owes, which is {@link DRAWN_FLOOR},
 * and NOT the bound for the mask itself, which is {@link MASKED_MATCH}.
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
 * The sensing floor a sample owes to count as ground the build is drawing, as an
 * RGB distance out of that same `441`.
 *
 * `8` of `441` is the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted there clears it, in whatever palette and however dim.
 *
 * What a Kindle point reads it for is whether ground inside the circle was drawn
 * at all. How boldly it is drawn is the build's: `specs/sensing.md` fixes no
 * palette and calls remembered ground only "dim".
 */
export const DRAWN_FLOOR = 8;

// How far a logical point lies from the forager's center is the scenario
// module's `fromForager`, shared with every other range reading in the suite.
export { fromForager } from "../scene";

/** How far a tile's center lies from the forager's center, in logical units. */
export function tileFromForager(snapshot: FathomSnapshot, tile: Tile): number {
  const at = tileCenter(snapshot.grid, tile);
  return fromForager(snapshot, at.x, at.y);
}
