// The reads the Kindle dive's six points share. CASE-PROVIDED.
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
// for the gap between two colors — so a Kindle point and a Standard one state one
// threshold and mean the same thing by it. What is here is the dive's own
// geometry and the one bound its items share.

import { tileCenterOf } from "../fixtures";
import type { FathomSnapshot } from "../harness";
import type { TileRef } from "../maze";

/**
 * How far a sample may sit from the build's own fog and still read as "painted
 * back to fog", as an RGB distance out of the `441` that spans black to white.
 *
 * The bound every Kindle review item states for itself: `25` of `441`. Wide
 * enough for dithering, a soft circle edge and anti-aliasing; far too narrow for
 * terrain a build is actually drawing.
 */
export const FOG_MATCH = 25;

/** How far the logical point `(x, y)` lies from the forager's center. */
export function fromForager(
  snapshot: FathomSnapshot,
  x: number,
  y: number,
): number {
  return Math.hypot(x - snapshot.forager.x, y - snapshot.forager.y);
}

/** How far a tile's center lies from the forager's center, in logical units. */
export function tileFromForager(
  snapshot: FathomSnapshot,
  tile: TileRef,
): number {
  const at = tileCenterOf(snapshot.grid, tile);
  return fromForager(snapshot, at.x, at.y);
}
