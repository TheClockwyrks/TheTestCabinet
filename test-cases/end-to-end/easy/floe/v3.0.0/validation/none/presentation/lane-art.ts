// presentation — the one arrangement every lane-item sprite check in this group
// shares: one item of one kind, held still on its own lane, and the draws the
// next frame issued.
//
// Six points read a lane item's art — the plow, the dogsled, the car, the pan
// and the two rafts — and each reads exactly one item on an otherwise empty
// strait. `poseLane` stops the lane before it adds anything (see the harness), so
// the item sits on the column it was given for as long as the check runs and the
// draw's destination box can be held against the span specs/assets.md fixes.
//
// Nothing here asserts a verdict. It fails only when the item it was asked to
// pose never reached the roster, and then with the item it wanted named.
//
// Local to this group rather than on the shared harness because reading the
// BITMAP a lane item was drawn from is the presentation group's own business;
// every other group that poses a lane reads positions and covering instead.

import {
  type Blit,
  blitsOfFrame,
  type Harness,
  type ItemView,
  itemArtCentre,
  poseLane,
  requireItem,
} from "../harness";
import type { FloeKind, VehicleKind } from "../constants";

/** One lane item, held still, and the draws the frame after it issued. */
export interface LaneArt {
  /** Every `drawImage` of that frame, each matched against the seeded art. */
  blits: readonly Blit[];
  /** The item as the build reports it: its left edge, its row, its length. */
  item: ItemView;
  /**
   * Where its art belongs: the centre of the box spanning the tiles it covers.
   *
   * specs/assets.md draws a lane item's frame from the item's own `x`, with its
   * top on its row's top edge and `32` units of width per tile it spans.
   */
  centre: { x: number; y: number };
}

/**
 * Lay one item of `kind` on `row` with its left edge on column `col`, hold the
 * lane still, and read the frame that follows.
 *
 * The caller has already opened a crossing, so the strait is otherwise empty:
 * this item is the only vehicle or floe on it.
 */
export async function laneArt(
  h: Harness,
  row: number,
  kind: VehicleKind | FloeKind,
  col: number,
): Promise<LaneArt> {
  const [id] = await poseLane(h, row, kind, [col]);
  const blits = await blitsOfFrame(h);
  const item = requireItem(await h.snapshot(), id, `the ${kind} under test`);
  return { blits, item, centre: itemArtCentre(item) };
}
